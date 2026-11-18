import { isCode, type Action, type Check } from "@dappdrill/core";

export { isCode };

type Line = Action | Check;

/** A test with a line that isn't code yet. */
export const unwritten = (test: { steps: Line[]; cleanup: Line[] }): boolean => ![...test.steps, ...test.cleanup].every(isCode);
