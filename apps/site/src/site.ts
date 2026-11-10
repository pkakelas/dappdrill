/** Where every "Get early access" button goes: the form at the end of the home page. */
export const CTA = {
  label: "Get early access",
  href: "/#access",
};

/** The web app's endpoint the early access form posts to (apps/web, api/early-access). Set at build time. */
export const EARLY_ACCESS_URL =
  process.env.NEXT_PUBLIC_EARLY_ACCESS_URL ??
  (process.env.NODE_ENV === "production" ? "https://app.dappdrill.com/api/early-access" : "http://localhost:3000/api/early-access");

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

/** The other pages, linked from the footer. */
export const PAGES = [
  { label: "About", href: "/about/" },
  { label: "Careers", href: "/careers/" },
  { label: "Privacy", href: "/privacy/" },
  { label: "Terms", href: "/terms/" },
];

/** The steps of a pass. Each has one line and one picture (components/app-pictures.tsx, in this order). */
export const STEPS = [
  {
    name: "Explore",
    line: "Finds the flows that move money and writes a test for each: a goal, an expected result, short steps.",
  },
  {
    name: "Write",
    line: "Write your own tests or edit the ones it wrote. Say what should happen in plain words, and an LLM checks it on every run, not just a fixed script.",
  },
  {
    name: "Run",
    line: "Runs every test with its own wallet on a local fork. Real contracts.",
  },
  {
    name: "Break",
    line: "Replays each flow the way users break it: rejected, wrong network, switched account, slow RPC.",
  },
  {
    name: "Watch",
    line: "Runs again from CI on every commit or release, and every day on your live app. When a test stops passing, you hear about it in Slack, Telegram or email.",
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
