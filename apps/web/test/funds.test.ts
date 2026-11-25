import { describe, expect, it } from "vitest";
import { readFund } from "../src/lib/funds";

const token = `0x${"ab".repeat(20)}`;

describe("readFund", () => {
  it("reads the rows of a form as what an account is sent, skipping a row left blank", () => {
    expect(
      readFund([
        { chainId: 84532, token: "", amount: " 0.02 " },
        { chainId: 84532, token: "", amount: "" },
        { chainId: 421614, token, amount: "100" },
      ]),
    ).toEqual([
      { chainId: 84532, amount: "0.02" },
      { chainId: 421614, token, amount: "100" },
    ]);
    expect(readFund([])).toEqual([]);
  });

  it("says what is wrong with a row in a sentence", () => {
    expect(readFund([{ token: "", amount: "1" }])).toEqual({ error: "Choose the chain for what a new account is sent." });
    expect(readFund([{ chainId: 84532, token: "", amount: "0" }])).toEqual({ error: "An amount to send is more than zero." });
    expect(readFund([{ chainId: 84532, token: "", amount: "1e3" }])).toEqual({ error: "An amount to send is a number, like 0.05 or 100." });
    expect(readFund([{ chainId: 84532, token: "USDC", amount: "1" }])).toEqual({ error: "A token is its contract address: 0x and 40 hex characters." });
    // A token with no amount is a row somebody began, not a blank one.
    expect(readFund([{ chainId: 84532, token, amount: "" }])).toEqual({ error: "An amount to send is a number, like 0.05 or 100." });
  });
});
