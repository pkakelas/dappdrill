import { describe, expect, it } from "vitest";
import type { ExploreState } from "@dappdrill/core";
import { passAlert } from "../src/notify/pass.js";

const state = (suggested: string[], bugs: string[] = []) => ({ suggested: suggested.map((status) => ({ status })), bugs: bugs.map((status) => ({ status })) }) as unknown as ExploreState;

describe("passAlert", () => {
  it("counts the tests the pass saved and the bugs it confirmed", () => {
    const a = passAlert("Pod", "done", state(["proved", "proved", "draft", "bug"], ["confirmed", "dismissed"]), "https://x/apps/1");
    expect(a.title).toBe("Pod: 2 tests ready");
    expect(a.lines).toEqual(["2 tests passed and will run again on every change.", "1 bug found.", "1 more test to look at: add the ones you want from the app's page."]);
  });

  it("says when nothing passed, and when the pass needs a person or broke", () => {
    expect(passAlert("Pod", "done", state(["failed"]), "l").title).toBe("Pod: done exploring");
    expect(passAlert("Pod", "asked", { ...state([]), needs: { what: "live-funds", chainId: 1, name: "pod testnet" } } as ExploreState, "l").lines[0]).toMatch(/^pod testnet can't be forked/);
    expect(passAlert("Pod", "failed", null, "l").title).toBe("Pod: the tests couldn't be written");
  });
});
