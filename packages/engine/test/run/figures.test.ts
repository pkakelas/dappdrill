import { describe, expect, it } from "vitest";
import { asRead, loosely } from "../../src/run/figures.js";
import { withToken } from "../../src/make/funding.js";
import { SitePages } from "../../src/browser/site-pages.js";

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
