# UX and test-design theory for a goals / flows / tests entity model

Evidence labels used below: **[Definition]** = what a standard or author's method says; **[Empirical]** = a study with data; **[Expert opinion]** = practitioner judgement with no data given; **[Product docs]** = vendor documentation of behaviour; **[Community report]** = issue threads and forums.

Source notes: definitions are paraphrased, so check the linked source before quoting. Use-Case 2.0 was read from a hosted copy of the January 2011 ebook (the official Ivar Jacobson page returned 403). Cockburn was read from a pre-publication draft of *Writing Effective Use Cases*, so section wording may differ from the printed book. Both were read as full text, as were Johnson and Henderson and the ISTQB CTFL v4.0.1 syllabus.

## Objective: where the proposal matches established thinking, and where it breaks

### Takeaway
Goal (what) separated from flow (how) is solid: almost every framework makes this split. The third level is the weak one, because "tests (in what ways)" merges at least three things the theory keeps apart: other ways to succeed, ways to fail or recover, and the same path with different data or technology. The word "flow" also means a fragment in Jacobson but a whole path in the proposal, and the model is deeper than three levels once steps and runs are counted.

### Cited Findings
- [Definition] Cockburn: the goal binds all scenarios. A use case collects every way the goal can be accomplished or fail, drawn as "striped trousers" with a success leg and a failure leg — [Cockburn draft, ch. 2, pp. 38-39](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)
- [Definition] Jacobson: a use case is all the ways of using a system to achieve a particular goal for a particular user, so the actor is part of the definition — [Use-Case 2.0, p. 3](https://static1.squarespace.com/static/50c9c50fe4b0a97682fac903/t/53e5dbf2e4b0b053add87200/1407572978732/Use-Case%2B2_0_Jan11.pdf)
- [Definition] Cockburn separates extensions (what the system does differs) from Technology and Data Variations (what happens is the same, how it is done varies), and says the second kind does not belong in the Extensions section — [Cockburn draft, ch. 9, p. 65](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)
- [Definition] Jacobson's alternative flows cover three kinds of thing: other ways of reaching the goal, optional facilities, and problems on the way. His Withdraw Cash examples are a non-standard amount, a receipt and a stuck card — [Use-Case 2.0, Figure 2 text](https://static1.squarespace.com/static/50c9c50fe4b0a97682fac903/t/53e5dbf2e4b0b053add87200/1407572978732/Use-Case%2B2_0_Jan11.pdf)
- [Definition] ISTQB splits test analysis ("what to test") from test design ("how to test") — [CTFL syllabus v4.0.1, section 1.4](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)

### Inferences
Crosswalk (my mapping; the frameworks do not align exactly):

| Framework | Goal | Flow (a whole path) | Test (a variant) |
|---|---|---|---|
| Cockburn | Use case at user-goal level | Scenario: main success scenario or alternate success path | Extension (failure, recovery) or Technology and Data Variation |
| Use-Case 2.0 | Use case | Story (not "flow"; a flow is a fragment) | Test case |
| HTA | Goal | One trace through a plan | No direct equivalent |
| JTBD | Job, usually higher than a product goal | Solution | None |
| Patton | Activity | A left-to-right pass through the map | Details hanging beneath a step |
| Journey map | Persona + scenario + goal | Journey or flow | None |
| ISTQB | Test objective or high-level test condition | Loosely a test procedure | Test case |
| Example Mapping | Story | None; there is no path axis | Example, grouped by rule |
| Gherkin | Feature or Rule | Scenario Outline | One Examples row |
| CI | Workflow | Job | Matrix cell |

Where it matches:
- Goal as the thing that binds variants and survives UI change (Cockburn, Jacobson, JTBD).
- Tests as deltas from a base path. Cockburn says writing out every scenario is tedious, redundant and hard to maintain, which supports the current "derive unhappy paths from happy-path tests" approach.
- Status on the leaf. Use-Case 2.0 says story state need not be tracked, because test execution shows how complete the system is.

Where it breaks:
1. **"In what ways" is wrong for the failure leg.** A rejected signature is not a way of achieving the goal. It is a scenario where the goal fails and the app must fail well, so its expected result differs. "Test" needs a kind or an outcome: reaches the goal, or fails safely.
2. **Alternate success paths are ambiguous.** Two ways of succeeding could be two flows or two tests. The proposal needs a rule (see the variant question below).
3. **"Flow" collides with Jacobson.** There, a flow is a basic sequence or a detour and a story is a full path. Designers' "flow" is closer to the proposal, so keep the word but do not borrow Jacobson's diagrams.
4. **Goals need an actor.** Depositor and admin goals are different goals in both Jacobson and Cockburn.
5. **The tree assumption fails.** ISTQB and Use-Case 2.0 are many-to-many: a story traverses several flows and traceability links conditions to cases. Conditions such as "reject" cut across all flows, so they are not children of one flow.
6. **It is not three levels.** App > Goal > Flow > Test > Step, with Runs alongside, is five or six. See the depth question.

### Gaps
- I found no study comparing a goal/flow/test split with other splits for test-product users. All of this is theory transfer.

## Use cases: how do Cockburn's and Jacobson's models map onto goal / flow / test?

### Takeaway
Cockburn gives the sharpest vocabulary: a sea-level goal, one main success scenario, extensions that rejoin, exit or fail, and a separate list for technology and data variations. Jacobson adds that test cases hang off stories (whole paths), and that test cases rather than prose define done.

### Cited Findings
- [Definition] Goal levels: user goals sit at sea level, with summary goals above (cloud, kite) and subfunctions below (fish, clam). The check for a user goal is whether the primary actor can go away happy, also phrased as the coffee break test. Cockburn calls these the goals that matter most to write — [Cockburn draft, section 5.1, p. 57](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)
- [Definition] The main success scenario is the first stripe on the success leg. Other success stripes are alternate success paths or recoveries from intermediate failure. Failure stripes may recover and still fail — [Cockburn draft, pp. 38-39](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)
- [Definition] Each extension's handling ends in one of three ways: back in the main scenario, at a separate success exit, or in failure — [Cockburn draft, writing steps 9-10](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)
- [Definition] An action step can be a simple step or the name of another use case, which is how shared sub-flows are expressed — [Cockburn draft, section 10.1](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf)
- [Definition] Each story traverses one or more flows, from the start to the end of the basic flow, which ties all stories to the same goal. Each story has one or more test cases — [Use-Case 2.0, Figure 8 text, p. 15](https://static1.squarespace.com/static/50c9c50fe4b0a97682fac903/t/53e5dbf2e4b0b053add87200/1407572978732/Use-Case%2B2_0_Jan11.pdf)
- [Definition] A use-case slice is one or more stories selected as a work item of clear customer value. The first slice might be just the basic flow and one test case — [Use-Case 2.0, slicing sections](https://static1.squarespace.com/static/50c9c50fe4b0a97682fac903/t/53e5dbf2e4b0b053add87200/1407572978732/Use-Case%2B2_0_Jan11.pdf)
- [Definition] A test case is a set of test inputs and expected results. Jacobson ranks test cases above the narrative in importance, and says state does not need tracking on stories — [Use-Case 2.0, narrative section, p. 16 and the Test Case work product](https://static1.squarespace.com/static/50c9c50fe4b0a97682fac903/t/53e5dbf2e4b0b053add87200/1407572978732/Use-Case%2B2_0_Jan11.pdf)
- [Definition] The basic flow is the most straightforward way to the goal, and alternative flows are always defined as variations on it — [Use-Case 2.0](https://static1.squarespace.com/static/50c9c50fe4b0a97682fac903/t/53e5dbf2e4b0b053add87200/1407572978732/Use-Case%2B2_0_Jan11.pdf)

### Inferences
- Applied to a dApp (my examples): "Deposit into a vault" is sea level. "Connect wallet" and "Approve token" are below sea level, because nobody leaves happy after them, so they should be shared steps or preconditions and not goals. "Earn yield" is a kite. An agent that discovers flows will tend to surface subfunctions, so the coffee break check is a useful rule for generation as well as for design.
- Cockburn's categories applied: reject and wrong network are extensions; wallet type, chain and amount are Technology and Data Variations; a permit route instead of approve-then-deposit is an alternate success path.
- Show a variant the way Cockburn numbers it: as a condition at a step ("at step 3, wallet rejects"), not as a full copy of the steps.
- Use-Case 2.0's slice has no user-facing role here. It is a delivery unit and can be ignored.

### Gaps
- The draft's section 17.5 (use cases to test cases) is listed in the contents but its text is not in the copy I read. McBreen's "Test cases from use cases" paper, cited there, was not retrieved.

## Task analysis and journeys: how do they separate goal from path, and can one goal have several flows?

### Takeaway
All of them separate goal from path, but in different places: HTA puts the path in a plan attached to a goal, JTBD excludes the solution from the job, and Patton uses the second map dimension. One goal having several paths is normal in theory. How often that matters inside one product is unmeasured, and if 1:1 dominates, the goal level is a wrapper that adds rows without adding meaning.

### Cited Findings
- [Definition] HTA describes an activity through goals, subgoals, operations and plans. Every branch ends in an operation, and plans describe how a goal is reached. It is descriptive and can be costly for large tasks — [AHRQ HTA toolkit page](https://digital.ahrq.gov/health-it-tools-and-resources/evaluation-resources/workflow-assessment-health-it-toolkit/all-workflow-tools/hierarchical-task-analysis)
- [Definition] Annett specifies an operation by a goal, the circumstances that activate it, the actions, and the feedback showing attainment (seen in a search excerpt only) — [Annett 2003 chapter](https://mycourses.aalto.fi/pluginfile.php/1689946/mod_folder/content/0/annett2003%20Hierarchical%20Task%20Analysis.pdf)
- [Expert opinion] Ulwick's school holds that a job is stable over time and solution agnostic, and that a job map describes what the customer is trying to get done, not what they do with a tool (read through Strategyn's explainer and search excerpts, not the book) — [Strategyn](https://strategyn.com/jobs-to-be-done/jobs-to-be-done-playbook/what-is-jobs-to-be-done/)
- [Expert opinion] Christensen's school treats a job as progress in a particular circumstance. The two schools are often confused, and terms are not standardised (secondary source) — [GoPractice](https://gopractice.io/product/jobs-to-be-done-the-theory-and-the-frameworks/)
- [Expert opinion] Patton's map puts activities along the top as a backbone, user tasks beneath, and stories hanging below as "ribs", with higher meaning more necessary. Order is the order you would explain the system. The walking skeleton, a term he credits to Cockburn, is the smallest end-to-end system — [Patton, The New User Story Backlog Is a Map](https://www.jpattonassociates.com/the-new-backlog/)
- [Expert opinion] NN/g: a user journey serves a high-level goal across channels and over time, while a user flow is the typical or ideal set of steps for a common task in one product, with a more granular goal — [NN/g, User Journeys vs. User Flows](https://www.nngroup.com/articles/user-journeys-vs-user-flows/)
- [Expert opinion] Journey maps pair an actor (persona) with a scenario, should clarify the user's goal, and use one point of view per map. The article does not address branching — [NN/g, Journey Mapping 101](https://www.nngroup.com/articles/customer-journey-mapping/)

### Inferences
- A useful test for goal wording, from JTBD: if the app is redesigned, the goal should not change but the flow may. This gives goals their strongest job in an agent-driven product, as a stable identity that keeps history when steps are rewritten.
- A JTBD job sits at Cockburn's summary level or higher. Product goals should be sea-level, so use JTBD for the stability test and not as the level.
- In HTA the path belongs to the goal as a plan, not as a sibling thing. That suggests a flow can be a property of a goal when there is only one.
- Patton's map is two-dimensional, not a tree: variants hang under a step, while the proposal hangs them under a whole path. Step-anchored variants may read better for conditions like reject.
- Both Jacobson's basic flow and NN/g's "typical or ideal" flow imply one dominant path per goal. Design for 1:1 as the common case and show the goal/flow split only when a second flow exists.
- Measure the ratio before committing: count flows per goal on Harbor Vault and a few real dApps.

### Gaps
- I found no data on how many distinct success paths real goals have in a product. This is the most useful missing number, and it can be measured from DappDrill's own analyses.
- Patton's book terms (activities, steps, details) were not verified from the book. His web essay uses activities and user tasks.
- Stanton's 2006 HTA review and the stopping rule were not read.

## Test design: how do ISTQB terms, partitioning, combinatorial testing, model-based testing and Example Mapping divide the space?

### Takeaway
Test-design theory says a variant is justified by a difference in expected behaviour, not by a difference in input. ISTQB gives a pipeline of work products linked by traceability, not a containment tree. Example Mapping offers a real alternative to path-based grouping: variants grouped under the rule they illustrate.

### Cited Findings
- [Definition] Test condition: a testable aspect of a component or system identified as a basis for testing — [imbus copy of ISTQB/ISO 29119 glossary](https://www.imbus.de/en/glossar/search/test_condition)
- [Definition] Test case: preconditions, inputs, expected results and postconditions derived from test conditions. It is the lowest level of test input and is not made up of other test cases — [imbus copy of ISTQB/ISO 29119 glossary](https://www.imbus.de/en/glossar/term/test-case)
- [Definition] Test design elaborates test conditions into test cases and other testware such as charters. Test cases can be organised into test procedures, which are often assembled into test suites — [CTFL v4.0.1, section 1.4.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)
- [Definition] Test procedure: how to run a set of test cases consecutively, including shared setup — [imbus glossary](https://www.imbus.de/en/glossar/term/test-procedure)
- [Definition] Test charters hold test objectives that guide time-boxed exploratory sessions, and those objectives may be treated as high-level test conditions — [CTFL v4.0.1, section 4.4.2](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)
- [Definition] Traceability among test basis, testware, results and defects supports coverage evaluation — [CTFL v4.0.1, section 1.4.4](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)
- [Definition] Equivalence partitioning groups values expected to be processed the same way, so one test per partition is enough. Partitions must not overlap and apply to inputs, configuration and interface parameters too — [CTFL v4.0.1, section 4.2.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)
- [Empirical] NIST: the overwhelming majority of faults involve three or fewer interacting parameters, with a rapidly falling share at four to six, and failures across thousands of reports involved no more than six — [NIST ACTS research program](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software/our-research-program)
- [Expert opinion] Bach and Schroeder argue the enthusiasm around pairwise testing is overstated (only the introduction was retrievable) — [Satisfice](https://www.satisfice.com/download/pairwise-testing-a-best-practice-that-isnt)
- [Definition] Model-based testing: test selection criteria choose a subset of a model's behaviours, because a good test case is hard to define up front. Criteria groups are requirements-based, structural (state, transition), stochastic and fault-based (search excerpt of the working paper) — [Utting, Pretschner, Legeard 2006](https://docs.artemis.ase.in.tum.de/lehrstuhl_1/files/teaching/ws0708/ManagementSoftwareTesting/uow-cs-wp-2006-04.pdf)
- [Expert opinion] Example Mapping uses a story, rules beneath it, examples under each rule, and questions for what nobody can answer. Many questions mean more to learn, many rules mean the story is big, and many examples under one rule may hide several rules. If the outcome is unclear, you have a question and not an example — [Wynne, Introducing Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/)
- [Definition] Gherkin: Feature groups scenarios, Rule represents one business rule, Example is a concrete illustration with Scenario as a synonym, and a Scenario Outline runs once per Examples row — [Cucumber Gherkin reference](https://cucumber.io/docs/gherkin/reference/)

### Inferences
- Using partitioning as a filter: a variant earns its place only if it sits in a different partition. Depositing 1 and 2 is one test; zero, max balance and over balance are three. This is a good rule for pruning generated variants.
- ISTQB's leaf rule (a test case contains no test cases) supports "test" as the leaf only. Groups need other words.
- DappDrill's test spec (goal, expected result, short steps) sits between a charter and a test case: objectives guide an agent, and cached actions turn it into something repeatable. Worth naming in the design discussion because it means steps are less stable than the goal.
- Model-based framing fits: the app map is the model, flows are selected paths, conditions are fault-based criteria. Tests are generated, so users should review the criteria more than write the rows.
- **Wynne's question card applies directly.** A drafted test with no clear expected result should be shown as a question to the user, not as a test that can pass.
- Rule grouping is a possible second lens. "A rejected signature never moves funds" could group one test per flow, which reads closer to how founders state risk than a path list does.
- Naming trap: ISTQB's "test condition" means a testable aspect, whereas DappDrill's "condition" means an injected circumstance. Harmless for non-QA users, but QA users may misread it.

### Gaps
- The official ISTQB glossary site was not fetched. Definitions come from imbus's copy, plus search excerpts for test charter.
- Per-degree NIST percentages are not on the page I read. A search excerpt reports about 40% single-value and 30% two-way faults for one web server dataset, but I did not verify it in the paper.
- I have only the introduction of the Bach and Schroeder critique.

## Is a variant a child entity, a parameter, or a matrix?

### Takeaway
These are not rival options, because they answer different stages. CI and BDD tools converge on the same pattern: author as a template plus parameters, execute as one child per combination with its own status, and read as a grouped list or grid. The decision that matters is when a variant stops being a parameter and needs its own steps.

### Cited Findings
- [Product docs] GitHub's page is titled "Running variations of jobs in a workflow": a matrix defines variables and one job runs per combination, with include and exclude to adjust the set — [GitHub Docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)
- [Product docs] Buildkite expands a step template and matrix elements into jobs, and dimensions multiply. Jobs get a Matrix badge and group under the step. Adjustments can add, skip or soft-fail one combination. Limits include 6 dimensions, 25 elements per dimension, 12 adjustments and 50 jobs per matrix on a command step — [Buildkite build matrix](https://buildkite.com/docs/pipelines/configure/workflows/build-matrix)
- [Definition] A Gherkin Scenario Outline is a template that runs once per Examples row — [Cucumber reference](https://cucumber.io/docs/gherkin/reference/)
- [Community report] Skipped matrix jobs can leave required checks pending, because the inner checks are never created and required checks match exact names — [actions/runner #952](https://github.com/actions/runner/issues/952); [GitHub feedback discussion](https://github.com/github/feedback/discussions/9141)
- [Community report] Teams work around this with one aggregator job that depends on the matrix and is the only required check — [Magma wiki](https://github-redirect.dependabot.com/magma/magma/wiki/How-to-set-up-a-required-matrix-workflow-on-GitHub-actions)
- [Definition] Coverage reading depends on traceability between what should be tested and what was — [CTFL v4.0.1, section 1.4.4](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)

### Inferences

| | Child entity (row under a flow) | Parameter on a test | Matrix (flows x conditions) |
|---|---|---|---|
| Scanning | Good at small counts, long at large ones; repeats across flows | Shortest list, but hides what ran | Best for spotting a pattern, such as "reject fails everywhere" |
| Status rollup | Natural: each row has a result | Weak: one test has many results, so needs a per-value breakdown | Natural per cell; row and column totals both possible |
| Coverage reading | Poor: gaps are invisible because absent rows do not show | Poor | Best: blank cells show what was not tried |
| Authoring | Heavy; drift between copies | Lightest | Light if conditions apply automatically |
| Failure mode | Duplication | Lost history per value | Sparse cells, and only two dimensions fit |

- **Recommended split:** store a variant as parameters on a flow, give each executed combination its own result and history, and offer two views over one data set: rows under the flow, and a flows x conditions grid as the overview. This matches the "Variations" table already in the product context.
- **Decision rule for promotion, from Cockburn and partitioning:**
  - Same steps, different data or environment: parameter (Technology and Data Variation).
  - Same steps up to a point, then a condition changes the outcome: condition variant (extension), stored as a delta.
  - Different steps to the same success: a second flow (alternate success path). This matches the product context's "Duplicate flow".
- The matrix needs three distinct empty states: not applicable, not run yet, and couldn't run. Treating these as one blank destroys its main value. The GitHub skipped-job reports show how badly systems behave when "did not run" has no clear meaning.
- Only two dimensions fit on a grid. Use flows x conditions, and make wallet and chain filters or a drill-in. Multiplying all of them explodes, and NIST's result plus partitioning justify sampling rather than a full product.
- Column totals are the matrix's unique gain: "slow RPC fails on 6 of 8 flows" points at one root cause.

### Gaps
- I found no usability study comparing list and grid views of test results. The table is reasoned from documented behaviour, not measured.

## Object-Oriented UX and conceptual models: which things deserve to be first-class objects?

### Takeaway
Start from Johnson and Henderson's position that each added concept is expensive and must be justified, then apply Prater's SIP test and her exclusions. Test and Flow pass clearly. Condition likely passes. Goal passes only if it owns something beyond its children; otherwise it is a collection, so a heading.

### Cited Findings
- [Expert opinion] Johnson and Henderson say a conceptual model should come before sketching, and that it lists user-visible objects, attributes, actions, relationships and mappings to the task domain — [Conceptual Models: Begin by Designing What to Design, 2002](https://courses.dubberly.com/frameworks_2024_fall/Conceptual_ModelsInteractionsPaper.pdf)
- [Expert opinion] They argue each new concept costs users learning and interacts with every other concept, so complexity grows faster than linearly. New concepts should be strongly resisted unless benefit is high. Their rule is that users should not need to know about anything outside the model — [same paper](https://courses.dubberly.com/frameworks_2024_fall/Conceptual_ModelsInteractionsPaper.pdf)
- [Expert opinion] The more direct the mapping to the task domain, the more likely users adopt the intended model (citing Norman 1986). Their example: an org chart is organisations and employees, not boxes and lines — [same paper](https://courses.dubberly.com/frameworks_2024_fall/Conceptual_ModelsInteractionsPaper.pdf)
- [Expert opinion] Prater: an object has structure, instances and purpose (SIP). She finds them by foraging for recurring nouns and checking synonyms, and separates a conceptual model from a system model — [The Informed Life, episode 63](https://theinformed.life/2021/06/06/episode-63-sophia-prater/)
- [Expert opinion] Prater's exclusions: abstract outcomes are not objects, collections are not objects, views are not objects (a map is a design mechanism). Actions can reveal objects, and objects may have several states. Metadata is what users would sort or filter by — [Prater (as Voychehovski), Object-Oriented UX, A List Apart](https://alistapart.com/article/object-oriented-ux/)
- [Empirical, limited] One agency reports finding no controlled study of object modelling for SaaS, and says the nearest, Kunkel, Bannert and Fach 1995 (64 novices), rejected a general object-first hypothesis. That study compared interaction order, not information models (secondary, original not read) — [Tcules](https://www.tcules.com/insights/object-oriented-ux-when-a-saas-product-needs-it)
- [Expert opinion] A mental model is what the user believes about the system, shaped by other products. Mismatch leads to errors, and it can be fixed by matching the model or by better labels — [NN/g, Mental Models](https://www.nngroup.com/articles/mental-models/)

### Inferences
Combined tests for an object (my synthesis):
1. Does it have its own structure beyond a name?
2. Are there many instances, and would users recognise them?
3. Does it have its own purpose and actions?
4. Does it have a life of its own (states, history)?
5. Is it many-to-many or reused? If so, it cannot be an attribute of one parent.
6. Would removing it lose information, or only a heading?
7. Is it a word from the user's domain?

| Candidate | Verdict | Why |
|---|---|---|
| Test | Object | Has steps, expected result, runs, re-run action |
| Flow | Object | Has steps, instances, a page's worth of content |
| Goal | Conditional | Fails test 6 if it holds only a name and flows. It passes if it owns the actor, the success result and stable identity across redesigns |
| Condition | Likely object | Reused across flows, has parameters and a meaning of its own |
| Wallet, chain, amount | Attribute | Users filter and sort by them, which is Prater's metadata signal |
| Matrix | View | Prater's "map" exclusion applies |
| Status, verdict | Attribute | A state of a test |
| Run | Object | Has its own artifacts and time, separate from the definition |

- Goal's main risk is Prater's collection exclusion, and Johnson and Henderson's cost argument applies directly. Give it a real attribute (the expected outcome, written once) or demote it to a grouping label.
- Keep implementation concepts out of the model: cached actions, agent takeover, fork. Users need "the test ran", not how.

### Gaps
- Norman's design model / user's model / system image text was not retrieved. It is covered here only through Johnson and Henderson's citation.
- I found no OOUX primary source stating an explicit object-versus-attribute decision rule. The list above is a synthesis.

## Hierarchy depth, naming and status rollups

### Takeaway
No research gives a limit on conceptual levels. Evidence on navigation favours moderate structures with very distinct labels, and NN/g's two-level disclosure guidance is opinion. Use a different plain word per level, and never reuse "test". Roll up worst-first, never show green for nothing, and always show counts.

### Cited Findings
Depth:
- [Expert opinion] Nielsen: "designs that go beyond 2 disclosure levels typically have low usability." No study is cited for the limit. If more are needed, simplify or group — [NN/g, Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [Expert opinion] NN/g gives no ideal depth. All else equal, deep hierarchies are harder, extremes backfire, and card sorting and tree testing should settle it. No data is reported — [NN/g, Flat vs. Deep Hierarchies](https://www.nngroup.com/articles/flat-vs-deep-hierarchy/)
- [Empirical] Larson and Czerwinski 1998: increased depth harmed web search performance, and a medium structure beat the broadest, shallowest one — [Microsoft Research abstract](https://www.microsoft.com/en-us/research/publication/web-page-design-implications-memory-structure-scent-information-retrieval/)
- [Empirical, secondary] Reviews report Kiger 1984 favouring broad, shallow trees, and that distinct category names matter most at the top level because a wrong first pick is costly. Snowberry 1983 may show that label distinctness, not shallowness, drove the benefit — [Human Factors International review](https://www.humanfactors.com/newsletters/breadth_vs_depth_we_revisit_this_question.asp)

Naming:
- [Expert opinion] Johnson and Henderson name two bloopers: several terms for one concept, and one term for several concepts. They recommend a managed lexicon — [Conceptual Models paper](https://courses.dubberly.com/frameworks_2024_fall/Conceptual_ModelsInteractionsPaper.pdf)
- [Expert opinion] Nielsen's heuristics: use the users' words rather than internal jargon, and users should not have to wonder whether different words mean the same thing. Mismatches compound even for daily users — [NN/g, Heuristics for Complex Applications](https://www.nngroup.com/articles/usability-heuristics-complex-applications/)
- [Expert opinion] Don't assume your terms match users'; research them — [NN/g, Match Between System and Real World](https://www.nngroup.com/articles/match-system-real-world/)
- [Expert opinion] Covert: borrowing an existing vocabulary can be simpler than building one, and no controlled vocabulary removes all ambiguity (search excerpt) — [Covert, Sensemaker's Guide to Controlled Vocabularies](https://abbycovert.com/?p=7653)

Rollups:
- [Product docs] GitHub's combined status: failure if any context failed or errored, pending if a context is pending or there are no statuses, success only if the latest status of all contexts is success — [GitHub REST commit statuses](https://docs.github.com/en/rest/commits/statuses)
- [Product docs] A workflow contains jobs, and jobs contain steps — [GitHub Docs, Workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows)
- [Product docs] `continue-on-error` at step level lets a job pass despite a failed step, and at job level the other jobs are unaffected — [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax); [matrix page](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)
- [Product docs] In Buildkite, steps become jobs when a build runs, and a build's final state is set when all jobs complete. If all steps are skipped the build is `not_run`. Blocked is reported as a separate flag beside the state, and `failing` exists alongside `failed` — [Buildkite defining steps](https://buildkite.com/docs/pipelines/configure/defining-steps); [notifications](https://buildkite.com/docs/pipelines/configure/notifications)
- [Product docs] `soft_fail` lets a job fail without breaking the build, marked with a warning in the pipeline — [Buildkite build matrix](https://buildkite.com/docs/pipelines/configure/workflows/build-matrix); [changelog](https://buildkite.com/changelog/56-command-steps-can-now-be-made-to-soft-fail)
- [Community report] A soft-failed job showed as successful on the GitHub PR, surprising the team — [Buildkite forum](https://forum.buildkite.community/t/soft-fail-status-in-github-checks/3144)

### Inferences
Depth:
- Count what users see. App > Goal > Flow > Test > Step, with Run beside them, is too deep as nested pages under the two-level guidance, though that guidance is opinion and the studies concern finding items, not reading status.
- Separate model depth from navigation depth: goal as a heading on the flow list, tests as rows on the flow page, step and run detail in the side panel the product context already proposes. Users then move through two page levels.
- The depth studies matter most for label distinctness: if "goal" and "flow" names read alike ("Deposit" over "Deposit"), the level costs more than it gives.

Naming:
- CI uses a different noun at each level and separates definition from execution (step and job, workflow and workflow run, outline and row). Adopt both habits: Goal, Flow, Test, Step, Run, with no reuse.
- Forbidden compounds: "test flow", "test suite" and "test run" as separate things. "Run" alone is enough.
- Keep a one-page lexicon as Johnson and Henderson advise, including Condition and Variation. Decide whether both are needed: a condition is the reusable "what if", and a variation is one configured row. If users cannot tell them apart, drop one.
- CLAUDE.md's vocabulary should win: Passed, Failed, Couldn't run, Running, Queued, Not run yet. The product context's Broken/Review/OK is an older proposal and should not coexist with it.

Rollup rules (derived from GitHub's rule, adapted):
1. Failed if any latest test failed.
2. Otherwise Couldn't run if any could not run. It never counts as passed.
3. Otherwise Running or Queued if any is in progress.
4. Not run yet if there are no results at all. An empty goal is never Passed.
5. Passed only if all applicable tests passed.
6. Always show the denominator: "7 of 9 passed, 1 failed, 1 couldn't run".
7. Not applicable combinations leave the denominator.
8. A known or accepted failure needs a visible state. Buildkite's soft-fail shows how an accepted failure can read as a pass one level up.

Beyond worst-wins: a simple rule treats "Deposit is broken" and "a slow RPC spinner is missing" alike. Following Cockburn's two legs, consider two reads at flow level: does the main path work, and how does it hold up under conditions. That keeps "is my dApp OK?" honest without adding colours.

### Gaps
- I found no research on how many entity levels users can hold in mind, as distinct from menu depth. Common "7 plus or minus 2" or "three clicks" claims were not sourced here and should not be cited. One [Boston University page](https://wpdocs.bu.edu/cds/cds/glossary/information-architecture) attributes a three-level limit to NN/g, but the excerpt I saw cites no study.
- The depth studies used item-finding tasks on structured menus and sites, so transfer to status dashboards is unproven.
- GitHub's documentation of how job results combine into a workflow run conclusion, and any matrix job cap, were not confirmed from the pages I read. The combined-status rule above is for commit statuses.
- Covert's book passages were not read.

## What mental model do non-QA audiences bring to "test", "flow", "goal", "scenario" and "check"?

### Takeaway
There is no direct research on this, so all of it is inference from adjacent sources. "Goal" and "flow" should be safe for founders, PMs and designers. "Test" is familiar but carries more meanings than the product needs. "Scenario" is overloaded, and "check" should be avoided here because the signing review already uses it.

### Cited Findings
- [Expert opinion] Dan North found that misunderstandings of TDD almost always traced back to the word "test", and that switching to "behaviour" dissolved many coaching questions. His audience was developers — [North, Introducing BDD](https://dannorth.net/blog/introducing-bdd/)
- [Expert opinion] North's scenario is one acceptance criterion in Given/When/Then form — [same source](https://dannorth.net/blog/introducing-bdd/)
- [Expert opinion] Bach and Bolton define testing as learning about a product through exploring and experimenting, and checking as mechanistic verification of propositions — [Testing and Checking Refined](https://www.satisfice.com/blog/archives/856)
- [Expert opinion] Bolton says checks give a binary result, and that interchangeable everyday use does little harm unless the distinction matters — [Bolton, Testing vs. Checking](https://developsense.com/blog/2009/08/testing-vs-checking)
- [Expert opinion] One writer reports that dictionary meanings of the two words overlap significantly (search excerpt) — [Wirfs-Brock](https://wirfs-brock.com/blog/2013/08/20/distinguishing-between-testing-and-chec)
- [Expert opinion] For designers, "flow" is typical or ideal steps for a task in one product — [NN/g](https://www.nngroup.com/articles/user-journeys-vs-user-flows/). Practitioner articles (search summary, not read individually) disagree on whether a task flow is strictly linear, and describe user flows as branching and spanning tasks — [Built In](https://builtin.com/articles/task-flow); [Bootcamp](https://bootcamp.uxdesign.cc/user-flow-and-task-flow-explained-bf229332a16d)
- [Definition] "Scenario" means a sequence of steps in Cockburn, a synonym for Example in Gherkin, and the experience being mapped in NN/g's journey maps — [Cockburn draft](https://kurzy.kpi.fei.tuke.sk/zsi/resources/CockburnBookDraft.pdf); [Cucumber](https://cucumber.io/docs/gherkin/reference/); [NN/g](https://www.nngroup.com/articles/customer-journey-mapping/)

### Inferences

| Word | Likely reading | Advice |
|---|---|---|
| Goal | What a user is trying to do. Risk: read as a business goal or metric | Keep. Phrase as a verb, sea-level: "Deposit into a vault" |
| Flow | A designer's and PM's word for a path. Risk: designers may expect branches inside one flow | Keep. It is already the product's word |
| Test | Something with a pass or fail. Risk: other kinds of test in this audience's work | Keep at leaf only; it matches Passed/Failed vocabulary |
| Scenario | "What if…" in everyday speech; a full script to BDD users | Avoid as an entity. Fine in prose |
| Check | Light verification. Conflicts with the signing verdict "Check this" | Avoid as an entity |
| Variation | The same thing, slightly changed. Fits parameters, and GitHub uses the word. Fits failure cases less well | Good for data and wallet rows |
| Condition | Plain enough. Clashes with ISTQB only for QA users | Good for "what if" cases. Test with users |

- Non-QA users ask "does deposit work, and what happens if it goes wrong?". Goal and "what if" wording match that better than coverage terms. Avoid "coverage" as a headline word in favour of plain counts.
- "Goals, flows, tests" as a sentence is teachable, but "in what ways" should be reworded to "under what conditions", which also covers failure cases.

### Gaps
- I found no survey or study of how founders, PMs or designers interpret these words. A short card sort or tree test, as NN/g recommends for structure, would settle this cheaply.
- The search for "test" as used in A/B and usability contexts returned nothing usable, so the claim that this audience's meanings of "test" differ is my inference, not a finding.
- "Goal" as an analytics or conversion term is plausible, but I did not source it.
