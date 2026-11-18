/**
 * Public engine API. The worker and the CLI only use these functions, so the
 * engine runs the same with or without a database.
 *
 * - makeTests: from an app to its tests. The look lists goals, a test is made and proven for each,
 *   and what looked wrong on the way gets a test of its own.
 * - makeTest: one goal to one proven test.
 * - lookForGoals: the look alone.
 * - runSuite: run a suite's tests on the app's real environment, each a list of actions and checks
 *   done by code. It calls no model: a line that isn't code yet, or whose recording no longer fits
 *   the page, is Couldn't verify and its result says the test can be repaired.
 * - repairSuite: a model does what a run couldn't, what it did is recorded, checks still left as
 *   sentences are written as code, and a test is handed back once it goes the same way twice with
 *   no model.
 *
 * Progress comes back through each function's callbacks. The sink gets the rest: live frames (with
 * the whole path of the file), the chains in use, cost and warnings.
 */
export { runSuite, type RunSuiteInput, type SuiteProgress } from "./run/suite.js";
export { makeTest, type Made, type MakeInput } from "./make/maker.js";
export { lookForGoals, type Goal, type Looked } from "./make/look.js";
export { makeTests, type Attempt, type MadeTests, type MakeTestsInput, type MakeTestsProgress } from "./make/tests.js";
export { repairSuite, type Repaired, type RepairInput, type RepairProgress } from "./make/repair-suite.js";
export type { Finding } from "./make/draft.js";
export type { Llm } from "./types.js";
