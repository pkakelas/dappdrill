import { describe, expect, it } from "vitest";
import { addsUp, asRead, brokenValues, evaluate, loosely, numberOnPage, shownNumber } from "../../src/explore/display.js";
import { withToken } from "../../src/explore/funding.js";
import { SitePages } from "../../src/explore/look.js";

describe("shownNumber", () => {
  it("reads numbers as pages write them", () => {
    expect(shownNumber("$6,575.32")).toBe(6575.32);
    expect(shownNumber("1.2M")).toBe(1_200_000);
    expect(shownNumber("-0.57%")).toBe(-0.57);
    expect(shownNumber("n/a")).toBeUndefined();
  });
});

describe("asRead", () => {
  it("puts a number back together when the page gives it a character per line", () => {
    expect(asRead("To\n$4.98\n$\n4\n.\n9\n8\nUSDC\nBase")).toBe("To\n$4.98\n$4.98\nUSDC\nBase");
    expect(asRead("Step\n1\nConnect\n2\nApprove")).toBe("Step\n1\nConnect\n2\nApprove");
  });
});

describe("loosely", () => {
  it("reads across lines and thousands separators", () => {
    expect(loosely("Fee\n$0.04")).toBe(loosely("Fee $0.04"));
    expect(loosely("Balance: 1,000 USDC")).toContain(loosely("1000"));
    expect(loosely("1,234,567.89")).toBe("1234567.89");
    expect(loosely("0x1,2 and 3,4")).toBe("0x1,2 and 3,4");
  });
});

describe("numberOnPage", () => {
  const page = "Gold\n$4,653.90\n+0.4%\nAAPL\n$255.26\nVolume 4,700";
  it("takes the claim as written when the page still shows it", () => {
    expect(numberOnPage(page, "$255.26")).toEqual({ text: "$255.26", value: 255.26 });
  });
  it("follows a price that ticked since it was read", () => {
    expect(numberOnPage(page, "$4,651.10")).toEqual({ text: "4,653.90", value: 4653.9 });
  });
  it("finds nothing when the page has no number near the claim", () => {
    expect(numberOnPage(page, "$300.00")).toBeUndefined();
    expect(numberOnPage(page, "soon")).toBeUndefined();
  });
});

describe("brokenValues", () => {
  it("finds values the code failed to produce", () => {
    const page = "Price\n$NaN\nAPY: undefined%\nTVL 1.5e+21\nBalance: null\nOwner [object Object]";
    expect(brokenValues(page).map((b) => b.what)).toEqual(["NaN", "undefined", "a number in scientific notation", "null", "[object Object]"]);
  });

  it("leaves ordinary text and addresses alone", () => {
    expect(brokenValues("This agreement is null and void.\n0x5e21abcdef0123456789\nGold $4,653.90\nNaNoTech Fund")).toEqual([]);
  });
});

describe("addsUp", () => {
  const page = "You pay 0.5 ETH\n1 ETH = 3,365.12 USDC\nYou receive 1,682.56 USDC\nFee 0.3%";

  it("passes a quote that follows from the rate", () => {
    expect(addsUp("0.5 * 3,365.12 = 1,682.56", page).ok).toBe(true);
  });

  it("reads a number with or without its thousands separators", () => {
    expect(addsUp("0.5 * 3365.12 = 1682.56", page).ok).toBe(true);
    expect(addsUp("0.5 * 3,365.12 = 1,682.56", page.replace(/,/g, "")).ok).toBe(true);
  });

  it("fails one that doesn't", () => {
    const r = addsUp("0.5 * 3,365.12 = 1,682.56", page.replace("1,682.56", "1,582.56").replace("= 1,682.56", "= 1,582.56"));
    expect(r.error).toBeDefined(); // the claim's own number is no longer on the page
    expect(addsUp("0.5 * 3,365.12 = 1,582.56", page.replace("1,682.56", "1,582.56"))).toMatchObject({ ok: false, right: 1582.56 });
  });

  it("refuses numbers that aren't on the page, apart from small constants", () => {
    expect(addsUp("0.5 * 3,400.00 = 1,682.56", page).error).toContain("3,400.00");
    expect(addsUp("0.5 * 3,365.12 * (1 - 0.3%) = 1,677.51", page.replace("1,682.56", "1,677.51")).ok).toBe(true);
  });

  it("wants one equals sign and a sum it can read", () => {
    expect(addsUp("0.5 * 3,365.12", page).error).toBeDefined();
    expect(addsUp("0.5 ** 3,365.12 = 1,682.56", page).error).toBeDefined();
  });
});

describe("evaluate", () => {
  it("does the four operations, brackets and percents", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) × 4")).toBe(20);
    expect(evaluate("1,000 * 5%")).toBe(50);
    expect(evaluate("-2 - -3")).toBe(1);
  });
});

describe("withToken", () => {
  it("keeps one entry per chain and address", () => {
    const usdc = { chainId: 42161, address: "0xAF88", amount: "1000" };
    expect(withToken([usdc], { chainId: 42161, address: "0xaf88", amount: "50" })).toEqual([{ chainId: 42161, address: "0xaf88", amount: "50" }]);
    expect(withToken([usdc], { chainId: 1, address: "0xaf88", amount: "50" })).toHaveLength(2);
  });
});

describe("SitePages", () => {
  const site = () => {
    const pages = new SitePages("https://app.example/");
    pages.open("https://app.example/");
    pages.link([
      { href: "https://app.example/", text: "Home" },
      { href: "https://app.example/earn?tab=1#top", text: "Earn" },
      { href: "https://app.example/terms", text: "Terms" },
      { href: "https://docs.example/", text: "Docs" },
      { href: "https://app.example/logo.svg", text: "" },
      ...["btc", "eth", "sol", "doge"].map((m) => ({ href: `https://app.example/markets/${m}`, text: m.toUpperCase() })),
    ]);
    return pages;
  };

  it("lists linked pages nobody opened, without legal pages, files, other sites and most rows of a list", () => {
    expect(site().unopened()).toEqual(["/earn (Earn)", "/markets/btc (BTC)", "/markets/eth (ETH)"]);
  });

  it("drops a page once it is opened, and a list once one of its rows is", () => {
    const pages = site();
    pages.open("https://app.example/earn/");
    pages.open("https://app.example/markets/sol");
    expect(pages.unopened()).toEqual([]);
  });
});
