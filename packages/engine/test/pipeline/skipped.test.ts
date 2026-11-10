import { describe, expect, it } from "vitest";
import type { Step } from "@dappdrill/core";
import { skippedBy } from "../../src/pipeline/steps.js";

const click = (name: string): Step => ({ kind: "click", target: { role: "button", name } });
const fill = (label: string, value: string): Step => ({ kind: "fill", target: { label }, value });
const wallet = (note?: string): Step => ({ kind: "wallet", respond: "approve", note });

describe("skippedBy", () => {
  const recorded = [click("Edit"), fill("Price", "210"), click("Save changes")];

  it("names the first recorded doing the new path left out", () => {
    expect(skippedBy(recorded, [click("Edit"), fill("Price", "210")])).toBe("Save changes");
    expect(skippedBy([...recorded, wallet("Confirm the order")], recorded)).toBe("Confirm the order");
  });

  it("is quiet when everything named was done, however the path got there", () => {
    expect(skippedBy(recorded, [click("Orders"), click("edit"), fill("price", "215"), click("SAVE CHANGES")])).toBeUndefined();
    expect(skippedBy([], [click("Anything")])).toBeUndefined();
  });

  it("takes a doing of the same kind under a new name as the control renamed", () => {
    expect(skippedBy([click("Deposit")], [click("Add funds")])).toBeUndefined();
    expect(skippedBy(recorded, [click("Edit"), fill("Price", "210"), click("Save")])).toBeUndefined();
    // A click in another's place doesn't stand in for an entry or a signature.
    expect(skippedBy(recorded, [click("Edit"), click("Save changes"), click("More")])).toBe("Price");
    expect(skippedBy([click("Confirm"), wallet("Sign the order")], [click("Confirm"), click("Later")])).toBe("Sign the order");
  });

  it("ignores doings with nothing to name", () => {
    expect(skippedBy([{ kind: "click", target: { css: ".row:nth-child(2)" } }, click("Save")], [click("Save")])).toBeUndefined();
  });
});
