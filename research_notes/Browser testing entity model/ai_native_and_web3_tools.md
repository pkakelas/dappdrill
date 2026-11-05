# Entity models in AI-native / agent-driven browser testing and web3 dApp testing tools

Research date: 2026-11-05. Evidence labels used below:
- **[Docs]**: read in the product's own docs.
- **[Marketing]**: vendor site claim only, not confirmed in docs.
- **[Secondary]**: third party, or a competitor.
- **[Excerpt]**: taken from a search result excerpt; the page itself was not opened.
- **[Repo]**: read from the GitHub API or source on 2026-11-05.

## For each product, what is the exact entity hierarchy and vocabulary in its UI and docs?

### Takeaway
"Test case" and "run" are near-universal, but the words above and below them are not. "Scenario", "test plan" and "flow" each mean at least three different things across products. The strongest mid-level entities are QA Wolf's Group > Flow and TestSprite's Feature > Use Case > Test Case. QA.tech's test shape (name, goal, optional expected result, generated steps) is almost exactly DappDrill's.

### Cited Findings

**Per-product hierarchy (products' own words)**

| Product | Status | Hierarchy / core nouns | Evidence |
|---|---|---|---|
| QA Wolf | Active | Workspace > Environment > Group > Flow > Test. Also Coverage outline (groups + flow stubs), Coverage map, Run > Attempt, Tag, Run Rule, Trigger, Schedule, Smart Smoke Suite. A Flow is "a sequence of tests that validates one user journey" and the main unit; a Test checks one behaviour. Flows follow Arrange-Act-Assert. Flows and tests are not shared across environments. | [Docs: Glossary](https://docs.qawolf.com/qawolf/Glossary.md) |
| Momentic | Active | Test (a YAML file in the repo) > Step, where a step is a Preset step, AI action or Module call. Also Module, Variables, Labels (`smoke`, `regression`, `owner:payments`), Environment, Target, Run, Run group. There is no dedicated Suites page; labels and directories slice tests. Separate product **Mo**: Session > Report > Verdicts + Findings (`bug` or `flag`) > Triage decisions. | [Docs: How Momentic works](https://momentic.ai/docs/get-started/how-momentic-works.md); [Test organization](https://momentic.ai/docs/best-practices/test-organization.md); [Index](https://momentic.ai/docs/llms.txt); [Mo reports](https://momentic.ai/docs/mo/reports.md) |
| QA.tech | Active | Project, Application, Environment. Scenario (a group on the Test Cases page, e.g. "Checkout Flow") > Test case (name, goal, optional expected result, configs, dependencies, agent settings) > generated steps. Also Test plan, Test run, Issue, Shared Steps, Dependencies, Draft, Revision, Crawling session > Iteration, Knowledge graph, Coverage map, Agents. | [Creating tests](https://docs.qa.tech/best-practices/creating-tests.md); [Overview](https://docs.qa.tech); [Test plans](https://docs.qa.tech/core-concepts/test-plans.md); [Crawling](https://docs.qa.tech/core-concepts/crawling.md) |
| TestSprite | Active | Project > Feature > Use Case > Test Case > steps (Actions and Assertions). Also Sources (PRD, API docs), Test Coverage tab, Test Plan, Test Lists (cross-project groups), Test Schedules, Insights, Chats. | [Coverage map](https://docs.testsprite.com/web-portal/core/working-with-test/coverage-map.md); [Lifecycle](https://docs.testsprite.com/web-portal/concepts/testing-lifecycle); [Plan generation](https://docs.testsprite.com/web-portal/core/ui/ui-plan-gen.md); [Index](https://docs.testsprite.com/llms.txt) |
| Spur | Active | Test Library > Folder > Test Suite > Test > Step. Test Plan combines several suites across environments and viewports ("the recommended way to execute and review your tests"). Also Scenario Table (rows = scenarios, columns = properties), Environment, Draft, Snooze, Run, Prompt, Preview Editor, PR Agent. | [Managing tests](https://docs.spurtest.com/managing-tests/overview.md); [Scenario Tables](https://docs.spurtest.com/authoring-tests/scenarios/scenario-tables.md); [Index](https://docs.spurtest.com/llms.txt) |
| Bug0 | Active | Project > Test Suite (incl. Login Suite, Cleanup Suite) > Test Case > Steps + Assertions. Each case holds Draft and Published versions. Statuses: Draft, Active, Archived. "A test case represents a single test scenario." Also Placeholders, Live Preview. | [Test cases](https://docs.bug0.com/concepts/test-cases); [Test suites](https://docs.bug0.com/concepts/test-suites); [Creating tests](https://docs.bug0.com/creating-tests) |
| Autify (two products) | Active; Nexus AI is experimental | **Nexus:** Test cases (generated, saved as CSV) are separate from Scenarios (recorded/automated) > Steps; Test result; Test plans via MCP. "All Nexus AI Agent features are experimental" and need a contract option. **Aximo:** Workspace > Sessions; a scenario is natural-language instructions; "Save successful sessions as cases"; Plans rerun cases on a schedule. | [Nexus AI agent](https://helpcenter.autify.com/docs/nexus-ai-agent); [Nexus MCP, Excerpt](https://helpcenter.autify.com/docs/nexus-mcp-server); [Aximo quick start](https://help.aximo.autify.com/quick-start) |
| testRigor | Active | Test Suite (top-level; has URL, credentials, OS/browser, App Description) > Test Cases > plain-English steps. Reusable Rules are named subroutines; an unknown statement can become an AI-based rule. Also Global Variables and Data Sets. | [Vendor blog](https://testrigor.com/blog/how-to-use-testrigor/); [Rules how-to, Excerpt](https://testrigor.com/how-to-articles/how-to-create-ai-based-reusable-rules-using-testrigor/) |
| Reflect (SmartBear) | Active; docs moved to SmartBear | Test > steps; Segment (named reusable step sequence, no nesting); Suite ("test execution, environment configuration and notifications" as one unit); prompt steps of type action, assert, query. | [Docs home](https://support.smartbear.com/reflect/docs/); [Segments, Excerpt](https://support.smartbear.com/reflect/docs/en/recording/segments---composition); [Quick start, Excerpt](https://support.smartbear.com/reflect/docs/en/overview/quick-start.html); [MCP, Excerpt](https://developer.smartbear.com/smartbear-mcp/docs/reflect-integration) |
| Meticulous | Active; not a goal-based product | Session (recorded user journey) > Golden Set / Selected Sessions (typically 200-500). Test Run (per commit) > Replay > Screenshot > Diff (unapproved, approved, rejected). Base / Head. | [Docs: Glossary](https://app.meticulous.ai/docs/concepts/glossary.md) |
| Checksum | Active; marketing only | End-to-End Agent and API Agent. Tests are Playwright code in the customer repo; pricing unit is Workflows; "Auto Recovery"; healing arrives as PRs. "Feature Health Dashboard" appears only as an image asset name. | [Marketing: homepage](https://checksum.ai) |
| Shortest | Open source; low activity | `shortest("plain English")` is the test; `.after()` callback; `beforeAll/beforeEach/afterEach/afterAll`; arrays of step strings chain flows. No caching mentioned in README. Not archived; last default-branch commit 2026-05-21. | [README](https://github.com/antiwork/shortest); [Repo](https://api.github.com/repos/antiwork/shortest) |
| Stagehand / Browserbase | Active; SDK, not a test product | No test entity. Primitives: `act`, `observe`, `extract`, `agent`; an `Action` returned by `observe` replays with no inference. | [Docs, Excerpt](https://docs.stagehand.dev/v4/basics/act); [Caching, Excerpt](https://docs.stagehand.dev/v4/best-practices/caching) |
| Octomind | **Shut down** (service ended end of May 2026) | Historic terms: Auto-discovery, Flows, Test cases, Auto-fix, Suites, Root cause analysis. | [Secondary: Ry Walker](https://rywalker.com/research/octomind); [Secondary, competitor: Bug0](https://bug0.com/knowledge-base/octomind-ai-testing-platform-features) |
| Ranger (added) | Active | Feature Review > Scenario; Profile (where testing happens and how the agent logs in). "A scenario is a short, concrete user flow with an expected result." | [Docs: Scenarios](https://docs.ranger.net/concepts/scenarios); [Quickstart, Excerpt](https://docs.ranger.net/getting-started/quickstart/) |
| Datadog Goal-Based tests (added) | Active | Goal (plain-language prompt) + starting URL. A run explores branches and ends Pass or Fail with a summary "explaining the rationale". | [Docs](https://docs.datadoghq.com/synthetics/goal_based_testing/) |
| Autosana (added) | Active; docs thin | "describing scenarios in natural language". Flows, suites, hooks, runs are not in its LLM index. | [llms.txt](https://autosana.ai/llms.txt) |

**Overloaded words**

- "Scenario" means a group of test cases in [QA.tech](https://docs.qa.tech/core-concepts/tests-and-results.md), one data row in [Spur](https://docs.spurtest.com/authoring-tests/scenarios/scenario-tables.md), the test itself in [Ranger](https://docs.ranger.net/concepts/scenarios), a recorded automation in [Autify Nexus](https://helpcenter.autify.com/docs/nexus-ai-agent), and the instruction text in [Aximo](https://help.aximo.autify.com/quick-start).
- "Test plan" means a saved group of tests in [QA.tech](https://docs.qa.tech/core-concepts/test-plans.md), a multi-suite run in [Spur](https://docs.spurtest.com/managing-tests/overview.md), and an agent's proposed list of cases in [TestSprite](https://docs.testsprite.com/web-portal/core/ui/ui-plan-gen.md).
- "Flow" is QA Wolf's main unit ([Glossary](https://docs.qawolf.com/qawolf/Glossary.md)). In Momentic, "Flows" is a type of Knowledge base entry ([goal-based testing](https://momentic.ai/docs/best-practices/goal-based-testing.md)).

**Status flags**

- Octomind's shutdown: the Ry Walker profile cites a farewell letter of 2026-04-23, service end at end of May 2026, company closure at end of June 2026, and the reason "didn't find the market validation we needed to keep going" ([Secondary](https://rywalker.com/research/octomind)). I did not read the letter. `octomind.dev` failed DNS resolution when fetched on 2026-11-05. One aggregator gives a 2025 wind-down date ([Distill](https://distillintelligence.com/news/octomind)), which looks like a typo.
- QA.tech's [Tests and Results](https://docs.qa.tech/core-concepts/tests-and-results.md) page says a run executes "the selected scenarios", while [Test plans](https://docs.qa.tech/core-concepts/test-plans.md) describes plans as the run unit. The first page may be older language.
- Reflect's product page now says "Agentic Test Automation" ([SmartBear](https://smartbear.com/product/reflect/)); `reflect.run/docs` redirects to `support.smartbear.com/reflect/docs/`.

### Inferences
- DappDrill's "one test per flow, with goal, expected result, short steps" matches QA.tech's guidance closely ("A user story or user journey should probably map 1:1 to a test case", "Keep tests to 10 steps or less", per [Creating tests](https://docs.qa.tech/best-practices/creating-tests.md)).
- "Scenario" and "test plan" are poor choices for a plain-language product, because the market gives them conflicting meanings. "Flow" and "test" are the safest pair, with flow as the user journey and test as the checkable thing.
- Products aimed at non-QA users (TestSprite, QA Wolf) have a named level above the test. Products aimed at developers (Momentic, Shortest) rely on files and labels.

### Gaps
- Exact Project / Application / Environment relationship in QA.tech was not read.
- No UI screenshots were reviewed. All vocabulary comes from text docs.
- Checksum has no public concept docs that I could find.
- Octomind's own docs were unreachable, and web.archive.org could not be fetched with the tool available.

## When an agent discovers an app, what does it produce?

### Takeaway
There are four output shapes: a graph of pages and interactions, a two-level map of areas and journeys, a suggestion list of tests, and a one-off session report. The two most useful ideas are QA Wolf's scope-only "flow stubs" and TestSprite's editable feature map, both of which separate "what should be tested" from "tests that exist".

### Cited Findings
- **QA Wolf.** Pointing an agent at the app produces a **coverage outline**: groups and flow stubs defining what needs testing in an environment. It "records scope only" with no test code until flows are created. The **coverage map** is its visual view, used to spot gaps — [Glossary](https://docs.qawolf.com/qawolf/Glossary.md). Setup is chat-driven: a "create a test plan" prompt with a URL builds groups and stubs, and asks for credentials at login — [Docs, Excerpt](https://docs.qawolf.com/qawolf/Map-your-app-s-workflows-2a45b2a994fb80ca8a87c8fdc2a443fc).
- QA Wolf marketing describes "A map of your app" as "pages, actions, flows" — [Marketing](https://www.qawolf.com/mapping-ai). The "200+ test cases in minutes" figure is a vendor claim — [Marketing](https://www.qawolf.com/service/ai-testing-as-a-service). A search excerpt showed "join early access" on the mapping page, while my fetch showed "Start now"; availability is unclear.
- **TestSprite.** UI projects "explore your live app" and API projects "discover endpoints". Features and use cases appear on Test Coverage, where "you can edit them". After **Plan Tests**, the agent "plans test cases scoped to the feature map. You keep, edit, or remove them" — [Lifecycle](https://docs.testsprite.com/web-portal/concepts/testing-lifecycle).
- TestSprite shows a live panel headed "AI agent exploring your app" with per-agent status (Starting, Logging in, Exploring, Done, Failed) and a live browser preview. Each run keeps a recording and captured pages. About 3 minutes for an average app. Paywalled features are flagged. If exploration is partial it falls back to the PRD — [Feature exploration](https://docs.testsprite.com/web-portal/core/ui/feature-exploration.md).
- **QA.tech.** A **crawling session** explores "pages and interactions" and "improves test suggestions and agent performance". It is shown as **iterations** (screenshot, action, depth, interactive elements, intent score) and a **Coverage map** of discovered pages — [Crawling](https://docs.qa.tech/core-concepts/crawling.md).
- QA.tech's **knowledge graph** is a sitemap "on steroids": blue nodes are pages, purple nodes are past interactions — [Knowledge Graph](https://docs.qa.tech/core-concepts/knowledge-graph.md).
- QA.tech's assistant turns the graph into "interactive suggestions" committed with "Add Selected Tests", and it will "Prioritize revenue-critical flows first" — [AI Chat Assistant](https://docs.qa.tech/core-concepts/ai-chat-assistant.md). The API has a [feature graph](https://docs.qa.tech/api-reference/features/list-features.md) endpoint.
- **Momentic Mo.** Exploration yields a session report, not tests. "an exploratory session can check different flows on a later run", and repo tests are for repeatable checks — [When to use Mo](https://momentic.ai/docs/mo/why-mo.md). The report holds verdicts, each with verified parts and gaps, plus findings — [Reports](https://momentic.ai/docs/mo/reports.md).
- **Octomind (historic).** The agent crawled and proposed test cases that users approved — [Secondary](https://rywalker.com/research/octomind). A search summary also said a new project got a few suggested starter tests, but it did not identify the source page, so treat that detail as unconfirmed.
- **Meticulous.** Discovery is passive. Real sessions are recorded and a golden set is chosen — [Glossary](https://app.meticulous.ai/docs/concepts/glossary.md) — by code coverage, page coverage, flow diversity and recency — [Excerpt](https://app.meticulous.ai/docs/concepts/architecture-overview.md).
- **Checksum.** Older listings describe detecting flows from real usage, "both happy paths and edge cases" — [Secondary, listing](https://webcatalog.io/es/apps/checksum). The current homepage instead says it monitors production errors and turns bugs into tests — [Marketing](https://checksum.ai).
- **Autify Nexus and testRigor** start from a written input, not exploration: feature specs ([Nexus, Excerpt](https://helpcenter.autify.com/docs/nexus-ai-agent)) or an "App Description" ([testRigor](https://testrigor.com/blog/how-to-use-testrigor/)).

### Inferences
- DappDrill's app map matches the QA Wolf / TestSprite shape better than the QA.tech page graph. A founder wants "areas and journeys", while a page graph is mainly agent memory.
- A stub-like state (flow found, no test yet) gives a coverage denominator without any test existing. That denominator is what makes coverage legible later.
- Nobody in this set presents discovery as final. All of them add a human keep/edit/remove step, except QA.tech onboarding, which activates tests made during project setup ([Test drafts](https://docs.qa.tech/core-concepts/test-drafts.md)).

### Gaps
- How much edit control QA Wolf's coverage map gives a customer versus their QA lead. A direct fetch of the doc page returned 404.
- Whether Ranger or Autosana do any autonomous discovery. Ranger's scenarios are usually written by a coding agent, so it appears not to.

## Do these products use goal-based or intent-based entities, and how do they separate intent from cached steps and show self-healing?

### Takeaway
Yes, and the common pattern is: intent is the source of truth, a cache of resolved actions speeds replay, and the AI is the fallback. Products split on whether healing is temporary, automatically stored in a cache, or a reviewed change. The clearest line comes from Momentic and TestSprite: run-time healing does not edit the saved test.

### Cited Findings

**Intent models**
- **QA.tech.** "The goal is the main objective of the test" and should describe actions, not checks. "The expected result defines what the agent should verify at the end of the test." The agent then "automatically attempts to execute it and generate test steps", which you can edit — [Creating tests](https://docs.qa.tech/best-practices/creating-tests.md).
- **Momentic.** Tests mix **preset steps** and **AI actions**: "Use preset steps when the path needs exact, reviewable control and AI actions when the goal matters more than the path" — [How Momentic works](https://momentic.ai/docs/get-started/how-momentic-works.md).
- An AI action has a **goal**, **precondition** and **postcondition**. Add a postcondition to every state-changing action: "Describe a durable outcome, not a brief animation, spinner, or toast." A goal should be one user intent with a clear stopping point — [Goal-based testing](https://momentic.ai/docs/best-practices/goal-based-testing.md).
- **Ranger.** Scenarios are "guidance more than a script" — [Scenarios](https://docs.ranger.net/concepts/scenarios).
- **Datadog.** A goal-based test "doesn't follow a fixed, recorded set of steps"; the agent tries "multiple paths toward the goal" and passes if a branch reaches it — [Docs](https://docs.datadoghq.com/synthetics/goal_based_testing/).
- **Bug0.** Marketing heading "Capture intent, not steps" — [qa-agent page](https://bug0.com/p/qa-agent). Yet its docs model a test as Draft and Published **steps** — [Test cases](https://docs.bug0.com/concepts/test-cases).
- **TestSprite.** In the plan, the test description "is what drives generation" — [Plan generation](https://docs.testsprite.com/web-portal/core/ui/ui-plan-gen.md).
- **Aximo.** A good prompt has a starting point, action steps and expected result. If information is missing the tester does not guess and fails with a reason — [Writing prompts, Excerpt](https://help.aximo.autify.com/test-case-creation/writing-prompts).

**Cache**
- **Momentic.** "Later runs replay that path instead of planning it again." If a cached path breaks, recovery can clear it and re-plan — [Goal-based testing](https://momentic.ai/docs/best-practices/goal-based-testing.md). Run pages show a Cache section on steps that use element location — [Results](https://momentic.ai/docs/running-tests/results.md).
- **QA.tech Agent Cache (BETA).** Caches "AI reasoning decisions - which element to click, what text to type, how to navigate", while browser actions and verification still run live. Keys include visible page content, entries expire after 30 days, and failed runs never save. No cache-hit indicator is documented. It is a per-test setting — [Agent Cache](https://docs.qa.tech/core-concepts/agent-cache.md).
- **Spur.** Opt-in "Cached" checkbox, per-step invalidation when a step is edited, off by default — [Caching Tests](https://docs.spurtest.com/authoring-tests/caching-tests.md).
- **Bug0.** Steps are looked up by flow and description; a hit replays a stored Playwright action. The AI is "the fallback, not the hot path" — [qa-agent](https://bug0.com/p/qa-agent). The engine is public at [bug0inc/qa-agent](https://github.com/bug0inc/qa-agent) (last push 2026-09-25, [Repo](https://api.github.com/repos/bug0inc/qa-agent)).
- **Stagehand.** `selfHeal` re-infers and retries once. Cached `act()` replays with self-healing off and falls back to full inference — [Excerpt](https://docs.stagehand.dev/v4/best-practices/caching).

**Showing healing**
- **Momentic's four-rung ladder** — [AI test maintenance](https://momentic.ai/docs/reliability/auto-maintenance.md):
  1. Locator auto-healing: "applies to the current run and never edits the test".
  2. Failure recovery: temporary steps, maximum three per run, not for product regressions. "Frequent recovery is a flakiness signal."
  3. Permanent healing: classification (heal, warn, fail) then triage, with a repair delivered by default as a pull request recording "root cause, fix, and validation". Triage is skipped at 20+ failures and 50%+ failing, since that suggests an outage.
  4. Quarantine: "keeps a flaky test running without failing the build".
- Momentic's JSON report has a `recovered` field and run statuses include flaky and quarantined — [Results](https://momentic.ai/docs/running-tests/results.md).
- **TestSprite Auto-Heal.** Drift ("UI moved, flow still correct") recovers and "is marked **Passed**"; a real bug "stays Failed". "Auto-Heal absorbs UI drift; it doesn't make tests pass." The saved test stays the source of truth unless updates are explicitly saved. No badge or diff is documented — [Auto-Heal](https://docs.testsprite.com/web-portal/core/ui/auto-heal.md). Insights counts "Fixed by agent" — [Insights](https://docs.testsprite.com/web-portal/results/project-overview.md).
- **QA.tech.** The regression review agent "never edits, creates or archives tests during a review. It reports what should change", under **Tests to update** — [Regression review agent](https://docs.qa.tech/regression-testing/regression-review-agent.md). Each save makes a revision — [Test drafts](https://docs.qa.tech/core-concepts/test-drafts.md).
- **Spur PR Agent.** Offers generated tests, temporary PR-specific checks, and suggested edits. "The saved test stays the same until you edit it" — [PR Agent results](https://docs.spurtest.com/running-tests/cicd/pr-agent-results.md).
- **Checksum.** Healing is a PR to approve or reject; about 70% of failures resolved without humans is a vendor claim — [Marketing](https://checksum.ai).
- **QA Wolf.** Agents flag failures from intentional changes and a human QA lead decides test versus product — [Marketing](https://www.qawolf.com/service/test-automation-services).
- **Autify Nexus.** Manual trigger, "Fix with AI" on a failed step — [Nexus AI agent](https://helpcenter.autify.com/docs/nexus-ai-agent).
- **testRigor.** Rules can adapt with Vision AI and those runs are flagged for review — [Excerpt](https://testrigor.com/how-to-articles/how-to-create-ai-based-reusable-rules-using-testrigor/).

### Inferences
- The durable user-facing entity is intent (goal + expected result). Cached actions are an implementation detail that most products barely expose. DappDrill can do the same: treat cached actions as a run detail, and show them only when they stop working.
- A healed pass needs its own quiet signal. Passing silently (TestSprite) hides drift; Momentic's "recovered" and "frequent recovery is a flakiness signal" is the better model.
- Momentic's "durable outcome" rule fits web3 well: a toast is weak evidence, on-chain state is strong evidence.

### Gaps
- No product documents a user-visible "this run used the cache / this step was re-decided" indicator in much detail, apart from Momentic's Cache section. I could not confirm how any of these look without screenshots.

## How do they represent negative paths, edge cases and variants of a flow?

### Takeaway
No product I found has a first-class "unhappy variant of this flow" entity. Negative paths are ordinary sibling test cases, sometimes grouped or labelled. Variant mechanisms exist only for data (Spur), wallets (walletqa) or environments, so DappDrill's derived children would be a real differentiator and would need their own naming.

### Cited Findings
- **QA.tech.** Scenarios group related cases, and the docs' example pairs a successful purchase with a payment using an expired card, labelled positive or negative — [Tests and Results](https://docs.qa.tech/core-concepts/tests-and-results.md). Beyond a "Log in with incorrect credentials" example, the creating-tests page gives no negative guidance — [Creating tests](https://docs.qa.tech/best-practices/creating-tests.md).
- **TestSprite.** Plan rows are cases under a use case, with priority and no documented happy/negative split. "Forgot Password" may get a couple of cases and "Checkout" 10 or more — [Plan generation](https://docs.testsprite.com/web-portal/core/ui/ui-plan-gen.md). Edge cases "come from real screens" — [Feature exploration](https://docs.testsprite.com/web-portal/core/ui/feature-exploration.md).
- TestSprite's category lists conflict. MCP tools list "Form validation scenarios" and "Error handling scenarios" — [Tools](https://docs.testsprite.com/mcp/core/tools.md). Another MCP page lists Functional, UI/UX, Security, Performance with High/Medium/Low priority — [Excerpt](https://docs.testsprite.com/mcp/core/create-tests-new-project). The portal groups by use case instead.
- **Spur Scenario Tables.** One test runs across up to 1,000 data rows, attached to suites. Run History is "broken down by scenario" — [Scenario Tables](https://docs.spurtest.com/authoring-tests/scenarios/scenario-tables.md). These are data variants, not behavioural ones.
- **Spur** also has "Persona-Based Tests" and "Exploratory Tests" prompt patterns — [Index](https://docs.spurtest.com/llms.txt).
- **Momentic.** Labels, directories and Targets slice tests; negative paths and variants are not addressed — [Test organization](https://momentic.ai/docs/best-practices/test-organization.md). Mo verdicts list "gaps it could not close" — [Reports](https://momentic.ai/docs/mo/reports.md).
- **QA Wolf.** Tags express run intent; flows live in groups — [Glossary](https://docs.qawolf.com/qawolf/Glossary.md). Nothing specific to negative paths was found.
- **testRigor.** Data Sets support "data-driven testing" — [Vendor blog](https://testrigor.com/blog/how-to-use-testrigor/).
- **Ranger.** Advises against compound conditions, so each variant would be its own scenario — [Scenarios](https://docs.ranger.net/concepts/scenarios).
- **Web3 analogues.**
  - walletqa's `createMultiWalletTest` "generates one test variant per wallet" and uses a `@reject` tag — [pkgstats](https://www.pkgstats.com/pkg:walletqa).
  - wagmi's mock connector exposes failure flags (`connectError`, `signMessageError`, `signTypedDataError`, `switchChainError`) and accepts viem's `UserRejectedRequestError` — [wagmi, Excerpt](https://wagmi.sh/core/connectors/mock).
- **Vendor view.** Autosana's blog says most web3 mobile coverage stops at the happy path — [Vendor blog, Excerpt](https://blog.autosana.ai/use-cases/ai-testing-crypto-web3-mobile-apps).

### Inferences
- Modelling an unhappy path as a child of its happy test (flow > happy test > conditions) has no direct precedent, so DappDrill must teach it. Keep the labels concrete ("If the wallet rejects", "On the wrong network") rather than importing "negative test".
- The generator pattern (one base test crossed with a list of conditions) resembles Spur's table and walletqa's per-wallet variants. A results view "broken down by condition" would mirror Spur's Run History.

### Gaps
- I found no doc from any product describing automatic derivation of negative tests from an existing happy test. Absence in docs is not proof it doesn't exist in a UI or a prompt feature.

## How do they present coverage to a non-QA person, and what is the main dashboard unit?

### Takeaway
TestSprite and QA Wolf are the only ones with a clearly documented non-QA view: a map coloured by results, or one status per environment. Coverage is almost always "journeys or use cases covered", not code coverage. Meticulous is the code-coverage exception.

### Cited Findings
- **TestSprite Coverage Map.** Project > Feature > Use Case > Test Cases. Each use case node is coloured: green all passed, red at least one failed, amber mixed or blocked, blue running, gray never run. Red on critical flows is a release blocker. Missing items are added with "+", which generates tests — [Coverage map](https://docs.testsprite.com/web-portal/core/working-with-test/coverage-map.md).
- **TestSprite Insights.** "your project's health report" answering what needs attention, how quality is trending, what happened lately. It has a Next step card, Issues to Fix grouped by root cause, and **Use Case Coverage** split into Covered, Planned, Gap, with per-suite pass rates — [Insights](https://docs.testsprite.com/web-portal/results/project-overview.md).
- **QA Wolf.** Environment status is Ready, Needs investigation or Failed, with high or urgent bugs driving Failed — [Glossary](https://docs.qawolf.com/qawolf/Glossary.md). Marketing targets "80%+" end-to-end coverage, but the pages do not explain how it is measured and give conflicting timelines — [Marketing](https://www.qawolf.com/service/software-testing-services); [Marketing](https://www.qawolf.com/service/qa-company).
- **QA.tech.** The review verdict is Verified, Needs attention or Broken, decided "from what the test plan is meant to prove, not by counting red tests" — [Regression review agent](https://docs.qa.tech/regression-testing/regression-review-agent.md). There is also a [Time Saved](https://docs.qa.tech/core-concepts/time-saved.md) page and [Status Badges](https://docs.qa.tech/integrations/status-badges.md) in the index — [Index](https://docs.qa.tech/llms.txt).
- **Momentic Mo.** Coverage is reviewed through verdicts: controls marked checked, failed, partial or out of scope — [Reports](https://momentic.ai/docs/mo/reports.md).
- **Meticulous.** Per-file and per-folder JS coverage from a "View coverage & snapshots" button — [Excerpt, exact page within the docs not confirmed](https://app.meticulous.ai/docs/how-to/testing-pool.md).
- **Checksum.** "Feature Health Dashboard" is named only in an image asset — [Marketing](https://checksum.ai). Treat as unconfirmed.
- **Spur.** Test Overview shows counts by status, with latest result per test — [Test Overview](https://docs.spurtest.com/analysing-tests/test-overview-page.md).

### Inferences
- The best founder-level unit is a user-recognisable capability (feature, use case, flow), not a test or run. TestSprite's Covered / Planned / Gap is the closest match to a founder's question, "what's protected, what's not".
- QA.tech's verdict logic is worth borrowing: one sentence judged against intent, not a percentage.
- DappDrill's rule that only problems get colour conflicts with TestSprite's green nodes, but gray/never-run and amber/blocked map directly to "Not run yet" and "Couldn't run".

### Gaps
- No dashboard screenshots were reviewed, so layout claims are limited to what the docs describe.
- Momentic's analytics UI (pass rate, flakiness trends) is not covered on the pages read, though analytics APIs exist — [Index](https://momentic.ai/docs/llms.txt).

## How do they present results: a run of a suite, a per-test history, a pass rate?

### Takeaway
The primary object is a run of a group (plan, list, suite or PR), with a per-test drill-down to steps, video and trace. The newer pattern is an agent review layered on top of raw failures. Most products have a third outcome beyond pass and fail meaning "couldn't tell", which matches DappDrill's "Couldn't run".

### Cited Findings
- **Momentic.** Runs view with status, duration, cost, environment, branch, trigger. Statuses: "pass, fail, flaky, quarantined, cancelled". Run page lists steps with artifacts. Run groups are "an eventually consistent group, not a finalized batch" — [Results](https://momentic.ai/docs/running-tests/results.md).
- **QA Wolf.** A run is one or more flows, retried up to three attempts, each with its own video, logs and results. Run status: Completed, Needs investigation, Canceled. A failed flow resolves by passing later, by being fixed, or by a maintenance report — [Glossary](https://docs.qawolf.com/qawolf/Glossary.md).
- **QA.tech.** Result is PASSED, FAILED, SKIPPED; execution status is INITIATED, RUNNING, COMPLETED, ERROR, CANCELLED — [Tests and Results](https://docs.qa.tech/core-concepts/tests-and-results.md).
- **QA.tech Issues.** A failed test, console error or accessibility violation creates an **Issue**, linked to case and run. Repeat failures form "one issue with multiple occurrences" — [Issues](https://docs.qa.tech/core-concepts/issues.md).
- **QA.tech review agent.** Groups failures by root cause across seven causes (product bug, outdated test, test data or state, timing, agent mistake, environment, credentials or third party). Sections: Issues, Setup, Flaky, Tests to update. Notifications wait for the review — [Regression review agent](https://docs.qa.tech/regression-testing/regression-review-agent.md).
- **TestSprite.** Verdict per test with recordings; Trends plot one point per run (last 50). Pass rate is "% of tests passing, carrying forward each test's last known verdict". Also Issues caught, Fixed by agent, Regressions — [Lifecycle](https://docs.testsprite.com/web-portal/concepts/testing-lifecycle); [Insights](https://docs.testsprite.com/web-portal/results/project-overview.md). A run shows each test as a video tile grouped by status, plus step-by-step replay — [Index](https://docs.testsprite.com/llms.txt).
- **Spur.** Test status: Failed, Warning, Passed, Error. Test Overview shows the latest; history is on the individual test — [Test Overview](https://docs.spurtest.com/analysing-tests/test-overview-page.md).
- **Spur Test Plan Review.** A guided human flow classifying each failure as Bug, Closed, Needs Investigation or Needs Rework; bugs push to trackers — [Test Plan Review](https://docs.spurtest.com/analysing-tests/test-plan-review.md).
- **Spur PR checks.** "Error: Spur couldn't finish, so the behavior is unchecked." Check statuses also include "Unverified (not enough evidence to decide)" — [PR Agent results](https://docs.spurtest.com/running-tests/cicd/pr-agent-results.md).
- **Mo.** Verdict per agent: Verified, Issues found, Blocked — [Reports](https://momentic.ai/docs/mo/reports.md).
- **Ranger.** Each scenario is verified, blocked or partially verified, with screenshots and video — [Quickstart, Excerpt](https://docs.ranger.net/getting-started/quickstart/).
- **Datadog.** Pass or Fail with a rationale summary, step-by-step navigation and final screenshot — [Docs](https://docs.datadoghq.com/synthetics/goal_based_testing/).
- **Meticulous.** One Test Run per commit, compared base to head; diffs need approval — [Glossary](https://app.meticulous.ai/docs/concepts/glossary.md).
- **Octomind (historic).** Failure categories: "App bug," "Selector change," "Slow page load," "Broken dependency," "Flaky behavior" — [Secondary, competitor](https://bug0.com/knowledge-base/octomind-ai-testing-platform-features).

### Inferences
- A distinct "Couldn't run" status is well supported by the market: Blocked (Mo, Ranger, TestSprite), Error (Spur), Unverified (Spur PR checks).
- Separating a test's result from a higher-level "Issue" (QA.tech) avoids repeating the same failure on every scheduled run. DappDrill's scheduled runs would benefit.
- Carrying forward each test's last verdict (TestSprite) lets a partial re-run still give a project-level status.

### Gaps
- Spur's run-level pass rate and QA Wolf's dashboard contents were not confirmed. No pricing or usage metrics were reviewed.

## Web3: how do Synpress, dappwright, Tenderly, thirdweb and others model tests and wallet interactions? Is there established web3 vocabulary?

### Takeaway
Web3 tools have no test-management entities at all. They are libraries on Playwright, and their shared vocabulary is about wallet events: connect, approve or reject, sign, confirm transaction, switch network, spending cap. The stable standard underneath is EIP-1193. I found no agent-driven dApp QA product with a real entity model; the closest are a blog post and a vendor marketing page.

### Cited Findings

**Test libraries**

| Tool | Status | Model | Wallet verbs |
|---|---|---|---|
| Synpress | Active; repo now `synpress/synpress`, last push 2026-10-06 ([Repo](https://api.github.com/repos/synpress/synpress)) | Playwright (Cypress experimental), built-in fixtures, Ethereum Wallet Mock, Anvil integration, Phantom from v4.1.0 — [Docs](https://docs.synpress.io). **Wallet setup** files (`*.setup.ts`, `defineWalletSetup`) build a **wallet cache** keyed by a hash of the setup code. Setup must not send state-changing transactions — [Wallet cache](https://docs.synpress.io/docs/guides/wallet-cache.md). | `connectToDapp`, `confirmSignature`, `confirmSignatureWithRisk`, `rejectSignature`, `confirmTransaction`, `confirmTransactionAndWaitForMining`, `rejectTransaction`, `approveTokenPermission`, `rejectTokenPermission`, `approveNewNetwork`, `rejectNewNetwork`, `approveSwitchNetwork`, `rejectSwitchNetwork`, `switchNetwork`, `addNetwork`, `switchAccount`, `importWallet`, `lock`, `unlock` — [MetaMask class](https://docs.synpress.io/api-reference/playwright/classes/MetaMask.md) |
| dappwright | Active; v2.13.17 on 2026-11-01 ([Repo](https://api.github.com/repos/TenKeyLabs/dappwright/releases)); 128 stars | Playwright fixtures: `bootstrap`, `getWallet`, worker-scoped `walletContext`, `wallet`. MetaMask and Coinbase Wallet — [README](https://github.com/TenKeyLabs/dappwright). | `approve`, `reject`, `sign`, `signin`, `confirmTransaction`, `confirmNetworkSwitch`, `switchNetwork`, `addNetwork`, `updateNetworkRpc`, `addToken`, `importPK`, `switchAccount`, `lock`, `unlock`, `getTokenBalance` — [Source: wallet.ts](https://github.com/TenKeyLabs/dappwright/blob/main/src/wallets/wallet.ts). The repo's [API.md](https://raw.githubusercontent.com/TenKeyLabs/dappwright/main/docs/API.md) is stale (still references Puppeteer and omits `reject`). |
| OnchainTestKit (Coinbase/Base) | Last commit 2026-03-09; 13 stars ([Repo](https://api.github.com/repos/coinbase/onchaintestkit)) | `createOnchainTest(config)`; builder `configure().withMetaMask().withSeedPhrase().withNetwork()`; `LocalNodeManager` allocates Anvil nodes for parallel workers — [README](https://cdn.jsdelivr.net/npm/@coinbase/onchaintestkit@1.2.1/README.md); [Base docs, Excerpt](https://docs.base.org/onchainkit/guides/testing-with-onchaintestkit). | `BaseActionType`: `CONNECT_TO_DAPP`, `HANDLE_TRANSACTION`, `HANDLE_SIGNATURE`, `CHANGE_SPENDING_CAP`, `SWITCH_NETWORK`, `IMPORT_WALLET_FROM_SEED`. `ActionApprovalType`: `APPROVE`, `REJECT`. `NotificationPageType`: `Transaction`, `SpendingCap`, `Signature` — [README](https://cdn.jsdelivr.net/npm/@coinbase/onchaintestkit@1.2.1/README.md) |
| walletqa | Unknown maturity | Real extensions across EVM, Solana, TON; `createWalletFixture`, `createMultiWalletTest`, `defineWalletSetup`; tags `@connect`, `@sign`, `@send-tx`, `@reject`, `@onboard`; `--affected` filter — [pkgstats](https://www.pkgstats.com/pkg:walletqa). | Approval kinds: connect, transaction, signature, add-network. Fixtures: `approveConnection`, `rejectConnection`, `approveTransaction`, `rejectTransaction`, `approveSignature`, `rejectSignature`, `approveNext` — [pkgstats](https://www.pkgstats.com/pkg:walletqa) |
| wagmi mock connector | Active | Unit-level fake wallet; `defaultConnected`, `features` flags — [wagmi, Excerpt](https://wagmi.sh/core/connectors/mock). | `connectError`, `reconnect`, `signMessageError`, `signTypedDataError`, `switchChainError` — [wagmi, Excerpt](https://wagmi.sh/react/connectors/mock) |

**Chain environments and monitoring**
- **Tenderly.** Docs now say **Virtual Environment**, not Virtual TestNet, and group products under Simulator, Console, Monitor and Node RPC — [Products](https://docs.tenderly.co/products). The URL slug and third-party guides still use the old name — [Docs](https://docs.tenderly.co/virtual-testnets); [Quicknode](https://www.quicknode.com/builders-guide/tools/tenderly-monitoring-by-tenderly).
- Tenderly environment vocabulary: Fork (pinned block), State Sync, Admin RPC ("adds cheatcodes"), Public RPC, Explorer, Unlimited Faucet, Simulation ("Dry-run transactions"). It lists uses as CI/CD (fresh environment per PR) and "Staging and demo environments" — [Docs](https://docs.tenderly.co/virtual-testnets). It models environments, not tests. No Tenderly-specific Playwright guide was found; the nearest is connecting a dApp UI — [Dapp UI guide](https://docs.tenderly.co/virtual-testnets/dapp-ui/dynamic).
- **Tenderly Monitor.** Alerts have 12+ on-chain triggers; Web3 Actions are serverless on-chain event handlers — [Docs, Excerpt](https://docs.tenderly.co/products).
- **OpenZeppelin Defender.** Sunset announced with final shutdown 2026-07-01 — [OpenZeppelin](https://www.openzeppelin.com/news/doubling-down-on-open-source-and-phasing-out-defender). Replacements are open-source Monitor and Relayer — [Secondary](https://github.com/enitrat/defender-sdk). Its terms (Sentinels, Actions) should be treated as legacy — [Secondary](https://dev.to/ohmygod/the-post-defender-era-building-your-smart-contract-runtime-security-stack-before-july-2026-5gc2).
- **thirdweb.** I found no dApp testing product or testing guide. Its SDK tests use Vitest with a fixed test account and wallet adapter, and live smart-wallet tests gated on `TW_SECRET_KEY` — [SDK test](https://cdn.jsdelivr.net/npm/thirdweb@5.119.4/src/react/core/hooks/wallets/useConnect.test.tsx); [Smart wallet test](https://cdn.jsdelivr.net/npm/thirdweb@5.119.4/src/wallets/smart/smart.test.ts).

**Standards and agent thinking**
- **EIP-1193** errors: 4001 User Rejected Request, 4100 Unauthorized, 4200 Unsupported Method, 4900 Disconnected, 4901 Chain Disconnected. Events: connect, disconnect, chainChanged, accountsChanged — [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193).
- **Tangle blog** is the clearest writing on agents and wallets. "The application page and the wallet prompt are separate interfaces with different ownership and evidence." "A natural-language goal is not a permission boundary." The stop reason and signing status "come from the runner's action record, not from the model's final prose." It recommends stopping before signing by default — [Tangle](https://tangle.tools/blog/natural-language-e2e-testing-wallet-apps). DappDrill's local forks and own wallet make that default less necessary, but the evidence idea carries over.
- **Autosana** markets AI testing for crypto mobile apps; there are no web3 pages in its docs index — [Vendor blog](https://blog.autosana.ai/use-cases/ai-testing-crypto-web3-mobile-apps); [llms.txt](https://autosana.ai/llms.txt).

### Inferences
- A de facto web3 vocabulary exists at the wallet-event level:
  - Connect
  - Sign / signature
  - Confirm or reject transaction
  - Approve token / spending cap
  - Switch or add network
  - User rejected request
- It does not exist at the test-management level, so DappDrill can adopt general terms there.
- "Approve" is ambiguous: dappwright uses it for a generic prompt, while Synpress and OnchainTestKit use token permission or spending cap language. DappDrill copy should say "Approve token spending" or similar.
- Mapping unhappy-path conditions to EIP-1193 codes and wagmi flags gives a principled list (reject = 4001, wrong network = chain mismatch or 4901, disconnected = 4900). Slow RPC and low gas are not in the standard, so they are DappDrill's own conditions.
- "Wallet setup" (Synpress, walletqa) is a shared concept for test identity, and could inform how a funded wallet persona is named.
- DappDrill looks to have no direct agent-driven competitor in web3 based on these searches, though search coverage of a small niche is weak.

### Gaps
- No evidence found for a dApp-specific synthetic monitoring or QA SaaS with its own entity model. Absence may reflect search limits.
- Forta and Hypernative vocabulary was not found in the searches run.
- Solana-specific testing tools were not investigated beyond Synpress's Phantom support and walletqa.
- walletqa's maintainers and adoption were not checked; the only source is a package mirror.
