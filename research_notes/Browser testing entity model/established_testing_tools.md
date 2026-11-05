# How established web2 testing, monitoring and test-management products structure and name their core entities

Researched 2026-11-05. Scope: Playwright, Cypress, Cucumber/Gherkin, mabl, Ghost Inspector, Rainforest QA, Testim, Katalon, Reflect, Datadog Synthetics, Checkly, TestRail, Xray, Zephyr, Qase.

Evidence quality, applying to the whole file:
- Pages I read directly: Playwright, Cucumber, Cypress, Datadog, Checkly, Rainforest, Reflect, Ghost Inspector (test settings, environments), Testim/Tricentis, Katalon (test suite page), Xray (project organization, coverage calculation), Zephyr glossary, Qase (runs, parameters).
- Pages that returned HTTP 403 to my fetcher: all of help.mabl.com, all of support.testrail.com, G2, Capterra. Claims for mabl and TestRail come from search-engine extracts of the official pages, not from a full read. The cited URLs are the official pages, but wording should be spot-checked before it is quoted in anything public.
- Reddit could not be searched (domain blocked for my tools), and discuss.testrail.com never surfaced. The complaint evidence is therefore thinner than the question deserves. See the Gaps under the complaints question.
- Quoted strings come through a summarising fetch tool. They are reliable for terminology but are not guaranteed verbatim to the last character.

## What is the exact entity hierarchy each product shows in its UI and docs?

### Takeaway
Nearly every product has the same five-layer skeleton: container > grouping > test > step, plus a run record. The words are not shared. "Plan", "suite", "project", "scenario" and even "test" each mean materially different things across products. Code-first tools have the fewest authored nouns, while test-management tools have the most, and they separate the template from the instance.

### Cited Findings

**Code-first**

- **Playwright** (hierarchy: config > project > file > `test.describe` > `test` > `test.step`).
  - "A project is logical group of tests running with the same configuration" — [Playwright projects](https://playwright.dev/docs/test-projects)
  - `test.describe` "Declares a group of tests" and `test.step` "Declares a test step that is shown in the report" — [Playwright Test API](https://playwright.dev/docs/api/class-test)
  - The reporter tree is Root suite > project suite > file suite > describe suite > TestCase, with `suite.type` values "root", "project", "file", "describe" — [Suite API](https://playwright.dev/docs/api/class-suite)
  - Project sits *above* file in the runtime tree, so a project is effectively a dimension applied to the tests, not a folder of them. A test running in several projects has "multiple `TestCase` objects in corresponding projects' suites" — [TestCase API](https://playwright.dev/docs/api/class-testcase)
- **Cypress** (hierarchy: project > spec > `describe`/`context` > `it`/`specify`).
  - Specs are the test files; `context()` is identical to `describe()` and `specify()` is identical to `it()`. Cypress recommends one spec per feature or user flow as a default — [Cypress: writing and organizing tests](https://docs.cypress.io/app/core-concepts/writing-and-organizing-tests)
  - Cypress Cloud adds organization > project > run > spec > test — [Cypress Cloud intro](https://docs.cypress.io/cloud/get-started/introduction)
- **Cucumber/Gherkin** (hierarchy: Feature > Rule (optional) > Example/Scenario > Step, with Background, Scenario Outline + Examples, and tags).
  - "The keyword Scenario is a synonym of the keyword Example". A file holds one Feature. Rule (since Gherkin 6) groups scenarios under one business rule — [Gherkin reference](https://cucumber.io/docs/gherkin/reference/)

**Low-code / recorded**

- **mabl** (hierarchy: workspace > application > environment; tests made of flows and steps; plans run tests; DataTable rows are scenarios).
  - Glossary terms: workspace, application, environment, flow, plan, scenario — [mabl glossary](https://help.mabl.com/docs/glossary) (search extract)
  - "A plan specifies how mabl should run tests": which application, credentials, tests, environments and when — [mabl glossary](https://help.mabl.com/docs/glossary)
  - Plans have stages that order setup and teardown — [mabl Plans](https://help.mabl.com/hc/en-us/articles/17780887930516-Plans) (search extract)
- **Ghost Inspector** (hierarchy: organization > folder > suite > test > step).
  - "All tests exists within a suite and inherit that suite's settings" — [Test settings](https://docs.ghostinspector.com/test-settings/)
  - Folders group suites on the dashboard — [Folder API](https://ghostinspector.com/docs/api/folders)
  - A suite is required, so it is both folder and settings template; test blank fields fall through to suite values.
- **Rainforest QA** (hierarchy: Tests with steps, grouped two ways: Feature and Run Group; targets are Site + Environment; runs land on the Results page).
  - "A feature is a group of tests that covers one function or workflow in your application" — [Organizing tests by feature](https://help.rainforestqa.com/docs/organizing-tests-by-feature)
  - Run Groups organize tests into categories like Smoke or Regression — [Quick start](https://help.rainforestqa.com/docs/quick-start-guide)
- **Testim** (hierarchy: project > Test library/Test List > test > step/group; Suites, Labels and Test Plans are three overlapping groupings).
  - "Test Suites give you the flexibility to manage the order between tests"; "Labels are used to associate tests with one or more characteristics"; "A test plan is a container of tests, which include specific test labels and/or test suites" — [Test management overview](https://docs.tricentis.com/testim/content/test-management/test-management-overview.htm)
- **Katalon** (hierarchy: Account > Organization > Project > Test Case > Test Suite > Test Suite Collection; platform navigation adds Plans, Tests, Executions).
  - "A Test Suite is a collection of test cases executed and reported together" and test cases are reusable across suites — [Katalon test suites](https://docs.katalon.com/katalon-platform/create-tests/create-new-test-suite-and-add-test-cases)
  - A collection groups suites to run in parallel or sequentially, with a per-suite environment and profile — [Test suite collections](https://docs.katalon.com/katalon-studio/docs/test-suite-collection.html)
  - Three management levels: Account, Organization, Project. Organizations made before 20 Dec 2023 keep an extra Team level — [Katalon roles (legacy)](https://docs.katalon.com/katalon-platform/administer/administration-roles/administrative-roles-and-permissions)
- **Reflect** (hierarchy: Tests with steps and Segments; Suites are workflows of Actions; Executions are suite runs).
  - A suite is "a complete regression testing plan". It is a sequential workflow of actions: Run Tests, Decision, Call API, Send Email, Send Slack, Wait, plus "Define Environment Settings" at the start — [Reflect suites](https://support.smartbear.com/reflect/docs/en/manage-tests/suites)

**Monitoring**

- **Datadog Synthetics** (hierarchy: Test > Step, with Subtests; Test Suite is a recent collection layer; Test Runs and Test Batches are execution).
  - "Browser tests are scenarios executed by Datadog on your web applications." Each test carries a starting URL, name, `env` tag, browsers and devices, locations and frequency — [Browser tests](https://docs.datadoghq.com/synthetics/browser_tests/)
  - Test Suites "organize multiple tests into a single collection" of up to 300 tests, grouped by "user journey, environment, location, service, team" — [Test suites](https://docs.datadoghq.com/synthetics/test_suites/)
- **Checkly** (hierarchy: Account > Project > Group > Check).
  - Check types: URL, TCP, Heartbeat, DNS and ICMP monitors; API checks, Multistep checks, Browser checks, Playwright Check Suites — [Checkly concepts](https://checklyhq.com/concepts/checks)
  - Project > Group > Check is the configuration inheritance chain, and "Groups are optional" — [Structuring a Checkly project](https://www.checklyhq.com/docs/guides/structuring-a-checkly-project/)
  - Below a Playwright Check Suite are the plain Playwright tests, selected by `pwProjects` and `pwTags` — [Playwright checks overview](https://www.checklyhq.com/docs/detect/synthetic-monitoring/playwright-checks/overview.md)

**Test management**

- **TestRail** (definition: project > test suite > section > test case; execution: milestone > test plan > test run > test > result).
  - "While a test suite is just like a plan that specifies how an application is tested, a test run is an actual test you are conducting" — [Introduction to TestRail](https://support.testrail.com/hc/en-us/articles/7076810203028) (search extract)
  - A "test" is the instance of a case within a specific run — [api-evangelist TestRail summary](https://github.com/api-evangelist/testrail) (third-party, consistent with the intro page)
  - Three project types: Single Repository, Single Repository with Baseline Support, Multiple Test Suites — [Projects and their types](https://support.testrail.com/hc/en-us/articles/7076923860244-Projects-and-their-types) (search extract)
- **Xray** (Jira issue types: Test, Precondition, Test Set, Test Plan, Test Execution, Sub-Test Execution; requirements are usually Stories or Epics).
  - Listed in [Xray project organization](https://docs.getxray.app/space/XRAYCLOUD/44566397/Project+Organization)
  - Test Run is deliberately *not* an issue type — [Xray time tracking](https://docs.getxray.app/space/XRAYCLOUD/44565086/Time+Tracking)
- **Zephyr** (Test Library > Test Case with Test Script; Test Cycle; Test Plan; Test Execution Result).
  - A Test Cycle is an ordered set of test cases assigned to testers and environments. A Test Plan tracks progress across a release, with cycles linked to it. Test Environment is "an attribute of a test execution result" — [Zephyr glossary](https://support.smartbear.com/zephyr/docs/en/get-started/zephyr-scale-glossary.html)
- **Qase** (workspace > project > repository > suite > test case > steps; test plan; test run; milestone; environment; configurations).
  - Suites are purely organizational folders that can nest — [Qase test suites](https://docs.qase.io/general/get-started-with-the-qase-platform/create-a-test-suite) (search extract)
  - A test run is "a single execution of a set of test cases", drawn from the repository, a test plan or a saved QQL query — [Qase test runs](https://docs.qase.io/en/articles/5563702-test-runs)

**Same word, different thing** (from the sources above)

| Word | Meanings across products |
|---|---|
| Plan | mabl: run configuration. Testim: ordered container of suites and labels. Xray: scope plus result consolidation. Zephyr: release progress tracker. TestRail: container of runs across configurations. Qase: saved case selection. Reflect: a suite *is* a "regression testing plan". |
| Suite | Playwright: any grouping node incl. file/project. Qase: passive folder. TestRail: case repository. Ghost Inspector: required folder + settings. Testim: ordered group. Reflect: workflow. Datadog: alerting collection. Katalon: execution and reporting unit. Checkly: a whole check type. |
| Project | Playwright: a configuration variant. Everywhere else: top-level container. |
| Test | TestRail: instance of a case in a run. Xray: reusable template/specification. Datadog/Ghost/Reflect: the journey itself. |
| Scenario | Gherkin: the test itself. mabl: one row of a DataTable. Datadog prose: a browser test. |
| Feature | Gherkin: a file of scenarios. Rainforest: an exclusive test group. Cypress: an informal guide for how to split specs. |

**Outdated or moved** (check before citing)

- Testim docs have moved: help.testim.io now 301-redirects to docs.tricentis.com — [redirect observed on test management overview](https://help.testim.io/docs/test-management-overview).
- Reflect docs: reflect.run/docs redirects into SmartBear, and the live docs are at support.smartbear.com — [Reflect suites](https://support.smartbear.com/reflect/docs/en/manage-tests/suites).
- Zephyr: SmartBear docs now say just "Zephyr", and Cloud and Server docs differ — [Zephyr glossary](https://support.smartbear.com/zephyr/docs/en/get-started/zephyr-scale-glossary.html).
- Checkly `CheckGroup` is deprecated in favour of `CheckGroupV2` since CLI v6.0.0 — [Checkly groups update](https://www.checklyhq.com/changelog/checkly-groups-update/). The Playwright Check Suites overview was reported as saying Beta in one extract, and that may be stale.
- Katalon has legacy TestOps pages and newer platform pages; G2 lists it as "Katalon True Platform" — [G2 comparison](https://www.g2.com/compare/ghost-inspector-vs-katalon-platform).
- mabl now describes itself as an agentic testing platform, so menu names may have moved since its older help articles — [third-party review](https://tooliverse.ai/tools/mabl).

### Inferences
- The one structural split that matters is whether the authored test is separated from its run instance by a named entity. Test-management tools name it (TestRail test, Xray Test Run, Qase instance). Automation tools just call it a run.
- "Suite" is the least trustworthy word in the category. "Plan" is close behind. A new product can avoid both without losing anything users rely on.
- Playwright's Project is an outlier in meaning but the cleanest in structure: it treats configuration as an axis across tests rather than a container of them.

### Gaps
- No product-by-product confirmation of current UI labels from a logged-in app. Everything here comes from docs.
- Exact nesting of Katalon sprints, releases and plans is not stated on any page I found.
- Whether Xray "Test Repository" is a separate type was inconsistent between an Xray blog and the docs. Docs list Sub-Test Execution, and the search extract notes the conflict.

## How does each represent "same journey, different conditions"?

### Takeaway
There are four distinct patterns: expand one test by data rows, apply a configuration axis at run time, duplicate the test, or override variables at trigger time. Nearly every product treats data variation and environment/browser variation as separate mechanisms. Few have a first-class word for the resulting variant, and the words used are row, scenario, iteration, instance and variant.

### Cited Findings

| Product | Data variation | Environment / browser variation | Name of one variant |
|---|---|---|---|
| Playwright | `forEach` loops, CSV-generated tests | Projects, option fixtures, env vars | Separate test / TestCase per project |
| Cypress | JS loops; data must exist at spec load | Per-test config overrides; CI matrix for browsers | Separate `it` |
| Cucumber | Scenario Outline + Examples | Outside Gherkin; tags | Examples row |
| mabl | DataTable | Plan with environments | Scenario |
| Ghost Inspector | Data Source rows | Start URL override, variables, per-env CSV | Data row |
| Rainforest | Not established | Site + environment, run group platforms | Not established |
| Testim | Data sets, config-file data | Plan config override | Data set |
| Katalon | Test suite data binding | Execution profile, per-suite "Run with" | Not established |
| Reflect | Test parameters spreadsheet | Define Environment Settings; browsers in Run Tests | Variant |
| Datadog | Variables only; no CSV feature found | Locations, browsers, devices on the test | Test run |
| Checkly | Env vars | Locations; check > group > global vars; Playwright projects | Check run |
| TestRail | None found | Configurations on a plan | Test run per configuration |
| Xray | Dataset | Test Environment on execution | Iteration |
| Zephyr | Test Data, parameters | Environment on the result | Not established |
| Qase | Parameters (single and group) | Configurations; environment on the run | Instance |

- **Playwright.**
  - Four documented techniques: per-test `forEach`, project-level option fixtures, environment variables, and CSV-driven generation. Names must stay unique, and hook placement relative to the loop changes behaviour — [Playwright parameterize](https://playwright.dev/docs/test-parameterize)
  - Projects cover browsers, devices, environments such as staging and production, and test splitting — [Playwright projects](https://playwright.dev/docs/test-projects)
- **Cypress.** Data-driven tests must have their data when the spec loads, so `cy.fixture()` and `cy.task()` cannot create `it()` blocks. Config overrides apply per suite or test — [Cypress organizing tests](https://docs.cypress.io/app/core-concepts/writing-and-organizing-tests). Browser matrices are commonly done in CI — [QASkills guide](https://qaskills.sh/blog/cypress-environments-config-best-practices) (third-party).
- **Cucumber.** A Scenario Outline runs "multiple times, with different combinations of values", is "never directly run", and runs once per Examples row — [Gherkin reference](https://cucumber.io/docs/gherkin/reference/)
- **mabl.**
  - A scenario is "a specific row in a DataTable", with the first column naming it — [mabl glossary](https://help.mabl.com/docs/glossary)
  - A test linked to a DataTable generates one run per scenario — [Data-driven variables](https://help.mabl.com/hc/en-us/articles/19078251516692-Data-driven-variables) (search extract)
  - A plan runs every test once per associated environment — [mabl Plans](https://help.mabl.com/hc/en-us/articles/17780887930516-Plans) (search extract)
  - Precedence: DataTable scenario, then shared variables, environment values, test defaults, flow defaults — same data-driven source.
- **Ghost Inspector.** Three approaches: start URL override, variables in the start URL, and a single-row CSV Data Source per environment — [Dynamic environments](https://docs.ghostinspector.com/reusing-tests-different-environments/). Data Concurrency caps simultaneous rows — [Test settings](https://docs.ghostinspector.com/test-settings/)
- **Rainforest.** Run groups set environment, platforms, retries — [How to create and manage a run group](https://help.rainforestqa.com/docs/how-to-create-and-manage-a-run-group) (search extract). The sources I read did not cover data-driven tests.
- **Testim.**
  - Selecting multiple configurations in a plan produces multiple executions — [Test plans](https://help.testim.io/docs/test-plans) (search extract)
  - The editor runs only the first data set; extra sets need the CLI or Scheduler — [Data-driven testing](https://help.testim.io/docs/data-driven-testing) (search extract, a page roughly seven years old by metadata)
- **Katalon.** Data binding on a test suite maps data files to variables — [Data-driven testing in a suite](https://docs.katalon.com/katalon-studio/data-driven-testing/data-driven-testing-in-a-test-suite). Execution profiles hold variable values per suite execution — [Test suite collections](https://docs.katalon.com/katalon-studio/docs/test-suite-collection.html). So variation is attached to the *suite*, not the test case.
- **Reflect.** "A test needs at least one parameter before it can have data-driven variants", and each variant has its own row in the Tests table. The parameters spreadsheet lives in the suite's Run Tests action and supports CSV. Environment overrides are a suite-level action — [Reflect suites](https://support.smartbear.com/reflect/docs/en/manage-tests/suites). This puts variation on the *suite*.
- **Datadog.** One test fans out across locations and browsers/devices; global and local variables supply values — [Browser tests](https://docs.datadoghq.com/synthetics/browser_tests/). Search did not surface CSV or data-driven runs for browser tests.
- **Checkly.**
  - Check variables override group variables, which override global variables — [Variables](https://www.checklyhq.com/docs/platform/variables/)
  - Its Playwright guide branches `baseURL` on `process.env.CHECKLY` and chooses a `monitoring` project with `pwProjects` — [Playwright environments guide](https://www.checklyhq.com/docs/guides/playwright-environments/)
  - In other words, Checkly passes the variant problem to Playwright projects.
- **TestRail.** A plan can start multiple runs against multiple configurations, "without duplicating work" — [Create new test plans](https://support.testrail.com/hc/en-us/articles/30765296499604) (search extract). Baselines copy a master case set and are only recommended for long-lived parallel versions — [Projects and their types](https://support.testrail.com/hc/en-us/articles/7076923860244-Projects-and-their-types) (search extract).
- **Xray.**
  - A dataset is a table with a column per parameter and a row per iteration, capped at 1000 iterations and 20 parameters in Cloud. The dataset closest to the run overrides those above it — [Parameterized tests](https://docs.getxray.app/display/XRAYCLOUD/Parameterized+Tests) (search extract)
  - Xray notes environments can be treated as a special case of parameters but datasets might not suit that. One failed iteration means re-executing all iterations in a new run — same page.
  - Each environment gets its own Test status, then "All Environments" combines them: any FAIL is FAIL, PASS only if all pass — [Xray coverage calculation](https://docs.getxray.app/space/XRAY/301669557/Understanding+coverage+and+the+calculation+of+Test+and+requirement+statuses)
- **Zephyr.** Test Data separates data from the test case, and parameters pass values into called tests — [TM4J release notes](https://support.smartbear.com/tm4j-server/docs/release-notes/v4.html). Environment is an attribute of the result — [Zephyr glossary](https://support.smartbear.com/zephyr/docs/en/get-started/zephyr-scale-glossary.html).
- **Qase.** Single parameters produce the Cartesian product, group parameters produce one instance per row, and the cap is 1,024 combinations. In a run "Each instance shows its specific parameter values", and a Siblings tab lists the other combinations — [Qase parameters](https://docs.qase.io/en/articles/6640037-test-case-parameters). Configurations get "their own result set within the run" — [Qase test runs](https://docs.qase.io/en/articles/5563702-test-runs).

### Inferences
- The most user-legible designs keep one authored thing and show variants as children of it. Qase's instance + Siblings tab and Reflect's variant rows are the closest to this. Xray's iterations are similar but tie iterations to one run.
- Where variation lives differs: on the test (mabl, Xray, Qase, Datadog), on the suite (Reflect, Katalon), on the run or plan (TestRail, Testim), or in config (Playwright). Only the test-attached model keeps the variant visible while reading the test.
- Unhappy-path conditions such as reject, slow RPC or wrong network have no direct web2 analogue. Web2 variants change data or environment, and none of these products has a concept for "same journey, deliberately broken condition". This inference rests on absence from the docs I read, not on a source that says so.
- Parameter rows and configurations are usually orthogonal. Qase is the only product here that documents both expanding inside one run.

### Gaps
- Whether Rainforest has a data-driven feature (it may, under a different name).
- Whether TestRail has native parameters. I found no evidence of them, but TestRail docs could not be read directly.
- Whether Datadog offers CSV-driven browser tests. Search found nothing, which is weak negative evidence.

## How does each represent reuse?

### Takeaway
All low-code and test-management tools converged on the same primitive: a named, linked step sequence where one edit propagates. They disagree on three things: whether it is a test or a separate object, whether it can nest, and whether it takes parameters. Code-first tools reuse through ordinary code plus fixtures.

### Cited Findings

| Product | Reuse name | Is it a test? | Takes parameters? | Nesting |
|---|---|---|---|---|
| Playwright | Fixture, page object | No | Option fixtures | Fixtures depend on fixtures |
| Cypress | Custom command, support file, fixture (data) | No | JS args | Code |
| Cucumber | Step definitions, Background | No | Step args | n/a |
| mabl | Flow | No | Flow parameters | Not established |
| Ghost Inspector | Module (Import Only test) | Yes | Variables | Not established |
| Rainforest | Embedded test, snippet | Embedded: yes. Snippet: no | Not established | Not established |
| Testim | Shared group / shared step | No | Yes, per call | Yes |
| Katalon | Test case reuse across suites; keywords; listeners | Partly | Variables | Not established |
| Reflect | Segment | No | Not established | Not allowed |
| Datadog | Subtest | Yes | Same-name variable override | Two levels |
| TestRail | Shared steps | No | None found | Not established |
| Xray | Precondition; modular tests | Mixed | Modular tests, per a third party | Not established |
| Zephyr | Call to Test | Yes | Yes | Nested, with a reported bug |
| Qase | Shared steps (project or workspace), shared parameters | No | Requested on roadmap | Not established |

- **Playwright.** "Fixtures are reusable between test files", set up only what a test needs, and "encapsulate setup and teardown in the same place". They complement page objects rather than replace them — [Playwright fixtures](https://playwright.dev/docs/test-fixtures)
- **Cypress.** Support file for custom commands and global hooks; `cypress/fixtures` is static *data*, which is a different meaning from Playwright fixtures — [Cypress organizing tests](https://docs.cypress.io/app/core-concepts/writing-and-organizing-tests)
- **Cucumber.** Background steps run before each scenario — [Gherkin reference](https://cucumber.io/docs/gherkin/reference/). Step definitions are global with no namespacing, which is a practitioner complaint — [When Cucumber grows too big](https://dev.to/luiinge/when-cucumber-grows-too-big-pain-points-lessons-learned-and-alternatives-21pm)
- **mabl.** "Flows can be reused across multiple tests" — [mabl glossary](https://help.mabl.com/docs/glossary). Parameters are scoped to the flow, and the fallback is flow data-driven variables, which mabl steers people away from — [Flow parameters](https://help.mabl.com/hc/en-us/articles/19078195443732-Working-with-flow-parameters-in-the-mabl-Trainer) (search extract), [Flow data-driven variables](https://help.mabl.com/hc/en-us/articles/19078272489364-Flow-data-driven-variables) (search extract)
- **Ghost Inspector.** A test can be "designed as a module to have its steps imported into other tests". Enabling Import Only blocks direct runs and will "purge all previous results and reset the test's statuses" — [Test settings](https://docs.ghostinspector.com/test-settings/)
- **Rainforest.** Any test can be embedded in another test; snippets group frequently used steps; older custom actions now appear as embedded tests — [Visual editor glossary](https://help.rainforestqa.com/docs/visual-editor-test-actions-glossary) (search extract)
- **Testim.** Shared groups propagate edits; "Replace with clone" forks one instance; hidden shared steps leave existing usage alone — [Testim groups](https://docs.tricentis.com/testim/content/editing-tests/groups/index.htm). Parameters differ per call — [Shared steps](https://help.testim.io/docs/shareable-steps) (search extract)
- **Reflect.** Segments are "named sequences of test steps". "Segments cannot reference other segments" — [Reflect composition](https://reflect.run/docs/recording-tests/composition) (search extract; reflect.run/docs pages now redirect to SmartBear). Tests can also pass variables to later tests in a suite if order is guaranteed — [Reflect suites](https://support.smartbear.com/reflect/docs/en/manage-tests/suites)
- **Datadog.** Subtests come from an existing test or are extracted from steps, nesting is limited to two levels, and a subtest can be paused so it only runs in its parent. "A variable always uses the value that was first assigned to it" — [Browser test steps](https://docs.datadoghq.com/synthetics/browser_tests/test_steps/)
- **Checkly.** Reuse is code; groups and project defaults share configuration — [Structuring a Checkly project](https://www.checklyhq.com/docs/guides/structuring-a-checkly-project/)
- **TestRail.** Shared steps arrived in 7.0, and only consecutive steps can be shared — [Announcing TestRail 7.0](https://www.testrail.com/blog/announcing-testrail-7-0/), [Shared steps](https://support.testrail.com/hc/en-us/articles/7101778857236) (search extract)
- **Xray.** Preconditions are reusable and their type must match the Test type — [Xray Quick Guide for Tester](https://docs.getxray.app/space/XRAY/159907852/Quick+Guide+for+Tester) (search extract). A Qase roadmap post says Xray has modular tests with per-instance parameters — [Qase roadmap](https://roadmap.qase.io/qase-roadmap/p/parameterized-shared-steps)
- **Zephyr.** "Call to Test functionality (formerly Shared Steps)" breaks test cases into reusable pieces and recombines them into end-to-end scenarios — [TM4J release notes](https://support.smartbear.com/tm4j-server/docs/release-notes/v4.html)
- **Qase.** Shared steps exist at project and workspace levels, with edits propagating — [Qase shared steps](https://docs.qase.io/en/articles/5563709-shared-steps) (search extract). Shared parameters are workspace-level and not editable from inside a case — [Qase parameters](https://docs.qase.io/en/articles/6640037-test-case-parameters)

### Inferences
- Tests-calling-tests (Datadog, Ghost Inspector, Rainforest embed, Zephyr) avoids a new noun, but it forces the "should this also run alone?" question. Datadog answers with pausing, and Ghost Inspector with Import Only, which destroys history. A dedicated noun (flow, segment, shared group) avoids that at the cost of one more concept.
- Zephyr renaming Shared Steps to Call to Test suggests the two ideas collapse together over time, and Rainforest folding custom actions into embedded tests points the same way.
- Parameters are the gap between shallow and useful reuse. Demand for them shows up where they are missing (Qase roadmap).

### Gaps
- Nesting limits for mabl flows, Rainforest embedded tests and Qase shared steps were not confirmed.
- No usage data on how much of a suite ends up in shared steps in practice.

## How is definition separated from execution, how do results roll up, and what does the dashboard lead with?

### Takeaway
Everyone has a run record. The important differences are what the unit of rollup is and whether status is latest-wins, worst-wins or derived. Monitoring tools lead with current health and uptime, automation clouds lead with the latest run and flaky failures, and test-management tools lead with progress against a release or requirement.

### Cited Findings

| Product | Authored | Execution entities | Rollup rule / lead view |
|---|---|---|---|
| Playwright | test, describe, project | TestCase, TestResult per retry | `outcome()`: skipped, expected, unexpected, flaky |
| Cypress | spec, test | Run, spec, test, attempt | Latest Runs; Tests for Review |
| Cucumber | Feature, Scenario | Depends on the runner | Not product-defined |
| mabl | Test, flow, plan | Plan run, test run | Results by test, plan and deployment event |
| Ghost Inspector | Test, suite | Results, per test and suite | Not established |
| Rainforest | Test, feature, run group | Runs on Results page | Not established |
| Testim | Test, suite, plan, label | Executions | Not established |
| Katalon | Test case, suite, collection | Manual / Automated Test Run | Release readiness |
| Reflect | Test, suite | Execution, attempts | Statistics, Workflow, Failures, Tests |
| Datadog | Test, suite | Test run, test batch | Test health, Coverage gaps |
| Checkly | Check, group | Check run/result, retries | Alert only after final attempt |
| TestRail | Case, section, suite | Test, run, plan, milestone | Comparison across runs, configurations and milestones |
| Xray | Test, Test Set, Precondition | Test Execution, Test Run, iteration | Final-status precedence; requirement status |
| Zephyr | Test case | Test execution result, cycle, plan | Last execution sets status; plan progress |
| Qase | Case, suite, plan | Run, instance, result, retry | Calculated once at completion |

- **Playwright.** `results` holds "Results for each run of this test", and `outcome()` distinguishes flaky from unexpected — [TestCase API](https://playwright.dev/docs/api/class-testcase). `testInfo.retry` numbers each run from 0 and `status` is compared against `expectedStatus` — [TestInfo API](https://playwright.dev/docs/api/class-testinfo)
- **Cypress Cloud.**
  - Flaky tests are those that retried then passed, badged on Latest Runs and Test Results — [Test retries](https://docs.cypress.io/app/guides/test-retries) (search extract)
  - Run Details has Overview, Test Results, Specs and Errors tabs; Overview has "Tests for Review" for Failed, Flaky and Modified — [Recorded runs](https://docs.cypress.io/cloud/features/recorded-runs) (search extract)
  - Branch Review compares against another branch or run — same page.
- **mabl.** Results are organised by test, plan and deployment event — [Reviewing test results](https://help.mabl.com/hc/en-us/articles/19083852210964-Reviewing-test-results) (search extract). The home dashboard shows coverage across all apps — [Measuring coverage in web apps](https://help.mabl.com/hc/en-us/articles/19083867227412-Measuring-coverage-in-web-apps) (search extract).
- **Reflect.** Execution detail has Statistics, Workflow, Failures and Tests. "Re-run Failed Tests" starts a new attempt on the same page. Pass rate uses a rolling 30-day window — [Reflect suites](https://support.smartbear.com/reflect/docs/en/manage-tests/suites)
- **Datadog.**
  - "Every test corresponds to a test run for a particular test subtype, including fast retries". A batch corresponds to one API/CI call — [Results Explorer](https://docs.datadoghq.com/synthetics/explore/results_explorer/)
  - The overview page leads with "Test health" and "Coverage gaps" — [Overview page](https://docs.datadoghq.com/synthetics/explore/overview/)
  - A suite shows aggregated results, global uptime, and an auto-generated SLO (default 7-day window, 99.9%). Alerts can use Critical/Ignored tests and a percentage threshold — [Test suites](https://docs.datadoghq.com/synthetics/test_suites/)
- **Checkly.** Alerts are sent "only if the final attempt has failed" and escalation settings are met — [Checkly concepts](https://checklyhq.com/concepts/checks). Total attempts are `maxRetries + 1` — [RetryStrategyBuilder](https://www.checklyhq.com/docs/constructs/retry-strategy/) (search extract). Docs navigation is Detect, Communicate, Resolve — [Checkly docs](https://www.checklyhq.com/docs/)
- **TestRail.** A run consists of individual tests for each case added; closed runs cannot be edited and serve as archives — [phpconference TestRail article](https://phpconference.com/blog/professional-test-management-with-testrail-part2/) (third-party). Milestones can nest; plans inherit milestone dates unless they define their own — [Milestones best practices](https://support.testrail.com/hc/en-us/articles/32747143021716-Best-Practices-Guide-Milestones) (search extract)
- **Xray.** With final-status precedence (the default), a newer TODO or EXECUTING run does not replace an earlier PASS or FAIL. Requirements map PASS to OK, FAIL to NOK, in-progress to NOTRUN, and no linked Tests to UNCOVERED — [Xray coverage calculation](https://docs.getxray.app/space/XRAY/301669557/Understanding+coverage+and+the+calculation+of+Test+and+requirement+statuses)
- **Zephyr.** A test case can run more than once in a cycle, and its status comes from the last execution — [Test cycles overview](https://support.smartbear.com/zephyr-scale-cloud/docs/en/test-cycles/test-cycles--overview-.html) (search extract). Zephyr Cloud also allows runs outside any cycle — [Executing a single test case](https://support.smartbear.com/zephyr-scale-cloud/docs/en/test-cases/executing-a-single-test-case.html) (search extract)
- **Qase.** Five default result statuses: Passed, Failed, Blocked, Skipped, Invalid. "A second attempt inside the same run is a retry", shown on a Retries tab. "Run status (Passed/Failed) is calculated once at completion", with muted tests excluded — [Qase test runs](https://docs.qase.io/en/articles/5563702-test-runs)
- **Katalon.** Suites let teams track results and trends at the suite level — [Katalon test suites](https://docs.katalon.com/katalon-platform/create-tests/create-new-test-suite-and-add-test-cases). Releases are evaluated for readiness from execution results — [Katalon Academy](https://academy.katalon.com/courses/getting-started-with-the-katalon-platform/) (search extract)

### Inferences
- Three separate things get called "attempt" or "retry": Playwright/Cypress retry, Reflect's re-run of failed tests, and Qase's human retry. Flaky is only defined where retries are automated.
- A test needs a rollup rule when it has multiple variants. Xray's is the only one I found written out precisely: per-environment first, then worst-wins, and a coverage status that includes "no tests" as a real state.
- UNCOVERED and "Coverage gaps" are the two ideas that tell a user what they are not testing. Everything else only reports on what exists.

### Gaps
- What Checkly's check overview, Ghost Inspector's suite view, Rainforest's Results page and Testim's dashboard lead with. I could not see these without an account, and docs did not say.
- Playwright HTML report layout was not researched beyond the reporter API.

## Does any product have a top-level concept above the test, and does it get real use?

### Takeaway
Yes, and it comes in three types: hand-authored (Gherkin Feature, Rainforest feature), imported from an issue tracker (Xray, Zephyr and Katalon requirements), and derived from real usage (Datadog actions, mabl pages). Evidence suggests hand-maintained links decay unless the workflow forces them, and derived coverage needs no upkeep. I found no usage statistics, so "real use or ignored" is only answered qualitatively.

### Cited Findings
- **Gherkin Feature / Rule.** Feature gives a high-level description and collects scenarios; Rule represents one business rule — [Gherkin reference](https://cucumber.io/docs/gherkin/reference/). The core team calls Cucumber "first and foremost a tool to test your understanding of the problem domain" — [Cucumber anti-patterns part 1](https://cucumber.io/blog/bdd/cucumber-antipatterns-part-one) (2016).
- **Practitioners report the Feature layer stops being read.**
  - Product owners stop reading after the first sprint and files become "developer-only artifacts" — [When Cucumber grows too big](https://dev.to/luiinge/when-cucumber-grows-too-big-pain-points-lessons-learned-and-alternatives-21pm) (single author promoting an alternative)
  - Stakeholders "stopped reading them after sprint two" — [dev.to, Qawalah](https://dev.to/qawalah/3-things-nobody-tells-you-about-bdd-before-your-cucumber-suite-becomes-a-maintenance-nightmare-9c7)
  - "Business does not contribute to or consume Feature (Gherkin) files" — [Cuke, we are doing it wrong](https://www.slideshare.net/slideshow/cuke-we-aredoingitwrong/45224948)
  - Counterpoint: shared vocabulary is argued to catch misunderstandings early — [helpmetest Cucumber guide](https://helpmetest.com/blog/cucumber-testing-guide) (vendor)
- **Rainforest Feature.** "Features allow you to view the test coverage for a portion of your application" and a feature can be run directly — [Organizing tests by feature](https://help.rainforestqa.com/docs/organizing-tests-by-feature). "A test can only be included in one feature group at a time", which makes it a partition, unlike non-exclusive run groups. Names should map to product areas, with logged-in and logged-out flows separated — [Feature best practices](https://help.rainforestqa.com/docs/feature-best-practices). This is the closest web2 match to a product-area layer in a recorded-test tool.
- **Xray requirements.** Jira Stories or Epics are configured as "Covered Issue Types" — [Xray project organization](https://docs.getxray.app/space/XRAYCLOUD/44566397/Project+Organization). Their status is computed from linked tests, and sub-requirements propagate NOK — [Xray coverage calculation](https://docs.getxray.app/space/XRAY/301669557/Understanding+coverage+and+the+calculation+of+Test+and+requirement+statuses). Reports can be scoped by version, Test Plan and environment — [Overall requirement coverage](https://docs.getxray.app/display/XRAY/Overall+Requirement+Coverage+Report) (search extract)
- **Katalon requirements.** Sourced from Jira or Azure DevOps; many-to-many with test cases — [Analyze requirement traceability](https://docs.katalon.com/katalon-platform/analytics/test-coverage/analyze-requirement-traceability) (search extract)
- **Zephyr.** A test case may exist to verify "compliance with a requirement", and the Test Plan is release-level — [Zephyr glossary](https://support.smartbear.com/zephyr/docs/en/get-started/zephyr-scale-glossary.html)
- **TestRail, Qase.** The above-test layer is a time-based Milestone, not a product area — [Milestones best practices](https://support.testrail.com/hc/en-us/articles/32747143021716-Best-Practices-Guide-Milestones), [Qase test runs](https://docs.qase.io/en/articles/5563702-test-runs)
- **Traceability upkeep.** TestRail's own blog says each extra column adds upkeep and "maintenance is where traceability dies" — [TestRail RTM guide](https://www.testrail.com/blog/requirements-traceability-matrix/) (search extract). Test cases get added without links, leaving orphans — [TestRail coverage vs traceability](https://www.testrail.com/blog/test-coverage-traceability/) (search extract). Testers find link updates tedious busywork — [Kualitee](https://www.kualitee.com/blog/test-management/requirements-traceability-matrix-death-by-excel-or-a-useful-tool/). Jama warns that deferred upkeep widens the gap between matrix and reality — [Jama guide](https://www.jamasoftware.com/requirements-management-guide/requirements-traceability/requirements-traceability-matrix-pros-and-cons/). All are vendors selling a fix.
- **Datadog, derived coverage.** The Test Coverage page reports percent of RUM browser actions tested, plus Untested Actions and Tested Actions, computed from real sessions — [Test coverage](https://docs.datadoghq.com/synthetics/platform/test_coverage/) (search extract). Test Suites offer "user journey" as a grouping — [Test suites](https://docs.datadoghq.com/synthetics/test_suites/).
- **mabl, derived coverage.** Page coverage is computed from link crawler output, and a page with 0 tests is visited only by the crawler — [Understanding coverage by page](https://help.mabl.com/hc/en-us/articles/21879889896340-Understanding-coverage-by-page) (search extract). mabl's Application is a container defined per product or finer — [mabl glossary](https://help.mabl.com/docs/glossary).
- **Checkly.** Recommends organising by service: "service folders are the ones that survive a reorg" — [Structuring a Checkly project](https://www.checklyhq.com/docs/guides/structuring-a-checkly-project/)
- **Cypress, Playwright.** Nothing above the file besides folders and tags. Cypress's guidance is one spec per feature or user flow — [Cypress organizing tests](https://docs.cypress.io/app/core-concepts/writing-and-organizing-tests). Playwright tags are free-form `@` strings — [Playwright Test API](https://playwright.dev/docs/api/class-test)

### Inferences
- A word like "feature" or "journey" above the test survives when it does a job: run this group, show coverage for it, or gate a release. Rainforest's is runnable, and Xray's computes a status. Gherkin's Feature does neither on its own, which may be why it decays to a filename.
- Exclusive membership (Rainforest) gives clean rollups; many-to-many (Katalon, Xray) mirrors reality but is what creates link upkeep.
- For a product where an agent generates the map, the derived model (Datadog, mabl) is the closest analogue: the layer above the test comes from observing the app, so nobody maintains it. That is my reading, not a source's claim.
- None of the products in scope uses "goal" or "journey" as a first-class entity. "User journey" appears only as Datadog's suggested way to group a suite, and Cypress says "user flow" in prose.

### Gaps
- No quantitative evidence for how many teams use requirement coverage, Rainforest features, or Gherkin Rule. I found no usage survey.
- Gherkin Rule adoption in particular: nothing found either way.
- TestRail's references field to Jira was not researched because its docs were unreachable.

## What do users complain about in these models?

### Takeaway
The complaint themes are stable: template-versus-run confusion, overlapping groupings, hierarchies that do not match how teams work, reuse that stops short of parameters, and top-level artefacts that nobody reads. Direct, first-hand evidence was hard to reach. Much of what follows comes from vendor docs revealing limits, competitor blogs and small review samples, so treat it as directional.

### Cited Findings

**Template versus run / plan versus suite confusion**

- TestRail needs official wording to explain suite versus run — [Introduction to TestRail](https://support.testrail.com/hc/en-us/articles/7076810203028). A third-party explainer page exists specifically for it — [velog: TestRun and TestPlan on TestRail](https://velog.io/@dahunyoo/TestRun-and-TestPlan-on-Testrail).
- Xray: the common mistakes listed are using a Plan as a run, one Execution for a whole release, using a Test Set as a dashboard, and writing results into the Test issue. "Executions have dates. Tests should not." — [QA Workflow, Xray plan vs execution](https://www.qaworkflow.net/blog/xray-test-plan-vs-test-execution) (a vendor selling Jira QA tooling).
- Xray can puzzle people unfamiliar with Jira issue types — [Testsigma Xray guide](https://testsigma.com/blog/xray-test-management-for-jira/) (competitor). Definitions in the wild conflict on whether a Test Set is ordered and whether sets sit inside plans — [Medium walkthrough](https://medium.com/@eveciana21/create-and-manage-test-plans-using-xray-in-jira-a-step-by-step-guide-0e68b26d9623), [Atlassian tutorial](https://www.atlassian.com/devops/testing-tutorials/jira-xray-integration-manage-test-cases).

**Overlapping groupings**

- Testim offers Suites, Labels and Test Plans for overlapping purposes. Suites run from the Suites screen "will only run locally", and scheduled plans block overriding configs — [Test plans](https://help.testim.io/docs/test-plans) (search extract; the "only run locally" line may come from a sibling Testim page, so verify before quoting). This is my reading of docs, not a user complaint.
- Rainforest has features *and* run groups *and* tags — [Run groups](https://help.rainforestqa.com/docs/organizing-tests-by-run-group) (search extract). Docs rather than a complaint.
- Checkly's groups were both folders and enforced config. It has now made overrides optional, so new groups "behave like simple folders" — [Checkly groups update](https://www.checklyhq.com/changelog/checkly-groups-update/). The changelog gives no reason, but the change is a signal that combining the two roles did not work for everyone.
- Checkly uses "check" and "monitor" without a clear boundary: "Checks are automated monitors" while the list has "URL monitors" — [Checkly concepts](https://checklyhq.com/concepts/checks). The platform page separates "uptime monitors" from "synthetic checks" — [Checkly platform](https://www.checklyhq.com/platform).

**Rigid hierarchy and sprawl**

- TestRail: "Rigid project structure: TestRail's fixed hierarchy doesn't flex to match agile workflows" — [aqua cloud migration guide](https://aqua-cloud.io/migrate-testrail-comprehensive-guide-seamless-migration/) (competitor). Testomat advises deleting duplicate suites and consolidating overlapping cases before migrating — [Testomat migration guide](https://testomat.io/blog/migrate-from-testrail/) (competitor).
- TestRail limits: a run can only draw from one suite in multi-suite mode, and moving away from multi-suite is much harder than moving to it — [Projects and their types](https://support.testrail.com/hc/en-us/articles/7076923860244-Projects-and-their-types) (search extract). This is vendor-documented, and it implicitly recommends a single repository.
- Katalon: running a collection once took five manual steps across Studio and TestOps — [Katalon Jan 2022 release](https://katalon.com/resources-center/blog/testops-jan-2022-release) (since improved). A user reports suites not appearing in TestOps — [Katalon forum](https://forum.katalon.com/t/test-suite-test-suite-collection-not-detected-in-testops/165084). Automated and manual cases cannot mix in a suite — [Katalon test suites](https://docs.katalon.com/katalon-platform/create-tests/create-new-test-suite-and-add-test-cases). A feature request asks for a global data-binding default — [Katalon forum](https://forum.katalon.com/t/there-should-be-an-global-level-option-to-select-the-data-binding-options-at-the-test-suite-level/187987).
- Zephyr: Test Cycles "can be wonky when testing from JIRA", and viewing result history "isn't very straightforward" — review extracts via [GetApp](https://www.getapp.ca/software/2059498/zephyr-scale) and [aqua cloud review](https://aqua-cloud.io/zephyr-review-and-insights-what-users-actually-say-about-this-tms/) (competitor, tiny samples).

**Reuse and variants that stop short**

- Qase users ask for parameterized shared steps — [Qase roadmap](https://roadmap.qase.io/qase-roadmap/p/parameterized-shared-steps)
- Zephyr: a nested Call to Test driven by a data set did not iterate — [SmartBear community](https://community.smartbear.com/discussions/ZephyrScale/triple-nested-call-to-test-not-seeing-driver-test-case/275061) (single report)
- Xray: if one iteration fails you must re-execute all iterations — [Parameterized tests](https://docs.getxray.app/display/XRAYCLOUD/Parameterized+Tests) (search extract)
- mabl: no environment-specific credentials, with environment variables as the workaround, at the cost of resource-group access control — [Logging into your app](https://help.mabl.com/docs/authentication-and-credentials) (search extract). Changing data defaults in a reusable flow creates a new flow version — [Activity feed](https://help.mabl.com/hc/en-us/articles/19084218352532-Activity-feed) (search extract)
- Ghost Inspector: turning a test into a module wipes its results — [Test settings](https://docs.ghostinspector.com/test-settings/)
- Reflect: no nested segments — [Reflect composition](https://reflect.run/docs/recording-tests/composition) (search extract)
- Datadog: suite alerts run independently of single-test monitors, so teams must mute tests to avoid duplicates; subtests stop at two levels — [Test suites](https://docs.datadoghq.com/synthetics/test_suites/), [Test steps](https://docs.datadoghq.com/synthetics/browser_tests/test_steps/)

**Gherkin**

- Scenario Outline abuse: unrelated behaviours crammed into one outline, single-row outlines, huge Examples tables — [Common Cucumber anti-patterns](https://sumanthu.vercel.app/docs/Cucumber/Common%20Cucumber%20Framework%20Anti%20Patterns) (community)
- Cucumber's team flags scenarios written after the code, one person writing them all, incidental detail, and several rules per scenario — [Cucumber anti-patterns part 1](https://cucumber.io/blog/bdd/cucumber-antipatterns-part-one)
- Glue-code explosion and duplicate steps with subtly different behaviour — [When Cucumber grows too big](https://dev.to/luiinge/when-cucumber-grows-too-big-pain-points-lessons-learned-and-alternatives-21pm)
- Dan North notes the scenario format mystifies non-programmers and teams warp Gherkin toward technical thinking — [InfoQ](https://www.infoq.com/news/2013/10/bdd-tool-cucumber-questioned) (extract attribution unverified; an older source)

**Reviews (weak signal)**

- Review-site cons skew to speed, price and flakiness, not to entity models. mabl: slow cloud execution, with a G2 Organization score of 8.3 from 16 reviews — [G2 mabl comparison](https://www.g2.com/compare/ranorex-studio-vs-tricentis-testim-vs-mabl). Rainforest: "false positives and false negatives" — [Capterra](https://www.capterra.com/p/259726/Rainforest/reviews/). Ghost Inspector: pricing, multi-browser — [Capterra](https://www.capterra.com/p/156853/Ghost-Inspector/reviews).

### Inferences
- The strongest recurring design lesson is one concept per job. Where a single noun does two jobs (Checkly's group, Ghost Inspector's suite), the product later splits them or adds fallbacks. Where three nouns do one job (Testim's suite, label and plan), users need a decision guide.
- "Executions have dates. Tests should not." is a neat rule for keeping definition and run apart, whoever said it.
- Users rarely name the entity model as their complaint. It shows up as confusion, workarounds and documentation that has to explain the difference.

### Gaps
- I could not reach the primary complaint venues: Reddit (r/QualityAssurance, r/softwaretesting), discuss.testrail.com, G2 full reviews, Capterra full reviews. The "folder sprawl in TestRail" claim in the brief is plausible and partly supported by competitor pages, but **no first-hand user quote was found**.
- No direct user complaint found about Playwright's use of the word "project". A targeted search found only related bugs — for example [Playwright issue 30877](https://www.github.com/microsoft/playwright/issues/30877). The naming collision is my observation.
- No direct complaints found for Testim, Reflect, Datadog, or Qase about their entity models.
- Zephyr speed complaints come mainly from a competitor (aqua cloud) and should not be relied on.
