# DappDrill's current entity model (code as of b3a0473, 2026-11-05)

Scope and method: read of this repository only. Citations are `file:line` links, relative to the repo root. "Cited Findings" are what the code or docs say. "Inferences" are my interpretation. Nothing was run, and the local Postgres was not queried, so nothing here describes row counts or live data.

Context for every section: the current model is about a day old. Commit 72e0d1b ("Turn DappDrill into tests: find an app's flows, write a test per flow, run them", 2026-11-04, 159 files, +7795/-10742) replaced the earlier scan/report/flow/variation model. Migration [0006_drop_scans.sql](packages/db/drizzle/0006_drop_scans.sql) dropped `api_tokens, flow_changes, flows, issues, repairs, run_batches, runs, scan_events, scans, signing_reviews, variations`, and [0007_tests.sql](packages/db/drizzle/0007_tests.sql) created `analyses, flows, tests, test_runs, agent_messages`. Most mismatches below are leftovers of that pivot.

## What are the persisted and shared entities?

### Takeaway
Postgres has five product entities: App, Analysis, Flow, Test and TestRun, plus AgentMessage and team-level tables. Almost everything else lives in JSONB on those rows: steps, cached actions, setup, app map, signing reviews, issues, wallet requests. `packages/core` still exports a full second model from the old scan era (Flow as a script, FlowRun, ScanReport, Variation, ScanPlan), and only part of it is still used.

### Cited Findings

Persisted tables ([schema/app.ts](packages/db/src/schema/app.ts)):

| Table | Key fields | Relationships |
|---|---|---|
| `teams`, `team_members`, `invites` | name, plan; role; token | user to team ([app.ts:37-63](packages/db/src/schema/app.ts)) |
| `test_wallets` | accounts A and B (encrypted), inbox | PK = team_id, so one per team ([app.ts:69-78](packages/db/src/schema/app.ts)) |
| `integrations` | kind slack/telegram/email/github, config, secret | unique per team and kind ([app.ts:80-94](packages/db/src/schema/app.ts)) |
| `domains` | host, token, verifiedAt | team; gates scheduled runs ([app.ts:143-155](packages/db/src/schema/app.ts)) |
| `apps` | name, url, host, `settings` (AppSettings), live key, access headers, `map` (AppMap), `setup` (AppSetup), `chains`, `schedule_time` | team ([app.ts:113-141](packages/db/src/schema/app.ts)) |
| `analyses` | status (JobStatus), liveFrame, log, blocked, stalled, costUsd, error, stopRequested | app; comment says "The first look at an app" ([app.ts:162-183](packages/db/src/schema/app.ts)) |
| `flows` | **name, position only** | app; comment: "A thing users do (trade, deposit); groups its happy path with the tests forked or derived from it" ([app.ts:187-198](packages/db/src/schema/app.ts)) |
| `tests` | name, goal, expected, startPath, `steps` jsonb, `condition`, `base_id`, `forked_from`, proof, drafting, position | app, flow (cascade); `base_id` is a self-FK with cascade; `forked_from` is plain text with no FK ([app.ts:200-225](packages/db/src/schema/app.ts), FKs in [0007_tests.sql](packages/db/drizzle/0007_tests.sql)) |
| `test_runs` | `batch_id` (plain text), trigger (manual/analysis/schedule/agent), status, `result` jsonb, liveFrame, stopRequested, timestamps | app, test (cascade); comment: "One run of one test. Runs started together … share a batch id" ([app.ts:227-247](packages/db/src/schema/app.ts)) |
| `agent_messages` | role user/agent, text, status, context {testId, flowId}, links [{label, href}] | app, user ([app.ts:256-274](packages/db/src/schema/app.ts)) |

Shared zod types that are in use ([core/test.ts](packages/core/src/test.ts)):
- `TestStep {text, actions?}`: plain-English step plus cached browser actions ([test.ts:12-16](packages/core/src/test.ts)).
- `TestSpec {id, name, goal, expected, startPath, steps, proof?, condition?}`: what the engine needs to run one test. It has no flowId and no baseId ([test.ts:33-45](packages/core/src/test.ts)).
- `TestDraft`, `SetupDraft`, `FlowDraft {name, test}`, where the last is exactly one test ([test.ts:49-55](packages/core/src/test.ts), [test.ts:150-153](packages/core/src/test.ts)).
- `AppSetup {startPath, steps, when: once|each, why}` ([test.ts:69-75](packages/core/src/test.ts)).
- `TestRunStatus = queued|running|pass|fail|error|skipped|stopped` ([test.ts:109](packages/core/src/test.ts)).
- `TestRunResult {setup?, steps[], verdict?, failure?, walletRequests[], signingReviews[], issues[], console[], video?, finalScreenshot?, costUsd}` ([test.ts:124-139](packages/core/src/test.ts)).
- `AppMap {summary, pages[{path, purpose}]}` ([test.ts:143-146](packages/core/src/test.ts)).
- `CONDITIONS`: 10 offered unhappy paths with id, name, expected, default ([test.ts:157-168](packages/core/src/test.ts)).
- `EdgeCaseId`: 13 ids including `happy`, `existing-approval`, `revoked-approval` ([edge-cases.ts:3-17](packages/core/src/edge-cases.ts)).
- `Issue` with fingerprint, severity, category, flowId, edgeCase, runId ([issues.ts:38-72](packages/core/src/issues.ts)).
- `SigningReview` with flowId, runId, verdict, checks, baseline, fingerprint ([signing.ts:133-175](packages/core/src/signing.ts)).
- `WalletRequest` ([signing.ts:4-20](packages/core/src/signing.ts)).

Old-model types still in core:
- `Flow` is "A deterministic, replayable script" with `steps: Step[]`, params, origin, setup ([flow.ts:106-114](packages/core/src/flow.ts)). The engine still uses it as the internal replay format: `flowOf()` wraps a test's cached actions into one ([pipeline/steps.ts:96-98](packages/engine/src/pipeline/steps.ts)).
- `Step` is a browser action (click, fill, wallet…) ([flow.ts:45-80](packages/core/src/flow.ts)).
- `FlowRun` is "One flow under one edge case (one cell of the report matrix)" ([run.ts:165-188](packages/core/src/run.ts)). The engine uses it internally, and `runCondition` converts it into a `TestRunResult` ([pipeline/tests.ts:209-237](packages/engine/src/pipeline/tests.ts)).
- A word-match search outside `packages/core` finds no use of `ScanReport, ScanOptions, ReplayOptions, ScanPlan, PlanItem, ScanStage, FailCause, FlowOrigin, ParamDef, SCAN_STAGE_LABEL, DEFAULT_EDGE_CASES, HEALTH_LABEL, healthOfIssues`.
- `Variation` is referenced only by `replay/edge-cases.ts` as an optional argument, and `runCondition` does not pass one ([pipeline/tests.ts:181-198](packages/engine/src/pipeline/tests.ts)).

`DrillEvent` ([run.ts:225-240](packages/core/src/run.ts)) has 15 variants:
- No emitter was found under `packages/engine/src`, `apps` or `packages/cli` for `stage`, `flow`, `plan`, `page`, `blocked` or `stalled`.
- The worker's analysis sink stores only `frame` and non-error `log` ([analyze.ts:42-48](apps/worker/src/jobs/analyze.ts)).
- The tests job only logs `log` events ([sink.ts:20-24](apps/worker/src/jobs/sink.ts), [tests.ts:77](apps/worker/src/jobs/tests.ts)).
- Run progress actually travels through `TestHooks` callbacks, not events ([pipeline/tests.ts:49-58](packages/engine/src/pipeline/tests.ts)).

### Inferences
- The live model is `Team > App > Flow > Test > TestRun`, with one `Test > Test` self-relation for unhappy paths. `Flow` is a thin folder with no behaviour of its own.
- CLAUDE.md's description of DrillEvent as the event stream is out of date. Hooks are the real contract for runs.
- Roughly a third of `core/run.ts` could be deleted before any redesign, which removes much of the "flow means script" confusion for free.

### Gaps
- Actual row counts, and whether any deployed database holds data worth migrating, are unknown.

## What is a "subtest" concretely?

### Takeaway
"Subtest" appears nowhere in the repo (case-insensitive `sub-?tests?` search, zero hits). The thing the owner means is the **unhappy path**: a real `tests` row with `base_id` and `condition` set and `steps: []`, created on demand rather than computed at run time. It is a parent/child relation one level deep, but only half of the child's fields do anything when it runs.

### Cited Findings
Creation:
- `addUnhappyPaths` inserts one row per condition the base lacks: name from `CONDITIONS`, goal copied from the base, expected from `CONDITIONS`, startPath copied, `steps: []`, `condition`, `baseId` ([db/src/tests.ts:69-90](packages/db/src/tests.ts)).
- It refuses a base that is itself an unhappy path, so nesting is capped at one level ([tests.ts:71](packages/db/src/tests.ts)).
- Web and assistant paths: [actions/tests.ts:170-179](apps/web/src/actions/tests.ts), [worker agent.ts:182-193](apps/worker/src/jobs/agent.ts).
- CLI path, a separate implementation: [cli run.ts:93-104](packages/cli/src/commands/run.ts).
- The web analysis creates only happy-path tests ([analyze.ts:96-118](apps/worker/src/jobs/analyze.ts)). Unhappy paths appear only when a person or the assistant adds them, or with CLI `--unhappy`.

Running ([pipeline/tests.ts](packages/engine/src/pipeline/tests.ts)):
- `runItem` branches on `spec.condition && base` ([tests.ts:98](packages/engine/src/pipeline/tests.ts)).
- If any base step has no cached actions, the base is run first in the same turn. If it doesn't pass, the child ends as `error` with "“base” has to pass first" ([tests.ts:160-167](packages/engine/src/pipeline/tests.ts)).
- Base actions are flattened and replayed through `runEdgeCases` with `edgeCases: [condition]` ([tests.ts:172-185](packages/engine/src/pipeline/tests.ts)). The replay matrix runs one cell per child, and `flow: flowOf(source, actions)` means the base's id and name are what the replay sees.
- Results map back onto base steps through `owner[]` ([tests.ts:209-223](packages/engine/src/pipeline/tests.ts)). Status mapping: `issue` or `fail` becomes `fail` ([tests.ts:224](packages/engine/src/pipeline/tests.ts)).
- No model drives the steps. The only model call is the recovery judge, which runs when the replay stopped short with no issue drafts ([edge-cases.ts:269-271](packages/engine/src/replay/edge-cases.ts)).
- Order: `queueRuns` inserts bases first ([db tests.ts:58-66](packages/db/src/tests.ts)), the worker sorts by page order ([worker tests.ts:21-26](apps/worker/src/jobs/tests.ts)), and steps learned earlier in the batch are handed on via `fresh` ([pipeline/tests.ts:72](packages/engine/src/pipeline/tests.ts), [tests.ts:80](packages/engine/src/pipeline/tests.ts)).

Which fields on the child matter:
- `runCondition` never reads `spec.goal`, `spec.expected` or `spec.startPath` ([tests.ts:156-239](packages/engine/src/pipeline/tests.ts)). It uses the base's actions and start, and the expected text in the replay comes from `edge-cases.ts` per-condition strings, for example [edge-cases.ts:386](packages/engine/src/replay/edge-cases.ts). Those strings are worded differently from `CONDITIONS.expected`, which is what the user reads.
- The web still lets a user edit name, goal and expected on a child; only steps are fixed ([actions/tests.ts:149-163](apps/web/src/actions/tests.ts), [test page:149](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)).
- Child `goal` is a copy made at creation; nothing in `updateTestAction` propagates a base edit ([actions/tests.ts:153-164](apps/web/src/actions/tests.ts)).

UI treatment:
- Own URL and page at `/apps/:id/tests/:testId`.
- Indented row with a branch glyph, in a collapsible "N unhappy paths" group ([app page:170-195](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)).
- Breadcrumb Tests / flow / base ([test page:74-88](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)).
- Note "Runs the steps of X with this condition: Y" ([test page:153-160](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)).

Lifecycle and limits:
- Deleting a base cascades to its children ([app.ts:213](packages/db/src/schema/app.ts)).
- Forks don't copy children ([actions/tests.ts:119-140](apps/web/src/actions/tests.ts)).
- Unhappy paths can't be forked ([actions/tests.ts:121](apps/web/src/actions/tests.ts)).
- The engine knows 13 edge cases and the UI offers 10. `existing-approval` and `revoked-approval` aren't offered ([test.ts:157-168](packages/core/src/test.ts)).
- A condition that doesn't apply comes back `skipped` with a reason in `result.failure` ([edge-cases.ts:146-156](packages/engine/src/replay/edge-cases.ts), [tests.ts:230](packages/engine/src/pipeline/tests.ts)). Both UI failure displays are limited to fail/error ([test page:135](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>), [app page:218](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)).

### Inferences
- An unhappy path is structurally a **pair (base test, condition)** stored as a full Test row. Name, goal, expected, startPath and steps are decoration or dead weight. Its real state is `condition`, `base_id` and its runs.
- Editing "Expected result" on an unhappy path looks like it changes the check, but it has no effect on the run. That is the sharpest example of the row pretending to be a test.
- Users see a "Skipped" unhappy path with no reason, as far as I can tell from code.

### Gaps
- I read `runEdgeCases` setup and judging in part, not all 933 lines of `edge-cases.ts`. The per-condition logic wasn't audited.

## What is the relationship between AppMap flows and tests?

### Takeaway
AppMap has no flows: it is only a summary and pages. Flows come back beside the map from the analysis. "Flow" is a real table and a visible UI term. One flow produces exactly one test **only at analysis time**; after that a flow holds many tests.

### Cited Findings
- `AppMap` = `{summary, pages}` ([test.ts:143-146](packages/core/src/test.ts)). The analysis submission has separate `summary`, `pages`, `setup`, `flows` with `flows` min 1, max 3 ([analyst.ts:37-42](packages/engine/src/agent/analyst.ts)). The prompt asks for "the 2 or 3 flows users most need to work … each with one happy-path test" ([analyst.ts:23](packages/engine/src/agent/analyst.ts)).
- `addFlows` makes one flow row and one test row per draft, and skips names the app already has, case-insensitively ([analyze.ts:96-118](apps/worker/src/jobs/analyze.ts)). Those tests are then run with trigger `analysis` ([analyze.ts:85-88](apps/worker/src/jobs/analyze.ts)).
- After that, a flow gains tests through "Add a test" ([add-test.tsx:52](apps/web/src/components/tests/add-test.tsx)), Fork, which stays in the same flow ([actions/tests.ts:128](apps/web/src/actions/tests.ts)), unhappy paths, and the assistant's `create_test`, which can create a flow by name ([agent.ts:128-142](apps/worker/src/jobs/agent.ts)).
- Nothing marks "the" happy path of a flow. Any `base_id IS NULL` test is a root, and every root can have its own unhappy paths ([db tests.ts:71](packages/db/src/tests.ts)).
- Flows have no page, no goal, no description and no status of their own. The breadcrumb shows the flow name as plain text ([test page:79](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)). Flow actions are rename, delete, "Run flow" ([flow-header.tsx:70](apps/web/src/components/tests/flow-header.tsx), [flow-header.tsx:106](apps/web/src/components/tests/flow-header.tsx)).
- Deleting a flow's last test deletes the flow ([actions/tests.ts:185-187](apps/web/src/actions/tests.ts)).
- On the new-app form, "Which flows should we test?" ([new-app-form.tsx:470](apps/web/src/components/new-app-form.tsx)) does not create flows. The text goes into `settings.hints` as "Flows to test:" ([new-app-form.tsx:254](apps/web/src/components/new-app-form.tsx)).
- Claims of one-to-one: CLAUDE.md ("one test per flow"), [new page:10](<apps/web/src/app/(app)/new/page.tsx>) ("One per flow, yours to edit"), [cli main.ts](packages/cli/src/main.ts) ("write a test for each of its main flows").

### Inferences
- `flow.name` ("Trade perps") already plays the role a "goal" would play in a goals/flows/tests model: what the user is trying to do. `tests.goal` is a one-sentence restatement of a single test, not a grouping.
- A real three-level goals/flows/tests split has no data home today. The present hierarchy is flow (group) > root test (a path) > unhappy path (a condition on that path).
- Flow lifetime is tied to its tests, so a flow can't exist as a standing statement of intent without a test in it.

### Gaps
- None for code. Whether users think in flows or tests is not something the repo can answer.

## What vocabulary does the user actually see?

### Takeaway
The user sees **Tests, flows, unhappy paths, conditions, steps, runs, Setup, Goal, Expected result, Explore**. They do not see subtest, variation, scenario, suite or variant. "Test" is the headline noun, "flow" is a section heading, and "unhappy path" and "condition" name one thing from two angles.

### Cited Findings
Occurrences in `apps/web/src` excluding `components/ui/`, counted by line and including code identifiers:

| Term | Lines | Note |
|---|---|---|
| `sub-?test`, `variation`, `scenario`, `suite` | 0 | |
| `variant` | 56 | all shadcn styling props, none user-facing |
| `edge case` | 1 | only site metadata: "QA for web3 dApp frontends: flows, wallet edge cases and signing review." ([layout.tsx:10](apps/web/src/app/layout.tsx)) |
| `scan` | 3 | one user string: "Your first scan is free." ([auth-form.tsx:37](apps/web/src/components/auth/auth-form.tsx)) |
| `unhappy path` | 10 | |
| `condition` | 14 | |
| `goal` | 10 | |
| `flow` | 70 | |

User-visible strings by term:
- **Test**: nav "Tests" ([header.tsx:29](apps/web/src/components/shell/header.tsx)); "Run test", "Run all" ([app page:234](<apps/web/src/app/(app)/apps/[appId]/page.tsx>), [app page:85](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)); "No tests yet" ([app page:126](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)); "First test" ([add-test.tsx:104](apps/web/src/components/tests/add-test.tsx)); "The same test, but…" ([fork.tsx:35](apps/web/src/components/tests/fork.tsx)).
- **Flow**: "Run flow", "Delete flow and its tests?" ([flow-header.tsx:70](apps/web/src/components/tests/flow-header.tsx), [flow-header.tsx:106](apps/web/src/components/tests/flow-header.tsx)); "Flow" label, "Add flow" ([add-test.tsx:100](apps/web/src/components/tests/add-test.tsx), [add-test.tsx:111](apps/web/src/components/tests/add-test.tsx)); "Finding the main flows" ([analysis-panel.tsx:51](apps/web/src/components/tests/analysis-panel.tsx)); "It didn't find a flow to test" ([analysis-panel.tsx:87](apps/web/src/components/tests/analysis-panel.tsx)).
- **Unhappy path**: "N unhappy paths", "Run unhappy paths" ([app page:180](<apps/web/src/app/(app)/apps/[appId]/page.tsx>), [app page:184](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)); panel "Unhappy paths" ([test page:186](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)); "Add unhappy paths" ([unhappy.tsx:23](apps/web/src/components/tests/unhappy.tsx)); assistant chip ([assistant.tsx:11](apps/web/src/components/assistant.tsx)).
- **Condition**: "with this condition:" ([test page:159](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)); "Runs this test's steps under each condition and checks the app copes." ([unhappy.tsx:39](apps/web/src/components/tests/unhappy.tsx)).
- **Happy path**: as a bare user string, only an error message: "Fork the happy path instead." ([actions/tests.ts:121](apps/web/src/actions/tests.ts)). Happy tests are never labelled as such.
- **Goal, Expected result, Steps**: section labels on the test page ([test page:162-163](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>), [test page:233](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)).
- **Run**: "last run" ([app page:78](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)); panel "Runs" ([test page:295](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)); "Daily run" ([settings-form.tsx:73](apps/web/src/components/settings-form.tsx)); triggers "Run by you / First run / Daily run / Run by the assistant" ([format.ts:48](apps/web/src/lib/format.ts)); "Once per run" ([test.ts:66](packages/core/src/test.ts)).
- **Exploring**: "Explore the app" ([app page:130](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)); "Exploring" ([analysis-panel.tsx:47](apps/web/src/components/tests/analysis-panel.tsx)); "Explore again" ([settings page:45](<apps/web/src/app/(app)/apps/[appId]/settings/page.tsx>)).
- **Status**: Passed / Failed / Couldn't run / Running / Queued / Stopped / Skipped / Not run yet / Writing… ([status.tsx:8-18](apps/web/src/components/tests/status.tsx)).
- **Run detail panels**: "Wallet", "Problems found", "Console errors" ([run-details.tsx:22](apps/web/src/components/tests/run-details.tsx), [run-details.tsx:103](apps/web/src/components/tests/run-details.tsx), [run-details.tsx:123](apps/web/src/components/tests/run-details.tsx)).
- **Check**: not an entity. It is signing check labels, the RPC URL check and "bot check".

Every page in `apps/web/src/app`:

| Route | Shows |
|---|---|
| `/` | Redirect to last app or `/new` ([page.tsx](apps/web/src/app/page.tsx)) |
| `/new` | "Add your dApp": creates App, starts Analysis ([new page](<apps/web/src/app/(app)/new/page.tsx>)) |
| `/apps/[appId]` | Main page, nav "Tests", function `TestsHome`: App header, latest Analysis, Setup card, Flow cards with Tests and unhappy groups ([page.tsx](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)) |
| `/apps/[appId]/tests/[testId]` | One Test or unhappy path: spec, selected TestRun (`?run=`), media, problems, wallet and signing, console, unhappy paths, Runs list ([page.tsx](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)) |
| `/apps/[appId]/settings` | App settings: notes, daily run, chains, wallets, access, Explore again, delete ([page.tsx](<apps/web/src/app/(app)/apps/[appId]/settings/page.tsx>)) |
| `/account` | Team-level test wallets, domains, integrations, team ([page.tsx](<apps/web/src/app/(app)/account/page.tsx>)) |
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/invite/[token]` | Auth and invites |
| `/bot`, `/fork` | Public doc pages: "The DappDrill browser", "Testing on a fork" (chain fork) ([fork/page.tsx](apps/web/src/app/fork/page.tsx)) |
| `api/artifacts/[...path]`, `api/auth/[...all]` | Non-page routes |

There is no flow page, no run or batch page, no issues page, no signing-review page and no analysis history. The header has two nav items, Tests and Settings ([header.tsx:28-31](apps/web/src/components/shell/header.tsx)).

### Inferences
- The owner's "tests and subtests" is a fair description of the screen: the indented branch row reads as a child test. The product term is "unhappy path".
- The main page is called Tests but its top-level visual unit is the Flow card. The nav and the layout disagree about the primary noun.

### Gaps
- `setup-card.tsx`, `spec-editor.tsx` and `assistant.tsx` were read through grep, not line by line. The UI was not viewed running, so ordering and visual weight come from code only.

## What do the docs and designs say, and where do they disagree?

### Takeaway
`docs/product-context.md` and `docs/designs/*.html` describe the **pre-pivot** model, in which a flow is the testable unit, reports are a flow × edge-case matrix, and inputs vary through Variations. CLAUDE.md and README describe the current model. The v2 notes that CLAUDE.md says "win" are mostly not what was built.

### Cited Findings
Product context and designs:
- Product context says "nothing has been built yet" ([product-context.md:4](docs/product-context.md)) and that the agent "maps every user flow, and replays them under wallet edge cases", saving "each flow as a test" ([product-context.md:9-10](docs/product-context.md)).
- **Variations vs forks**: the doc decides "Variations", not "forks"; "No linked forks unless users ask for them" ([product-context.md:30-33](docs/product-context.md)). v2 note 5 says "Variations replace both the forks list and the across-wallets list" ([product-context.md:45](docs/product-context.md)). The code does the opposite: a "Fork" button ([test page:109](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)), a `forked_from` column, a "forked from" link ([test page:97-104](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)), and no variations table since 0006.
- **Navigation**: v2 says "Overview · Flows · Runs", with Scan as a header button ([product-context.md:41](docs/product-context.md)). Built: Tests · Settings.
- **Status vocabulary**: v2 says "Broken / Review / OK" ([product-context.md:43](docs/product-context.md)), and core still has it unused ([issues.ts:76-84](packages/core/src/issues.ts)). CLAUDE.md and the UI use Passed / Failed / Couldn't run.
- **Models**: docs say saved flows "replay deterministically with no model calls" ([product-context.md:64-65](docs/product-context.md)). Code uses cached actions first, then the fast model and a model judgement of the result ([pipeline/tests.ts:1-6](packages/engine/src/pipeline/tests.ts)), as CLAUDE.md says.
- **Baseline**: v2 note 8 has an "Accept as new baseline" action ([product-context.md:48-49](docs/product-context.md)). No such action exists, and see the signing section.
- **Scans**: the price model is built on "discovery scans" and "unlimited replays" ([product-context.md:19-20](docs/product-context.md)). No scan entity remains. The leftover is "Your first scan is free."
- **Designs** (text extraction; long pages only partly read):
  - Nav is New scan / Reports / Flows / Signing review / Account.
  - [Flow.html](docs/designs/Flow.html) is a flow with Steps, Runs, Code tabs, Inputs and a "Forks" list.
  - [Flows.html](docs/designs/Flows.html) is a "Flow library" of "saved flows" with steps, signatures and last 10 runs.
  - [Report.html](docs/designs/Report.html) has "Every flow, every edge case. Each cell is one run" and "Save flows as tests".
  - [Signing.html](docs/designs/Signing.html) is a standalone signing page.
  - The mockups still carry the old brand "countersign".
  - The mockups therefore contain three things the build dropped: flow as the leaf unit, the matrix, and reports.
- **Duration**: CLAUDE.md says "In a minute or two"; the code budget is 120s ([analyst.ts:64](packages/engine/src/agent/analyst.ts)); the UI says "Takes 5–7 minutes" ([analysis-panel.tsx:52](apps/web/src/components/tests/analysis-panel.tsx)); the mockup says 10–15 minutes.

CLAUDE.md and README against code:
- Both match in substance. README: "flows and writes a test for each one … adds unhappy paths" ([README.md:4-5](README.md)). The one-test-per-flow wording is only true at analysis time.
- CLAUDE.md lists `AppMap` and `DrillEvent` as core types, but "Events stream through a DrillEventSink" is now mostly log and frame traffic.
- CLAUDE.md's `src/replay/` note ("Replaying recorded actions + unhappy-path conditions") matches.

### Inferences
- The instruction hierarchy in CLAUDE.md ("the v2 UX notes … win") is stale. A redesign should replace product-context's entity sections rather than treat them as requirements.
- The Report matrix is worth a look in the redesign: it presented the same base × condition structure that now lives as child rows, and it answered "which conditions break which paths" at a glance. The current UI can't show that.

### Gaps
- The claude.ai artifacts linked in the doc weren't accessed (out of scope). Long design files were extracted to about 1,800 characters of text per page, so details late in Report.html, Flow.html and Signing.html weren't reviewed.

## How do results roll up, and where does a run sit?

### Takeaway
Nothing rolls up in storage. Each test's state is its own latest `test_runs` row, and the app and flow summaries are computed at render time. A parent test's status does not reflect its unhappy paths, and app and flow summaries hide "Couldn't run". A run is one test once; a "batch" is a shared text id with no row and no page, although several UI labels mean the batch when they say "run".

### Cited Findings
- **Test state**: `stateOf` = drafting, else the latest run status, else never ([status.tsx:33-36](apps/web/src/components/tests/status.tsx)), from `latestRuns` ([db tests.ts:44-52](packages/db/src/tests.ts)).
- **App level**: the header shows host, `plural(tests.length, "test")`, "N failing", "N passing", "last run" ([app page:59-83](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)).
  - `tests` is `all.flatMap(f => f.tests)`, so unhappy paths count as tests ([app page:30](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)).
  - `failing` counts only `fail`; `error` (Couldn't run) is excluded ([app page:41-42](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)).
  - There is no single app status.
- **Flow level**: `flowSummary` returns running / "N failing" / "all passing" / "not run yet" / "N passing" over all of the flow's tests, unhappy included ([app page:158-165](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)). A pass plus a Couldn't-run reads "1 passing".
- **Test level**: the row and the page header show only that test's own state ([app page:107](<apps/web/src/app/(app)/apps/[appId]/page.tsx>), [test page:61](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)). Children appear beside it: on the list, a group that auto-opens on fail, error or active ([app page:172](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)); on the page, an "Unhappy paths" panel.
- **Unhappy path level**: same status vocabulary and same mark as any test. A failed slow-RPC cell and a broken core flow both render as Failed. Severity exists only on `Issue` inside the test page ([run-details.tsx:100-117](apps/web/src/components/tests/run-details.tsx)).
- **Run contents**: `test_runs` row plus `TestRunResult` jsonb, listed in the first section. Steps are positional against the test's current steps, which is why setup falls back to "Step N" if edited ([test page:241-242](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)). Test steps have no equivalent guard ([test page:234](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)). No snapshot of the spec is stored on the run.
- **Batch**:
  - `batchId` from `newId("batch")` ([db tests.ts:63](packages/db/src/tests.ts)) is created for any run request, even a single test.
  - The old `run_batches` table was dropped in 0006.
  - Artifacts sit under `runs/<batchId>` ([worker tests.ts:61](apps/worker/src/jobs/tests.ts), [test page:67](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)).
  - The worker executes a batch serially on one set of forks, with fork state pinned around each test ([api.ts:97](packages/engine/src/api.ts), [flows.ts:1](packages/engine/src/pipeline/flows.ts)).
  - Setup runs once per batch by default, and each run row carries `SetupRunResult` with `reused` and `shared` ([test.ts:113-121](packages/core/src/test.ts)).
- **Run history**: per test only, last 15 ([test page:50](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)). No app-wide list of runs.
- **Alerts**: per batch, tests with status `fail` whose previous finished run was `pass`, including unhappy paths ([notify/index.ts:12-29](apps/worker/src/notify/index.ts)). Text: "N tests stopped passing" with "flow · test" lines ([compose.ts:21-22](apps/worker/src/notify/compose.ts)).
- **CLI rollup**: `fail` and `error` both count as failed and return exit 1 ([run.ts:76-79](packages/cli/src/commands/run.ts)), while the comment in `main.ts` says 2 means "DappDrill couldn't run" ([main.ts](packages/cli/src/main.ts)). JUnit is one suite per flow, one case per test, unhappy paths as flat cases ([junit.ts:4](packages/cli/src/junit.ts), [junit.ts:29](packages/cli/src/junit.ts)).

### Inferences
- "Is my app OK?" has no direct answer today. The closest is "3 failing · 9 passing", which treats a core flow breaking and a missing loading spinner under slow RPC as equal.
- A green check on a happy test beside a red child is the likely source of the "tests and subtests" discomfort: the parent's status means "this path works", not "this path and its conditions".
- Because `name` for a child is only the condition name, alert and JUnit lines read "Trade perps · Slow RPC" and don't say which root test failed. Two roots in one flow can produce identical labels.
- If an app's batch is the thing users think of as "a run", a Runs page needs a real batch entity, or at least a derived one.

### Gaps
- Whether "Stopped" and "Skipped" should count in rollups isn't specified anywhere I found.

## Where do signing reviews, cached actions, schedules and the CLI file attach?

### Takeaway
Signing reviews are JSON inside a run and affect nothing else. Cached actions are JSON inside a test's steps. Schedules are one column on the app. The CLI tests file mirrors flows and tests but is a separate store with its own ids and no link to the database.

### Cited Findings
**Signing reviews**
- Created during a run: `beforeApprove` for agent-driven steps ([steps.ts:53-59](packages/engine/src/pipeline/steps.ts)), replay for cached actions ([steps.ts:60-64](packages/engine/src/pipeline/steps.ts)).
- Stored in `TestRunResult.signingReviews` and shown only in the "Wallet" panel on the test page ([run-details.tsx:17-39](apps/web/src/components/tests/run-details.tsx)). A search of `apps/web/src` for verdict, review and `signingReviews` finds no other consumer.
- The review's `verdict` doesn't touch the test's status: no `Verdict`/`dangerous` reference in `packages/engine/src/pipeline`, `packages/engine/src/replay`, `apps/worker/src` or `packages/cli/src` other than the separate pass/fail `verdict` and the judge's.
- `IssueCategory` has `signing` ([issues.ts:9](packages/core/src/issues.ts)), but a search for `"signing"` in `packages/engine/src` finds no issue created with it. Replay issues use `wallet`, `rpc` or `ui`.
- `expectationProblems`, written on replay wallet records, isn't read anywhere else in the engine ([replay.ts:66-67](packages/engine/src/replay/replay.ts), [replay.ts:300-301](packages/engine/src/replay/replay.ts)).
- `SigningReview.flowId` and `Issue.flowId` hold whatever `flowOf` passed, which is a **test id** ([steps.ts:96-98](packages/engine/src/pipeline/steps.ts)), and for unhappy paths the **base test's** id ([tests.ts:184](packages/engine/src/pipeline/tests.ts)).
- Baselines: neither the worker nor the CLI passes `baselines` (no match in `apps` or `packages/cli`; see [worker tests.ts:61](apps/worker/src/jobs/tests.ts)). So the check "Same as last run" takes the skip branch ([checks.ts:283-284](packages/engine/src/signing/checks.ts)).

**Recorded or cached actions**
- `tests.steps[i].actions` (`Step[]`) ([test.ts:12-16](packages/core/src/test.ts)), matched by normalized step text through `keepActions` ([test.ts:20-30](packages/core/src/test.ts)).
- Saved after each run ([worker tests.ts:95-105](apps/worker/src/jobs/tests.ts)).
- `apps.setup.steps` carries the same shape ([worker tests.ts:108-115](apps/worker/src/jobs/tests.ts)).
- Unhappy paths have none and borrow the base's.
- `tests.proof` is the matching cached proof of the expected result ([test.ts:41-42](packages/core/src/test.ts)).
- The UI doesn't show `via`, so cache vs model isn't visible (no web reference to `.via`), though `did` lines are ([setup-steps.tsx:19](apps/web/src/components/tests/setup-steps.tsx)).

**Schedules**
- `apps.schedule_time` "HH:MM" UTC ([app.ts:136-137](packages/db/src/schema/app.ts)).
- `scheduleTick` queues **every test of the app**, unhappy paths included, as one batch with trigger `schedule`, on verified domains only ([schedule.ts:20-44](apps/worker/src/jobs/schedule.ts)).
- There are no per-flow or per-test schedules.

**CLI tests file**
- `.dappdrill/tests.json` ([main.ts](packages/cli/src/main.ts)): `{url, map?, chains, setup?, flows: [{name, tests: [SavedTest]}]}`, with `SavedTest = TestSpec + baseId` ([files.ts:9-23](packages/cli/src/files.ts)).
- Flows have no id here, and there is no version field.
- `run` writes learned actions and proof back into the same file ([run.ts:24-25](packages/cli/src/commands/run.ts), [run.ts:83-90](packages/cli/src/commands/run.ts)).
- Consumed by the composite action ([action.yml](.github/actions/dappdrill/action.yml)).
- No import or export between this file and the database was found, and `api_tokens` was dropped in 0006.

**Other attachments**
- App setup: `apps.setup`, applied to all tests, with results in each run. Unhappy paths run after it too.
- Assistant: per-app conversation, `context` {testId, flowId}, tools in [agent.ts:95-207](apps/worker/src/jobs/agent.ts).

### Inferences
- The stated product promise, "every signature request is reviewed", is true in the narrow sense, but a Dangerous verdict on a passing test appears to be invisible unless someone opens that test's Wallet panel. The redesign should decide where signing findings surface. This is probably the most important product gap this study found.
- Web and CLI are two parallel copies of the model. A term change must land in both, and neither has a migration story for the other.
- Writing cached actions back into a committed file means that file changes on runs, which would add CI diff noise. This is an inference from `run.ts`; I did not check how the example workflow handles it.

### Gaps
- I did not read `.github/workflows/dappdrill.example.yml` in full, nor the `integrations` GitHub kind beyond noting that the Account page lists only Slack, Telegram and Email ([account page:175-183](<apps/web/src/app/(app)/account/page.tsx>)).

## What are the concrete confusions, and what would a rename or restructure cost?

### Takeaway
The worst collisions are **flow** (a group vs a script), **fork** (a chain copy vs a test copy), **run** (a test execution vs a batch vs a matrix cell), and one concept with four names (**unhappy path / condition / edge case / base child**). A copy-only rename is cheap. Renaming data is moderate and well precedented. Making unhappy paths stop being Test rows is the one structural change with real reach.

### Cited Findings

One term, two or more things:

| Term | Meanings |
|---|---|
| Flow | DB group of tests ([app.ts:187](packages/db/src/schema/app.ts)) · core replay script ([flow.ts:106](packages/core/src/flow.ts)) · `flowId` on Issue and SigningReview that actually holds a test id · a scan-era report row in docs |
| Fork | Anvil chain fork ([new-app-form.tsx:109-113](apps/web/src/components/new-app-form.tsx), `/fork` page) · copy of a test ("Fork", [fork.tsx:39](apps/web/src/components/tests/fork.tsx)) |
| Run | one `test_runs` row (panel "Runs") · a whole batch ("Once per run", "First run", "Daily run", "an earlier test of this run", [test page:244](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)) · `FlowRun` matrix cell · a separate `run_`-prefixed session id ([steps.ts:17](packages/engine/src/pipeline/steps.ts)) |
| Step | `TestStep` plain-English step ([test.ts:12](packages/core/src/test.ts)) · core `Step` browser action ([flow.ts:45](packages/core/src/flow.ts)) · `StepResult` per action vs `TestStepResult` per step |
| Verdict | `TestRunResult.verdict {ok, reason}` ([test.ts:128](packages/core/src/test.ts)) · signing `Verdict` ([signing.ts:35](packages/core/src/signing.ts)) · judge output ([judge.ts:9](packages/engine/src/agent/judge.ts)) |
| Expected | `tests.expected` · `CONDITIONS.expected` · `edge-cases.ts` judge text · `Issue.expected` |
| Setup | `apps.setup` for all tests · `Flow.setup` in core ([flow.ts:113](packages/core/src/flow.ts)) · per-condition setup in `edge-cases.ts` |
| Goal | a text field per test, not a group; a redesign using "Goal" as an entity would collide with `tests.goal` |
| Base | `base_id` (the happy path) vs `forked_from` (the source of a copy) |

Two or more terms, one thing:
- **Unhappy path** (UI, CLI flag) = **condition** (UI, `tests.condition`, `CONDITIONS`) = **edge case** (`EdgeCaseId`, `replay/edge-cases.ts`, judge prompt, site metadata) = **variant** (dead `PlanItem` comment, [run.ts:100](packages/core/src/run.ts)). The labels differ too: CONDITIONS says "Rejected in wallet", "Not enough gas", "Account switched"; EDGE_CASES says "Reject", "Low gas", "Switch account" ([test.ts:158-167](packages/core/src/test.ts), [edge-cases.ts:32-46](packages/core/src/edge-cases.ts)). Default sets also differ: 4 vs 7.
- **Analysis** (table, CLI `analyze`) = **Explore/Exploring** (UI) = **"Finding the main flows"** (UI) = **scan** (auth card, comments in [sink.ts:6](apps/worker/src/jobs/sink.ts), Stalled docs).
- **Issue** (type, docs) = **Problems found** (UI).
- **Assistant** (UI) = **agent** (`agent_messages`, trigger, queue).
- **Happy path** (code, prompts) = **test** with no marker (UI) = **base** (schema).

Data with no UI:
- `apps.map`: no web reference.
- `analyses` history: latest only ([app page:29](<apps/web/src/app/(app)/apps/[appId]/page.tsx>)).
- Costs: `analyses.costUsd` and `result.costUsd`, no web reference.
- `proof`.
- `via`.
- Batches.
- Skip reasons.
- Issue fingerprints: stored, no "new since last run" logic found in the web or worker.
- Baseline fields.
- `integrations.kind = github`.

UI concepts with no data:
- "Run" as a batch.
- The unhappy-path group.
- App or flow health.

Behaviour that surprises (restating the strongest):
- Editable expected on a child has no effect.
- `forked_from` isn't an FK, so the link silently vanishes on delete ([test page:51](<apps/web/src/app/(app)/apps/[appId]/tests/[testId]/page.tsx>)).
- Web and assistant fork paths differ: name `base.name` at end of flow vs `"… (fork)"` at `base.position` ([actions/tests.ts:125-137](apps/web/src/actions/tests.ts), [agent.ts:151](apps/worker/src/jobs/agent.ts)).
- Unhappy path logic exists twice, in `db/tests.ts` and `cli/run.ts`.

Rename surface, by grep over `apps/*/src`, `apps/worker/test`, `packages/*/src`, and `packages/{cli,engine}/test`:

| Pattern | Files | Lines |
|---|---|---|
| `\bflows?\b\|Flow` | 59 | 433 |
| `EdgeCase\|edgeCase\|edge-case` | 22 | 108 |
| `condition\|Condition\|CONDITIONS` | 13 | 70 |
| `unhappy\|Unhappy` | 19 | 66 |
| `baseId\|base_id` | 10 | 36 |

Flow counts mix both meanings. 26 files in web, worker, db, cli and `core/test.ts` touch the group sense.

Cost tiers:

1. **Copy only** (e.g. "Unhappy paths" to another label, "Fork" to "Duplicate"): about 10–20 strings in the web UI plus the assistant prompt ([chat.ts:13](packages/engine/src/agent/chat.ts)). No migration, no contract change. Cheap.
2. **Clean up dead model and internal names**: delete unused types in `core/run.ts` and `flow.ts`; rename core `Flow` to a replay-script name; rename `Issue.flowId`/`SigningReview.flowId`. Engine-only, covered by engine tests. Moderate, and no user impact.
3. **DB rename** (`flows` to something else, `base_id`, `condition`): simple Drizzle migration, but also `agent_messages.context` jsonb keys, and `agent_messages.links` which persist hrefs like `/apps/:id/tests/:id` ([agent.ts:79](apps/worker/src/jobs/agent.ts)), so any URL change breaks old chat links. `test_runs.result` jsonb is unversioned, and renames inside it need a backfill or zod aliases. Precedent: the team dropped and recreated the whole model yesterday.
4. **Engine contract**: `analyze` returns `flows: FlowDraft[]`, `runTests` takes `TestItem {spec, base}`, `writeTest` takes `flowName` ([api.ts:40-50](packages/engine/src/api.ts), [pipeline/tests.ts:30-36](packages/engine/src/pipeline/tests.ts), [writer.ts:16-24](packages/engine/src/agent/writer.ts)). Changing these means updating worker, CLI, the fake engine, the prompts in `analyst.ts`, `writer.ts`, `chat.ts`, and assistant tool names (`add_unhappy_paths`, `list_tests`, …). Moderate. Only four functions cross the boundary, which helps.
5. **CLI file format**: `TestsFile.flows[].tests[]` has no version field, and `loadTests` rejects unknown shapes with a hard error ([files.ts:33-37](packages/cli/src/files.ts)), so any rename breaks committed files unless the loader accepts both. Also affected: `--unhappy`, `--only` ("flow or name"), the GitHub action input `unhappy`, JUnit `classname`=flow and `name`=test (changes CI test history keys), and [files.test.ts](packages/cli/test/files.test.ts). This is the only externally persisted format, so it needs the most care if real users have it.
6. **Structural: unhappy paths as (test, condition) rather than rows**: `test_runs` would need a `condition` column; `latestRuns` keys on testId ([db tests.ts:44-52](packages/db/src/tests.ts)); `queueRuns`, the worker's byTest/runOf maps, `TestItem`, `TestOutcome`, `stateOf`, the test page route, CLI `SavedTest`, JUnit and notifications all assume one test = one row = one latest status. Largest change, but it would delete dead fields, fix the editable-expected trap, and allow a matrix view.
7. **Adding a Goal level above Flow, or a real batch entity**: additive, one new table plus nullable FK, and cheap in schema terms. Cost is in UI and in deciding what analysis produces (`FlowDraft` shape, prompt, `min(1).max(3)`). A batch table is close to free: `batch_id` already exists on every run, and the old `run_batches` table is a precedent.

### Inferences
- Before debating goals vs flows vs tests, the cheapest high-value moves are: pick one word for the unhappy-path concept, rename the test copy action so it doesn't say "Fork", and separate "run" (one test) from a named batch.
- If the target is "Flow = what users do, Test = a path through it, condition = a stress on a path", most of the schema already fits. The main change is treating conditions as a run dimension instead of as child tests, plus defining what rolls up to a flow.
- These estimates are relative judgements from code reach, not measured effort.

### Gaps
- Whether any external users hold committed `tests.json` files or production data is unknown, and it is the main driver of tiers 3 and 5.
- `.github/workflows/dappdrill.example.yml` wasn't checked for assumptions about file names.
