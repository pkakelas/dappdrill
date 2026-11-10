/**
 * A check: one claim about the page, the wallet or the chain that code decides, never a model.
 * Explorers make them while looking around; a check kept on a test's step is made again on every run.
 */
import { z } from "zod";

/**
 * What a check asserts. Code decides the result, never the model:
 * shows / hides: text on the page. url: the address contains it. wallet: a signature was asked for
 * and its decoded summary, or its data, contains it. wallet-amount: a request carries the amount
 * of a token that the page shows. no-wallet: nothing was asked to sign. tx: the latest
 * transaction was mined and didn't revert. balance: the number on the page matches the chain.
 * price: a price on the page is near the market's. adds-up: numbers on the page follow from each
 * other. well-formed: no NaN, undefined or the like where a value goes.
 *
 * For balance, price, wallet-amount and the figures in adds-up, `value` may name the figure by its
 * label on the page ("Cash", "Mark price") instead of copying the number: the figure is read off
 * the page when the check runs, so the check holds once the number has moved.
 */
export const CheckAssert = z.object({
  kind: z.enum(["shows", "hides", "url", "wallet", "wallet-amount", "no-wallet", "tx", "balance", "price", "adds-up", "well-formed"]),
  value: z.string().optional(),
  /** balance: the ERC-20 address; leave out for the native coin. price: the asset's ticker or token address. wallet-amount: the token's symbol or address. */
  token: z.string().optional(),
});
export type CheckAssert = z.infer<typeof CheckAssert>;

/** Same words as tests: pass, fail, or error when the check couldn't be made. */
export const CheckResultStatus = z.enum(["pass", "fail", "error"]);
export type CheckResultStatus = z.infer<typeof CheckResultStatus>;

/** A check kept on a test's step, made by code after the step on every run. */
export const TestCheck = z.object({
  /** The claim in plain words, as the explorer or the owner put it. */
  name: z.string().min(1),
  assert: CheckAssert,
});
export type TestCheck = z.infer<typeof TestCheck>;

/** How a kept check went on one run. */
export const TestCheckResult = z.object({
  name: z.string(),
  status: CheckResultStatus,
  /** What the check found: the figures read, the request, the two balances. */
  evidence: z.string(),
});
export type TestCheckResult = z.infer<typeof TestCheckResult>;

/** The same claim made twice reads as one check: the words and what is asserted, however they are spaced or cased. */
export const testCheckKey = (c: TestCheck) => [c.name, c.assert.kind, c.assert.value ?? "", c.assert.token ?? ""].join("\n").toLowerCase().replace(/\s+/g, " ");

/** A value that names a figure by its label on the page rather than giving the number. */
export const isLabel = (value: string | undefined): value is string => Boolean(value && value.trim() && !/\d/.test(value));

/**
 * Whether a check can be made again on another run: nothing in it was copied off the page that
 * will have moved by then. A figure named by its label is read afresh each time; a number is not.
 * Whole constants a sum brings itself (1, 100, 365) are fine.
 */
export function repeatable(assert: CheckAssert): boolean {
  const value = assert.value?.trim() ?? "";
  switch (assert.kind) {
    case "well-formed":
    case "url":
    case "no-wallet":
    case "tx":
    case "wallet":
      return true;
    case "shows":
    case "hides":
      // Words stay; a number on the page, or a date, is what this run saw.
      return !/\d/.test(value);
    case "balance":
    case "price":
    case "wallet-amount":
      return isLabel(value);
    case "adds-up":
      return /[A-Za-z]/.test(value) && (value.match(/[\d,]*\.?\d+/g) ?? []).every((n) => /^\d{1,3}$/.test(n));
  }
}
