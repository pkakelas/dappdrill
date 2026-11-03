import { describe, expect, it } from "vitest";
import { Issue } from "@dappdrill/core";
import { dedupKey } from "../../src/pipeline/env.js";

const issue = (patch: Partial<Issue>): Issue =>
  Issue.parse({ id: "i", fingerprint: "f", severity: "high", category: "ui", title: "Sign-in hangs", summary: "", createdAt: "2026-11-03T00:00:00Z", ...patch });

describe("dedupKey", () => {
  const signIn = ["Reject the next wallet request", "1. Go to /trade", "2. Click “Sign in”"];

  it("matches the same finding on a step two flows share", () => {
    const a = issue({ id: "a", flowId: "f1", edgeCase: "reject", stepIndex: 1, stepsToReproduce: [...signIn, "3. Click “Buy”"] });
    const b = issue({ id: "b", flowId: "f2", edgeCase: "reject", stepIndex: 1, stepsToReproduce: [...signIn, "3. Click “Deposit”"] });
    expect(dedupKey(a)).toBeDefined();
    expect(dedupKey(a)).toBe(dedupKey(b));
  });

  it("keeps findings apart when the steps up to the failure differ", () => {
    const a = issue({ edgeCase: "reject", stepIndex: 2, stepsToReproduce: [...signIn, "3. Click “Buy”"] });
    const b = issue({ edgeCase: "reject", stepIndex: 2, stepsToReproduce: [...signIn, "3. Click “Deposit”"] });
    expect(dedupKey(a)).not.toBe(dedupKey(b));
    expect(dedupKey(issue({ edgeCase: "reject", stepsToReproduce: signIn }))).toBeUndefined();
    expect(dedupKey(issue({ stepIndex: 1, stepsToReproduce: signIn }))).toBeUndefined();
  });

  it("treats wallet-setup problems as one issue for the app", () => {
    expect(dedupKey(issue({ edgeCase: "wrong-network", category: "wallet" }))).toBe("wrong-network");
  });
});
