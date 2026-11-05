# Redesign the meaning, not the levels

Yes, DappDrill should redesign its entities, but it should not add a level. The owner's goals, flows and tests already exist in the product under other names: today's Flow ("Trade perps") is the goal, a root Test is the flow, and an unhappy path is the third level. So the real problems lie elsewhere. The "subtest" is a condition applied to a test but stored as a fake test, a Flow is an empty folder, nothing rolls up into an answer to "is my app OK?", and a Dangerous signature on a passing test stays hidden. The right model is **App > Flow > Test > Condition, with Runs alongside**, where a Flow is what a user wants to get done, a Test is one route to it, and a Condition is something going wrong on that route. The owner's what/how split is sound and matches use-case theory. "Tests (in what ways)" is the weak part, because a rejected signature is not a way of achieving the goal. Goal belongs as a sentence on the Flow, not as a new layer: analysis produces at most three flows, so a level above them would have nothing to group, and the market uses "goal" for a test's intent. This model keeps the words Flow and Test, so it avoids the database, engine-contract and CLI-format renames. The first changes render at display time and need no migration. All of this rests on theory, vendor docs and code reading, with no user research, so two cheap checks come first: count routes per flow on real dApps, and run a short card sort.

## The owner's three levels already exist under different names

"Subtest" appears nowhere in the repo. What the owner means is the unhappy path: a real `tests` row with `base_id` and `condition` set and empty steps, created on demand, one level deep ([tests.ts:69-90](../packages/db/src/tests.ts)). Lined up against the owner's proposal, today's hierarchy already has the same shape. The mapping below is mine, but it follows from what each entity does in the code.

| Owner's word | Meaning | Today's entity | Example | What is wrong with it today |
|---|---|---|---|---|
| Goal | What you want to achieve | `flows` row | "Trade perps" | Holds only a name and position ([app.ts:187-198](../packages/db/src/schema/app.ts)), with no goal, status or page |
| Flow | How you achieve it | Root `tests` row | Goal, expected result, steps | Nothing marks the main one, and its status ignores its children |
| Test | In what ways | Unhappy path row | "Slow RPC" | Only about half its fields do anything |

The third row is the source of the discomfort. An unhappy path is really a pair of base test and condition. `runCondition` never reads the child's goal, expected result or start path ([tests.ts:156-239](../packages/engine/src/pipeline/tests.ts)), yet the web still lets a user edit them ([actions/tests.ts:149-164](../apps/web/src/actions/tests.ts)). **Editing "Expected result" on an unhappy path looks like it changes the check and does nothing.** This also breaks a basic rule of test design: a test case is the lowest level and is not made up of other test cases ([imbus ISTQB glossary](https://www.imbus.de/en/glossar/term/test-case)). A test with child tests is what makes the screen read as "tests and subtests".

Flow has the opposite problem. Prater's object-oriented UX excludes collections from being objects ([A List Apart](https://alistapart.com/article/object-oriented-ux/)), and today's Flow is exactly that: a heading whose lifetime is tied to its tests, deleted with its last test ([actions/tests.ts:185-187](../apps/web/src/actions/tests.ts)). The research notes score Flow as a clear object because it "has steps", but that describes the owner's flow, not the DappDrill table. **As built, Flow fails the same test that Goal would fail.** The redesign has to give it real content rather than wrap another layer around it.

A redesign is also cheap right now. The current model is a day old: commit 72e0d1b replaced the scan, report and variation model on 2026-11-04, and most mismatches are leftovers of that pivot. Whether any outside users hold data or committed test files is unknown, and that one fact decides how careful the CLI work must be.

## "Goals, flows, tests" gets the split right and the third level wrong

Separating what from how is the best-supported idea in the proposal. Cockburn's goal binds every scenario into one use case, drawn as a success leg and a failure leg ([Cockburn draft, pp. 38-39](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)). Jacobson defines a use case as all the ways of using a system to reach a goal for a particular user ([Use-Case 2.0, p. 3](https://static1.squarespace.com/static/50c9c50fe4b0a97682fac903/t/53e5dbf2e4b0b053add87200/1407572978732/Use-Case%2B2_0_Jan11.pdf)). ISTQB splits "what to test" from "how to test" ([CTFL v4.0.1, section 1.4](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)). Jobs-to-be-done adds the most useful practical check: a job stays stable while solutions change ([Strategyn](https://strategyn.com/jobs-to-be-done/jobs-to-be-done-playbook/what-is-jobs-to-be-done/)), so if the app is redesigned, the goal should survive while the steps do not. In a product where an agent rewrites steps, that stable identity is what keeps history meaningful.

"In what ways" is where the proposal breaks, because it merges three things that the theory keeps apart. Cockburn separates extensions, where what the system does differs, from technology and data variations, where only the how varies, and says the second kind does not belong with the first ([Cockburn draft, ch. 9](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)). So a permit route instead of approve-then-deposit is another way to succeed. A rejected signature is a failure the app must handle well, with a different expected result. A different wallet is the same route with different data. **Only the first is a "way" of achieving the goal, and DappDrill's whole unhappy-path feature is the second.** "Under what conditions" is the honest wording.

Goal as a container fails for three concrete reasons. First, it has nothing to group: the analyst returns one to three flows, with one test each ([analyst.ts:23, 37-42](../packages/engine/src/agent/analyst.ts)). Second, it collides with an existing word: every test already has a `goal` field, and QA.tech, Datadog and Momentic all use "goal" for the intent of a test or action, not a group above it ([QA.tech](https://docs.qa.tech/best-practices/creating-tests.md), [Datadog](https://docs.datadoghq.com/synthetics/goal_based_testing/), [Momentic](https://momentic.ai/docs/best-practices/goal-based-testing.md)). A Goal level holding tests that each have a Goal field is the "one term, several concepts" blooper that Johnson and Henderson warn against ([Conceptual Models](https://courses.dubberly.com/frameworks_2024_fall/Conceptual_ModelsInteractionsPaper.pdf)). Third, Jacobson's basic flow and NN/g's "typical or ideal" flow both imply one dominant path per goal ([NN/g](https://www.nngroup.com/articles/user-journeys-vs-user-flows/)). If one route per goal is the normal case, a separate level would mostly produce "Deposit" sitting over "Deposit", and one reading of the depth studies is that distinct labels matter more than depth itself ([HFI review](https://www.humanfactors.com/newsletters/breadth_vs_depth_we_revisit_this_question.asp)).

The strongest case for the owner's wording is that "flow" implies steps, so a Flow whose contents are tests is slightly inverted, and "goal" is warmer and plainer. That argument is fair, and it does not justify the cost. Renaming would touch 26 files in the group sense, the database, the engine contract and the CLI file, in exchange for a precision no user has asked for. QA Wolf also uses Flow for this same level: one user journey, containing tests ([Glossary](https://docs.qawolf.com/qawolf/Glossary.md)). If a card sort shows users really do expect "Goal" at the top, the display label can change on its own, without touching the schema. The owner's idea survives where it does real work: **every Flow states its goal in one sentence**, at Cockburn's sea level, using his check that the user can go away happy ([Cockburn draft, section 5.1](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)). "Connect wallet" fails that check, so it belongs in setup or steps. An agent exploring an app will tend to surface such fragments, so the same check belongs in the analyst prompt.

## The market agrees on the skeleton and leaves the unhappy path open

Testing products share one skeleton of container, grouping, test and step, plus a run record, while their words conflict. "Suite" means a folder in Qase, a workflow in Reflect, and a whole check type in Checkly. "Scenario" means a group in QA.tech, a data row in Spur, and the test itself in Ranger ([QA.tech](https://docs.qa.tech/core-concepts/tests-and-results.md), [Spur](https://docs.spurtest.com/authoring-tests/scenarios/scenario-tables.md), [Ranger](https://docs.ranger.net/concepts/scenarios)). "Plan" is nearly as unstable. DappDrill should avoid all three as entity names, and it does today. "Check" should also stay out, since it clashes with the signing verdict "Check this".

The closest peers support a named level above the test for non-QA audiences. QA Wolf has Group > Flow > Test, and TestSprite has Feature > Use Case > Test Case ([TestSprite](https://docs.testsprite.com/web-portal/core/working-with-test/coverage-map.md)). QA.tech's test (name, goal, optional expected result, generated steps) is almost exactly DappDrill's, and it advises that a user journey should probably map one-to-one to a test case ([QA.tech](https://docs.qa.tech/best-practices/creating-tests.md)). A layer above the test seems to survive when it does a job. Rainforest's feature can be run and shows coverage ([Rainforest](https://help.rainforestqa.com/docs/organizing-tests-by-feature)), and Xray's requirement computes a status ([Xray](https://docs.getxray.app/space/XRAY/301669557/Understanding+coverage+and+the+calculation+of+Test+and+requirement+statuses)). Gherkin's Feature does neither, and practitioners report stakeholders stop reading it ([dev.to](https://dev.to/luiinge/when-cucumber-grows-too-big-pain-points-lessons-learned-and-alternatives-21pm)), though that evidence is anecdotal.

Discovery offers the idea most worth borrowing. QA Wolf's coverage outline holds flow stubs that record scope before any test exists, and TestSprite splits use cases into Covered, Planned and Gap ([Insights](https://docs.testsprite.com/web-portal/results/project-overview.md)). This is the best version of the owner's goal instinct: **a standing statement of what users need to do, independent of whether a test exists yet.** DappDrill can't express that today, because a flow can't exist without a test.

No product I reviewed has a first-class "unhappy variant of this flow". Negative paths are ordinary sibling tests, at most labelled positive or negative, as in QA.tech. Variant mechanisms cover data (Spur), wallets (walletqa) or environments. Web3 tools have no test-management entities at all, only wallet-event verbs such as connect, sign, reject and switch network, sitting on EIP-1193 ([EIP-1193](https://eips.ethereum.org/EIPS/eip-1193)). This is absence from docs, not proof, but it means DappDrill must teach the concept and can treat it as a differentiator. The steelman is to copy the market and call them plain sibling tests with a label. That fails here because conditions cut across flows, and the most valuable reading is "slow RPC fails on every flow". CI products show the better pattern: author a template, run one child per combination with its own status, and read the result as a group or grid ([GitHub](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations), [Buildkite](https://buildkite.com/docs/pipelines/configure/workflows/build-matrix)).

Two more market findings confirm existing choices or correct them. A distinct "couldn't run" outcome is well supported: Blocked in Mo and Ranger, Error in Spur ([Mo](https://momentic.ai/docs/mo/reports.md), [Spur](https://docs.spurtest.com/running-tests/cicd/pr-agent-results.md)). And the primary results object is a run of a group, with a drill-down per test ([QA Wolf](https://docs.qawolf.com/qawolf/Glossary.md), [Momentic](https://momentic.ai/docs/running-tests/results.md)), which DappDrill does not have.

## Status and signing are sharper gaps than the hierarchy

"Is my app OK?" has no direct answer today. The header reads "N failing, N passing" over all tests, unhappy paths included, so a broken deposit and a missing spinner under slow RPC count equally. `failing` counts only `fail`, so Couldn't run disappears ([page.tsx:41-42](<../apps/web/src/app/(app)/apps/[appId]/page.tsx>)). The flow summary has the same hole, and a pass plus a Couldn't run reads "1 passing". A parent test shows its own status only, which puts a clean Passed beside a failed child. Skip reasons are stored but never shown.

The most serious gap is in signing. The product promises that every signature request is reviewed, but the verdict affects nothing outside the Wallet panel of one test page. A search of the pipeline, replay, worker and CLI finds no consumer of a Dangerous verdict. **A Dangerous signature on a passing test is invisible unless someone opens that test's Wallet panel.** Buildkite's soft-fail shows why this matters: a soft-failed job appeared as successful on a GitHub PR and surprised the team ([Buildkite forum](https://forum.buildkite.community/t/soft-fail-status-in-github-checks/3144)). The lesson is that an accepted problem must not read as all-clear one level up.

Word collisions add to the confusion, and each one is cheap to fix. "Fork" means a chain copy and a test copy. "Run" means one execution in the "Runs" panel, yet means the whole batch in "Daily run" and "First run", and no batch page exists. One concept has four names: unhappy path, condition, edge case and variant, with labels and default sets that differ between `CONDITIONS` and `EDGE_CASES`. Internally, `flowId` on Issue and SigningReview holds a test id, and core's `Flow` is a replay script. Johnson and Henderson recommend a managed lexicon for exactly this reason ([Conceptual Models](https://courses.dubberly.com/frameworks_2024_fall/Conceptual_ModelsInteractionsPaper.pdf)).

## Recommendation: Flow, Test, Condition, with Runs alongside

### Entity model and names

Every level gets its own word, and nothing named a test contains another test.

| Level | Name | What it is | Example | Change from today |
|---|---|---|---|---|
| Container | **App** | The dApp under test, with its setup, chains and wallets | Harbor Vault | None |
| What | **Flow** | Something a user comes to get done, with a one-sentence **goal** | "Deposit into a vault" | Gains a goal sentence, a status, and the right to exist without a test |
| How | **Test** | One route to that goal: expected result, steps. Usually exactly one | "Approve, then deposit" | Keeps its fields; no longer contains tests |
| What if | **Condition** | Something going wrong on that route, from a shared list | "Rejected in wallet" | Replaces "unhappy path"; read-only, not an editable test |
| Unit of work | **Step** | A plain-English step. Cached actions stay hidden | "Click Deposit" | None |
| Execution | **Run** | Everything started together, by a person, the schedule or the assistant | "Daily run, 09:00" | Now means the batch, as most labels already do |
| Execution | **Result** | One test or condition inside one run: video, wallet requests, problems | "Failed at step 3" | The new name for one `test_runs` row in the UI |

Four decision rules keep this stable, and they double as guidance for the analyst and the assistant. A different user outcome is a new Flow. A different route to the same success is a second Test in that Flow. The same route where something goes wrong and the expected outcome changes is a Condition. The same route with different data, wallet or chain and the same outcome is not an entity: wallet and chain are attributes and filters, and a variant earns a place only if it falls in a different partition, meaning the app should treat it differently ([CTFL v4.0.1, section 4.2.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)). Until real demand for data variants appears, "Duplicate" covers them.

Keep the model separate from storage. Conditions stay as rows for now, with `base_id` and `condition` as their true identity. Users see a condition on a test, and the code stops pretending otherwise by deriving name and expected text from one shared list. Goal, Issue and Analysis stay out of the user's nouns as levels: Goal is a Flow attribute, "Problems" stay inside a Result, and "Explore" is the single word for analysis.

### What users see

Navigation becomes **Flows · Runs · Settings**, which ends the disagreement between a nav called Tests and a page built from Flow cards. Users move through two page levels: the Flows list, then a test page with detail panels. When a Flow has one Test, which should be the usual case, the card shows that test directly and the Flow/Test split never appears. A second Test appears as a row only when it exists. Keep the `/apps/:id/tests/:id` route, because chat history stores those hrefs. An illustrative Flows page:

```
Harbor Vault                 2 of 3 flows passed, 1 failed · 1 dangerous signature
                             Last run: Daily run, 09:00

Deposit into a vault         Passed        Conditions: 5 of 6 passed, 1 failed
  Slow RPC                   Failed at step 3
Withdraw                     Failed        Conditions: not added
Claim rewards                Passed        1 dangerous signature
Borrow against a position    Not tested    Found while exploring
```

A condition page is read-only and anchors to the base test's steps, the way Cockburn numbers extensions: "At step 3, the wallet rejects". The `owner[]` mapping already ties results to base steps ([tests.ts:209-223](../packages/engine/src/pipeline/tests.ts)). A Doesn't apply condition shows its reason. The Runs page lists batches with the same counts and opens to Results. A quiet line on a Result, such as "Finished by the agent after the saved actions stopped working", follows Momentic's view that recovery is a signal worth seeing ([Momentic](https://momentic.ai/docs/reliability/auto-maintenance.md)), and `via` already holds the data.

Add a **flows × conditions grid** as a second view. It is the only view that shows gaps and patterns, since column totals point at one root cause. A cell must separate not added, Not run yet, Couldn't run and Doesn't apply, because treating these as one blank destroys the grid's value. The codebase notes list a matrix as a benefit of the structural rewrite, but `base_id` and `condition` already identify each cell, and `CONDITIONS` supplies the columns, so the grid can be drawn from today's rows.

### Status rollup rules

Roll up at display time, with two reads at Flow level instead of one worst-wins word. This follows Cockburn's two legs and keeps a slow-RPC gap from reading like a broken deposit. All rules use only the agreed vocabulary, except that Doesn't apply replaces Skipped.

| Level | Rule |
|---|---|
| Test or Condition | Shows its latest finished result. Running or Queued shows beside it and does not erase it, and Stopped does not replace it, following Xray's final-status precedence ([Xray](https://docs.getxray.app/space/XRAY/301669557/Understanding+coverage+and+the+calculation+of+Test+and+requirement+statuses)). No finished result is Not run yet. A test's status never includes its conditions |
| Doesn't apply | Shows its reason and leaves every denominator |
| Flow, main read | Over its Tests: Failed if any failed; else Couldn't run if any could not run; else Not run yet if none finished; Passed only if all passed. A partly run Flow shows counts and no status word. No marker for a "main" test is needed |
| Flow, conditions read | Counts over added, applicable conditions: "5 of 6 passed, 1 failed, 1 couldn't run". Conditions not added are not failures; they appear as "not added" |
| Flow with no tests | Not tested. Never Passed |
| App | One sentence with denominators: "2 of 3 flows passed, 1 failed". Passed only if every tested Flow passed and no condition failed; untested flows are counted separately |
| Signing | A separate flag beside the status, from latest results including conditions. It does not change a test's own Passed or Failed. Dangerous appears at test, Flow and App level, and sends an alert. Check this shows as a count. Looks consistent shows nothing |
| Anything one-word | Badges, CI and alerts use strict worst-wins: a failed condition or a Dangerous signature can never export as plain Passed. CLI: exit 1 for Failed or Dangerous, exit 2 when the only problem is Couldn't run |

Colour follows the existing tokens. `bad` marks a failed main read and Dangerous, `warn` marks a failed condition at Flow level, Couldn't run and Check this, and `live` marks in-progress work. Passed, Not run yet, Not tested and Doesn't apply carry no colour. Alert and JUnit labels should read "Flow · Test · Condition", since "Trade perps · Slow RPC" can't tell two root tests apart. The JUnit name is also a CI history key, so change it together with any other CLI change.

### What to change first

Almost all the value sits in the cheapest tiers. Because Flow and Test keep their names, the database, engine and CLI renames drop out almost entirely.

| Order | Change | Cost tier | Why here |
|---|---|---|---|
| 0 | Count routes per flow on Harbor Vault and a few real dApps; run a five-person card sort on Flow, Goal and Condition; find out who holds `tests.json` | None | Settles the open assumptions |
| 1 | Rollup rules and the signing flag at display time; show skip reasons; count Couldn't run | Render only, no migration | Closes the two sharpest gaps |
| 2 | One word: Condition. "Fork" becomes "Duplicate". Nav becomes Flows · Runs · Settings. Run means the batch. Remove "Your first scan is free" | Tier 1, copy only | About 10–20 strings plus the assistant prompt |
| 3 | Lock name, goal and expected on condition rows; derive them from `CONDITIONS`; make the judge's text match what users read | Tier 1–2 | Removes the editable-expected trap with no migration |
| 4 | Delete dead scan-era types; rename core `Flow` to a replay-script name; rename `flowId` on Issue and SigningReview, with a zod alias because stored results hold the old key; merge the two lists of conditions and the duplicated CLI logic; rewrite the entity sections of the product context | Tier 2 | No user impact, and it ends "flow means script" |
| 5 | Runs page, derived by grouping on `batch_id`. Add a table only when a run needs stored state | Tier 7, near free | Gives the market's primary results object |
| 6 | Flows × conditions grid from existing rows | View only | The differentiator, once rollups exist to read |
| 7 | `flows.goal`, flows without tests, and analysis listing flows found but not tested, which gives the unused app map a job | Tier 7 plus part of tier 4 | Delivers the owner's goal idea; needs a `FlowDraft` and prompt change |
| Hold | Database, contract and CLI renames | Tiers 3–5 | Not needed; add a `--conditions` alias and keep `--unhappy` |
| Defer | Conditions as a run dimension instead of rows | Tier 6 | Revisit if locking does not stop drift, or if conditions become default on every test and rows multiply |
| Hold | Any layer above Flow | Tier 7 | Add only if apps regularly outgrow one screen of flows (about eight, as a rule of thumb), and call it Area rather than Goal, as Rainforest and TestSprite group by product area |

Three findings would change this plan. If routes per flow are often above one, the second-test row deserves more design attention. If users read "Flow" as a sequence of steps and reach for "Goal", change the display label alone. If outside users hold committed test files, any later CLI change needs a loader that accepts both shapes, because `loadTests` rejects unknown formats today ([files.ts:33-37](../packages/cli/src/files.ts)). The evidence has limits. No study compares these splits for testing products, depth research concerns finding items and not reading status, competitor vocabulary comes from docs and not logged-in UIs, and first-hand complaint venues were unreachable.

## Conclusion

The owner's instinct and the code are closer than "tests and subtests" suggests. The hierarchy was already right in shape, and what was missing was commitment to what each level means. A condition is not a small test, and a flow is not a folder. That reframing turns a feared rebuild into mostly display and copy work, while the storage rewrite that looked mandatory becomes optional.

The more important shift is what the product should lead with. Peers mostly report whether journeys pass. DappDrill's distinctive read is a route-by-condition view, with a signing flag that no passing test can hide: "does it work, and does it fail safely when the wallet, network or signature goes wrong?" No product reviewed models that directly, so the words Flow, Test and Condition matter less than getting that one sentence onto the first screen.
