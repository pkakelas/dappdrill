/** Where every "Get early access" button goes. */
export const CTA = {
  label: "Get early access",
  href: "mailto:hello@dappdrill.com?subject=Early%20access%20to%20DappDrill",
};

/** Who makes DappDrill. Shown on the About and Privacy pages and in the footer. */
export const COMPANY = {
  name: "Albatross Consulting",
  email: "hello@dappdrill.com",
};

/** Sections of the home page. The paths start with / so the links work from the About and Privacy pages too. */
export const NAV = [
  { label: "How it works", href: "/#how" },
  { label: "In CI", href: "/#ci" },
  { label: "Why", href: "/#why" },
  { label: "Findings", href: "/#findings" },
];

export const LEGAL = [
  { label: "About", href: "/about/" },
  { label: "Privacy", href: "/privacy/" },
];

/** The four steps of a pass. Each has one line and one picture (components/exhibits.tsx, in this order). */
export const STEPS = [
  {
    name: "Explore",
    line: "Finds the flows that move money and writes a test for each: a goal, an expected result, short steps.",
  },
  {
    name: "Run",
    line: "Runs every test with its own wallet on a local fork. Real contracts, fake money. Never mainnet.",
  },
  {
    name: "Break",
    line: "Replays each flow the way users break it: rejected, wrong network, switched account, slow RPC.",
  },
  {
    name: "Report",
    line: "A failure gets a second look in a fresh browser before it is called a bug. Each one comes with its video and trace.",
  },
];

/** Chains a run can fork today (packages/core/src/chains.ts). */
export const CHAINS = [
  { name: "Ethereum", icon: "ethereum" },
  { name: "Base", icon: "base" },
  { name: "Arbitrum", icon: "arbitrum" },
  { name: "Optimism", icon: "optimism" },
  { name: "Polygon", icon: "polygon" },
  { name: "BNB Chain", icon: "bnb" },
];
