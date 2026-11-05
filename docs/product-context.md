# DappDrill — project context

Working name for an AI QA tool for web3 dApp frontends. This file hands off the
product and design discussion so far; nothing has been built yet.

## Product in one paragraph

Paste a dApp's URL. An AI agent with its own wallet opens the site against local
forks of each chain (never mainnet), maps every user flow, and replays them under
wallet edge cases. It reports issues, saves each flow as a test you can re-run,
and reviews every signature request: what the button said vs. what the calldata
does, whether the target is a verified contract, approval scope, and what changed
since the last run. Self-serve, €100/month per app.

## Decisions made

- **Scope:** UI only for now (URL-first). API/SDK/CLI testing is a possible second
  direction, built on the same agent core later.
- **Price:** €100/month, one app, a monthly allowance of discovery scans (start at 4),
  unlimited replays, free first scan. Target model + compute cost under €25/customer/month.
- **Wallets:** browser wallets (MetaMask-style, Rabby, Coinbase Wallet, WalletConnect)
  and embedded wallets (Privy, Dynamic, Web3Auth). Embedded wallets sign in through a
  DappDrill test inbox that reads login codes.
- **Edge cases:** reject mid-flow (4001), wrong network / unknown chain (4902), account
  switch, two wallets via EIP-6963, low gas/funds, speed-up/cancel pending tx,
  existing/revoked approvals, slow or failing RPC, reload mid-flow.
- **Defining flows:** primarily by describing them to the AI; also by recording (click
  through it yourself) or as files in the repo synced by a GitHub Action. Any step is
  directly editable.
- **"Variations", not "forks":** the same flow run with different inputs (wallet,
  amount, chain, account) is a row in a Variations table on the flow, with one result
  per row. Button: "Run with…". A plain "Duplicate flow" covers flows whose steps
  differ. No linked forks unless users ask for them.
- **Don't use "simulate"** for this concept: it already means transaction simulation
  in the signing review.
- **Signing review never says "safe"**: verdicts are Dangerous / Check this / Looks
  consistent, always with evidence. It checks calls, not contract logic.

## UX direction for v2 (proposed, not yet built)

The model is now App > Test > Condition: there is no Flow entity. "Flow" elsewhere in this document means what a user does, which is a test.

1. Navigation: Overview · Tests · Runs. "Scan" is a header button; Account sits under the avatar.
2. Home answers "is my dApp OK?" with one status line, then what needs attention.
3. One status vocabulary everywhere: Broken / Review / OK. Each status has its own soft tint: green for OK, rose for Broken, amber for Review.
4. Scan setup is URL + Start. Detect chains and wallets from the site; put the rest behind "Customize".
5. Test page: Variations replace both the forks list and the across-wallets list.
6. Issue, grid-cell and signing details open in a side panel instead of a new page.
7. One "Describe a change…" bar under the steps; Record and Code are secondary links.
8. Signing review leads with the verdict and the button-vs-calldata comparison; passed
   checks and calldata collapse. Actions: "Accept as new baseline" / "Open GitHub issue".
9. Visual: fewer nested boxes, one content width, monospace only for addresses and code.

Visual language of the mockups: IBM Plex Sans + Plex Mono, near-black #17181C on
off-white #FBFBFA, red #A1290F reserved for problems; deliberately plain copy, no
gradients or "AI" badges.

## Technical approach (from the design doc)

- Playwright with an injected EIP-1193 provider that mimics MetaMask's behaviour and
  error codes, announced via EIP-6963.
- Intercept the page's own JSON-RPC traffic (not only the wallet's) and route it to
  Anvil forks; mark indexer-backed checks "unverified".
- viem for decoding and simulation; Sourcify / explorer APIs for verified source,
  proxies and implementations; ERC-7730 descriptors where protocols publish them.
- A model is used only for discovery, repairs and label-vs-calldata checks. Saved
  flows replay deterministically with no model calls.

## Open questions

- Is €100/month validated? Plan: hand-run scans of ~20 public dApps and ~15 calls with
  small dApp teams first (goal: 10 say they'd pay).
- How close can an injected wallet get to real MetaMask/Rabby quirks before a
  real-extension mode is needed?
- Whether API/SDK/CLI testing should come before the UI product (founder fit is strong there).

## Designs

`designs/` holds the 7 v1 mockups as static HTML (open `designs/index.html`). They
use made-up data for a fictional dApp, "Harbor Vault", and link to each other.
Treat them as the visual reference; the v2 UX direction above supersedes them
where the two differ.

## References (claude.ai artifacts)

- Market research: https://claude.ai/artifact/XHPCEPArznTK39cvq1C1uj
- Product design doc: https://claude.ai/artifact/NiwTdYcMRg4KjQbJPYn1K8
- Mockup canvas (7 screens): https://claude.ai/artifact/J37ht5r1sJ4wmvZVRvwYjE
