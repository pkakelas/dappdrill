import type { CheckReplay } from "@dappdrill/core";

/** A sweep skips anything that signs: the saved tests cover those. */
export const sweepable = (r: CheckReplay) => !r.actions.some((a) => a.kind === "wallet") && r.assert.kind !== "tx" && r.assert.kind !== "wallet";
