import { describe, expect, it } from "vitest";
import { asRead, labelled, loosely } from "../../src/run/figures.js";
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

describe("labelled", () => {
  it("reads the figure after a label, on its line or the lines under it", () => {
    expect(labelled("Cash: $1,200.50\nHoldings\n3", "cash")?.value).toBe(1200.5);
    expect(labelled("Deposited\n100.00 hUSDC", "Deposited")?.value).toBe(100);
  });

  it("takes the line that begins with the label over one that only mentions it", () => {
    const page = "Deposit hUSDC, receive vault shares that grow, and collect a 5% deposit bonus.\nDeposited\n100.00 hUSDC\nVault shares\n98.20 hvUSDC";
    expect(labelled(page, "Vault shares")?.value).toBe(98.2);
    expect(labelled("Subtotal 10.00\nTotal 12.00", "Total")?.value).toBe(12);
    // Only a mention: it is still read.
    expect(labelled("Your cash: 40", "cash")?.value).toBe(40);
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
