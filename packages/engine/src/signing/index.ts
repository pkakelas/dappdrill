/**
 * Signing review: what a wallet request does, where it goes, what it grants,
 * whether it matches the UI, and what changed since the last accepted run.
 */
import type { SigningReviewer } from "../types.js";
import { Reviewer, type ReviewerOptions } from "./reviewer.js";

export function createSigningReviewer(opts: ReviewerOptions = {}): SigningReviewer {
  return new Reviewer(opts);
}

export type { ReviewerOptions } from "./reviewer.js";
export { parseRequest } from "./request.js";
export { decodeTypedData } from "./decode-typed.js";
export { parseSiwe } from "./decode-message.js";
export { labelIntent, labelAmount } from "./ui-match.js";
