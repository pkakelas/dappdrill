/**
 * Seeds a demo account with realistic results, so every page can be tried without the worker.
 *
 *   corepack pnpm --filter @dappdrill/web seed:demo
 *
 * Log in as demo@dappdrill.local / drill-demo-2026. Re-running replaces the demo data.
 * CI API token for curl: ddt_demo_harbor_vault_token_0001 (test value, local only).
 */
import {
  DEFAULT_EDGE_CASES,
  fingerprint,
  newId,
  type DrillEvent,
  type EdgeCaseId,
  type Flow,
  type FlowRun,
  type Issue,
  type RunStatus,
  type SigningReview,
  type Step,
} from "@dappdrill/core";
import {
  account,
  apiTokens,
  apps,
  createDb,
  encrypt,
  flowChanges,
  flows,
  issues,
  repairs,
  runBatches,
  runs,
  scanEvents,
  scans,
  sha256,
  signingReviews,
  teamMembers,
  teams,
  testWallets,
  user,
  variations,
  type AppSettings,
} from "@dappdrill/db";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const EMAIL = "demo@dappdrill.local";
const PASSWORD = "drill-demo-2026";
const CI_TOKEN = "ddt_demo_harbor_vault_token_0001";
const APP_URL = "http://localhost:5173";

const ROUTER = "0x2b7e4c1a9f3d5e6b8c0a1d2e3f4a5b6c7d8e09f1";
const VAULT = "0x9f1c2b3a4d5e6f708192a3b4c5d6e7f8091a2bc2";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const REWARDS = "0x41c0ffee00000000000000000000000000d15c0";

const db = createDb();
const H = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const iso = (d: Date) => d.toISOString();

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
const artifactsRoot = (() => {
  const a = process.env.ARTIFACTS_DIR ?? "./data/artifacts";
  return isAbsolute(a) ? a : resolve(repoRoot(), a);
})();

/** Tiny solid-colour PNG with a darker band, standing in for a screenshot. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const band = y < 48 ? 0.92 : y > height * 0.45 && y < height * 0.55 ? 0.8 : 1;
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = Math.round(rgb[0] * band);
      raw[o + 1] = Math.round(rgb[1] * band);
      raw[o + 2] = Math.round(rgb[2] * band);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function writeArtifact(kind: "scans" | "batches", id: string, path: string, data: Buffer) {
  const file = join(artifactsRoot, kind, id, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

// ---------------------------------------------------------------- flows

const btn = (name: string) => ({ role: "button", name });

function flowDefs(): Flow[] {
  return [
    {
      id: "flow_demo_connect",
      name: "Connect wallet",
      origin: "discovered",
      startUrl: "/",
      params: [],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/" },
        { kind: "click", target: btn("Connect wallet") },
        { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true } },
        { kind: "expect", assert: { type: "visible", text: "0x3f2b" }, note: "See the connected address in the header" },
      ],
    },
    {
      id: "flow_demo_deposit",
      name: "Deposit USDC into vault",
      origin: "discovered",
      startUrl: "/vaults/usdc",
      params: [{ name: "amount", default: "250", description: "USDC to deposit" }],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/vaults/usdc" },
        { kind: "click", target: btn("Connect wallet"), note: "Connect the wallet" },
        { kind: "fill", target: { label: "Amount" }, value: "{{amount}}" },
        { kind: "click", target: btn("Approve {{amount}} USDC") },
        { kind: "wallet", respond: "approve", note: "Wallet asks to approve USDC", expect: { kind: "transaction", functionName: "approve", spenderMustBe: ROUTER, amountMustEqual: "{{amount}}", failIfUnlimited: true } },
        { kind: "click", target: btn("Deposit") },
        { kind: "wallet", respond: "approve", note: "Wallet asks to deposit", expect: { kind: "transaction", functionName: "deposit", to: VAULT } },
      ],
    },
    {
      id: "flow_demo_withdraw",
      name: "Withdraw from vault",
      origin: "discovered",
      startUrl: "/vaults/usdc",
      params: [{ name: "shares", default: "100" }],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/vaults/usdc" },
        { kind: "click", target: { role: "tab", name: "Withdraw" } },
        { kind: "fill", target: { label: "Shares" }, value: "{{shares}}" },
        { kind: "click", target: btn("Withdraw") },
        { kind: "wallet", respond: "approve", note: "Wallet asks to withdraw", expect: { functionName: "redeem", to: VAULT } },
      ],
    },
    {
      id: "flow_demo_claim",
      name: "Claim rewards",
      origin: "discovered",
      startUrl: "/rewards",
      params: [],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/rewards" },
        { kind: "click", target: btn("Claim") },
        { kind: "wallet", respond: "approve", note: "Wallet asks to claim" },
        { kind: "expect", assert: { type: "visible", text: "Claimed" } },
      ],
    },
    {
      id: "flow_demo_siwe",
      name: "Sign in with Ethereum",
      origin: "discovered",
      startUrl: "/",
      params: [],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/" },
        { kind: "click", target: btn("Sign in") },
        { kind: "wallet", respond: "approve", note: "Wallet asks to sign a login message", expect: { kind: "message" } },
        { kind: "expect", assert: { type: "visible", text: "Signed in" } },
      ],
    },
  ];
}

const bridgeFlow: Flow = {
  id: "flow_demo_bridge",
  name: "Bridge to Base",
  origin: "described",
  startUrl: "/bridge",
  params: [{ name: "amount", default: "0.05" }],
  chainId: 1,
  steps: [
    { kind: "goto", url: "/bridge" },
    { kind: "fill", target: { label: "Amount" }, value: "{{amount}}" },
    { kind: "click", target: btn("Continue") },
    { kind: "wallet", respond: "approve", note: "Wallet asks to bridge ETH" },
    { kind: "expect", assert: { type: "visible", text: "Bridging" } },
  ],
};

// ---------------------------------------------------------------- results

const CASES: EdgeCaseId[] = DEFAULT_EDGE_CASES;

/** Outcome per flow × edge case; anything not listed passed. */
const OUTCOME: Record<string, Partial<Record<EdgeCaseId, { status: RunStatus; reason?: string }>>> = {
  flow_demo_connect: { "two-wallets": { status: "issue" } },
  flow_demo_deposit: { happy: { status: "issue" }, "slow-rpc": { status: "issue" }, "low-gas": { status: "pass" } },
  flow_demo_withdraw: { reject: { status: "fail", reason: "Button stayed on “Withdrawing…” after the wallet rejected." } },
  flow_demo_claim: { "wrong-network": { status: "issue" }, "low-gas": { status: "skipped", reason: "Claiming needs no gas on this fork." } },
  flow_demo_siwe: { "low-gas": { status: "skipped", reason: "Signing a message needs no gas." }, "slow-rpc": { status: "error", reason: "The fork stopped answering; not your app." } },
};

function makeRun(flow: Flow, edgeCase: EdgeCaseId, start: Date, extra: Partial<FlowRun> = {}): FlowRun {
  const o = OUTCOME[flow.id]?.[edgeCase] ?? { status: "pass" as const };
  const status = extra.status ?? o.status;
  const failAt = status === "fail" ? flow.steps.length - 1 : -1;
  const steps = flow.steps.map((s, index) => ({
    index,
    status: (status === "skipped" ? "skipped" : index === failAt ? "fail" : index > failAt && failAt >= 0 ? "skipped" : "pass") as "pass" | "fail" | "skipped",
    durationMs: 400 + ((index * 337) % 1400),
    ...(index === failAt ? { error: "Timed out waiting for the form to reset (15 s)." } : {}),
  }));
  const signs = flow.steps.filter((s) => s.kind === "wallet").length;
  const walletRequests = Array.from({ length: status === "skipped" ? 0 : signs }, (_, i) => ({
    id: `wr_${flow.id}_${edgeCase}_${i}`,
    method: flow.id === "flow_demo_siwe" ? "personal_sign" : "eth_sendTransaction",
    params: [],
    chainId: 8453,
    from: "0x3f2b9c0e1d2a3b4c5d6e7f8091a2b3c4d5e6a1d0",
    kind: "sign" as const,
    at: iso(start),
    outcome: (edgeCase === "reject" ? "rejected" : "approved") as "rejected" | "approved",
  }));
  return {
    id: newId("run"),
    flowId: flow.id,
    edgeCase,
    status,
    reason: o.reason,
    steps,
    walletRequests,
    signingReviewIds: [],
    issueIds: [],
    console:
      status === "fail"
        ? [
            { level: "error", text: "Error: User rejected the request. (code 4001)", at: iso(start) },
            { level: "warn", text: "Unhandled promise rejection in WithdrawForm.tsx:88", at: iso(start) },
          ]
        : [{ level: "info", text: "[harbor] vault data loaded", at: iso(start) }],
    rpc: [
      { chainId: 8453, method: "eth_chainId", via: "page", durationMs: 4, at: iso(start) },
      { chainId: 8453, method: "eth_call", via: "page", durationMs: edgeCase === "slow-rpc" ? 6200 : 38, at: iso(start) },
      { chainId: 8453, method: "eth_estimateGas", via: "wallet", durationMs: 21, at: iso(start) },
    ],
    forkBlocks: { "8453": "24123456" },
    mode: "fork",
    startedAt: iso(start),
    finishedAt: iso(new Date(start.getTime() + 40_000)),
    ...extra,
  };
}

function reviews(scanStart: Date, runOf: (flowId: string, ec: EdgeCaseId) => FlowRun): SigningReview[] {
  const dep = runOf("flow_demo_deposit", "happy");
  const claim = runOf("flow_demo_claim", "happy");
  const siwe = runOf("flow_demo_siwe", "happy");
  const at = iso(scanStart);
  return [
    {
      id: "sr_demo_approve",
      requestId: dep.walletRequests[0]?.id ?? "wr",
      flowId: "flow_demo_deposit",
      stepIndex: 4,
      runId: dep.id,
      chainId: 8453,
      method: "eth_sendTransaction",
      verdict: "dangerous",
      title: "Approve unlimited USDC for HarborVault Router",
      summary: "The button says 250 USDC, but the wallet is asked to approve an unlimited amount.",
      ui: { buttonLabel: "Approve 250 USDC", pageUrl: `${APP_URL}/vaults/usdc`, screenshot: "shots/approve.png" },
      decoded: {
        kind: "transaction",
        to: USDC,
        contractName: "USDC (FiatTokenV2_2)",
        functionName: "approve",
        signature: "approve(address,uint256)",
        args: [
          { name: "spender", type: "address", value: ROUTER, display: "0x2b7e…09f1 (HarborVault Router)" },
          { name: "amount", type: "uint256", value: "115792089237316195423570985008687907853269984665640564039457584007913129639935", display: "Unlimited" },
        ],
        value: "0",
        calldata: "0x095ea7b30000000000000000000000002b7e4c1a9f3d5e6b8c0a1d2e3f4a5b6c7d8e09f1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        abiSource: "sourcify",
      },
      simulation: { status: "ok", balanceChanges: [], gasUsed: "46211" },
      approvals: [{ standard: "erc20", token: USDC, symbol: "USDC", spender: ROUTER, spenderName: "HarborVault Router", amount: "", display: "Unlimited USDC", unlimited: true }],
      checks: [
        { id: "ui-match", label: "Matches what the button said", status: "fail", detail: "Button: 250 USDC. Request: unlimited." },
        { id: "expectation", label: "Flow expectation: amount must equal {{amount}}", status: "fail", detail: "Expected 250 USDC, got unlimited." },
        { id: "approval", label: "Approval scope", status: "fail", detail: "Unlimited approval to a router contract." },
        { id: "verified-source", label: "Spender has verified source", status: "pass", detail: "Verified on Sourcify (full match)." },
        { id: "proxy", label: "Proxy implementation", status: "pass", detail: "Not a proxy." },
        { id: "contract-age", label: "Spender age", status: "unverified", detail: "Deployed ~140 days ago according to the explorer.", unverified: true },
        { id: "simulation", label: "Simulation", status: "pass", detail: "Succeeds on the fork." },
      ],
      explanation: "The approval grants HarborVault Router permission to move every USDC this wallet holds, now and later, while the UI promised 250 USDC.",
      advice: "Pass the entered amount to approve(), or use Permit2 with an expiry.",
      baseline: { previousAt: iso(ago(8 * 24 * H)), changes: [{ field: "amount", before: "250000000", after: "Unlimited" }] },
      fingerprint: fingerprint("flow_demo_deposit", 4, "approve", USDC),
      createdAt: at,
    },
    {
      id: "sr_demo_deposit",
      requestId: dep.walletRequests[1]?.id ?? "wr2",
      flowId: "flow_demo_deposit",
      stepIndex: 6,
      runId: dep.id,
      chainId: 8453,
      method: "eth_sendTransaction",
      verdict: "consistent",
      title: "Deposit 250 USDC into HarborVault",
      summary: "Deposits 250 USDC and mints vault shares to your address.",
      ui: { buttonLabel: "Deposit", pageUrl: `${APP_URL}/vaults/usdc` },
      decoded: {
        kind: "transaction",
        to: VAULT,
        contractName: "HarborVault USDC",
        functionName: "deposit",
        signature: "deposit(uint256,address)",
        args: [
          { name: "assets", type: "uint256", value: "250000000", display: "250.00 USDC" },
          { name: "receiver", type: "address", value: "0x3f2b9c0e1d2a3b4c5d6e7f8091a2b3c4d5e6a1d0", display: "0x3f2b…a1d0 (you)" },
        ],
        abiSource: "sourcify",
      },
      simulation: {
        status: "ok",
        balanceChanges: [
          { owner: "you", token: USDC, symbol: "USDC", decimals: 6, delta: "-250000000", display: "−250.00 USDC" },
          { owner: "you", token: VAULT, symbol: "hvUSDC", decimals: 18, delta: "241830000000000000000", display: "+241.83 hvUSDC" },
        ],
      },
      approvals: [],
      checks: [
        { id: "ui-match", label: "Matches what the button said", status: "pass", detail: "Deposit of the entered amount." },
        { id: "verified-source", label: "Target has verified source", status: "pass", detail: "Verified on Sourcify." },
        { id: "simulation", label: "Simulation", status: "pass", detail: "USDC down 250, shares up." },
        { id: "baseline", label: "Same as last accepted run", status: "pass", detail: "No changes." },
      ],
      explanation: "The call matches the button and the entered amount, and the simulated balances move as expected.",
      fingerprint: fingerprint("flow_demo_deposit", 6, "deposit", VAULT),
      createdAt: at,
    },
    {
      id: "sr_demo_claim",
      requestId: claim.walletRequests[0]?.id ?? "wr3",
      flowId: "flow_demo_claim",
      stepIndex: 2,
      runId: claim.id,
      chainId: 8453,
      method: "eth_sendTransaction",
      verdict: "check",
      title: "Claim rewards from a contract deployed 2 days ago",
      summary: "The claim goes to a new, unverified distributor instead of the one used last week.",
      ui: { buttonLabel: "Claim", pageUrl: `${APP_URL}/rewards` },
      decoded: { kind: "transaction", to: REWARDS, functionName: "claim", signature: "claim(address)", args: [{ name: "to", type: "address", value: "0x3f2b9c0e1d2a3b4c5d6e7f8091a2b3c4d5e6a1d0", display: "you" }], abiSource: "signature-db" },
      simulation: { status: "ok", balanceChanges: [{ owner: "you", token: "0xharb", symbol: "HARB", decimals: 18, delta: "12500000000000000000", display: "+12.5 HARB" }] },
      approvals: [],
      checks: [
        { id: "verified-source", label: "Target has verified source", status: "warn", detail: "No verified source on Sourcify or Basescan." },
        { id: "contract-age", label: "Target age", status: "warn", detail: "Deployed 2 days ago.", unverified: true },
        { id: "baseline", label: "Same as last accepted run", status: "warn", detail: "Target contract changed." },
        { id: "simulation", label: "Simulation", status: "pass", detail: "You receive 12.5 HARB." },
      ],
      explanation: "Nothing in the call is harmful on its own, but the destination changed and can't be verified.",
      advice: "Verify the new distributor's source, or confirm the address change was intended.",
      baseline: { previousAt: iso(ago(7 * 24 * H)), changes: [{ field: "to", before: "0x7a1e…44b0", after: "0x41c0…d15c0" }] },
      fingerprint: fingerprint("flow_demo_claim", 2, "claim"),
      createdAt: at,
    },
    {
      id: "sr_demo_siwe",
      requestId: siwe.walletRequests[0]?.id ?? "wr4",
      flowId: "flow_demo_siwe",
      stepIndex: 2,
      runId: siwe.id,
      chainId: 8453,
      method: "personal_sign",
      verdict: "consistent",
      title: "Sign a login message for localhost:5173",
      summary: "A standard Sign-In with Ethereum message for this site. No funds or approvals involved.",
      ui: { buttonLabel: "Sign in", pageUrl: APP_URL },
      decoded: { kind: "message", message: "localhost:5173 wants you to sign in with your Ethereum account:\n0x3f2b…a1d0\n\nURI: http://localhost:5173\nVersion: 1\nChain ID: 8453\nNonce: 8f2k1c", args: [] },
      approvals: [],
      checks: [
        { id: "ui-match", label: "Domain matches the page", status: "pass", detail: "localhost:5173" },
        { id: "known-bad", label: "Known scam patterns", status: "pass", detail: "None found." },
      ],
      explanation: "The message is a login for the site you're on.",
      fingerprint: fingerprint("flow_demo_siwe", 2, "personal_sign"),
      createdAt: at,
    },
  ];
}

function issueList(scanStart: Date, runOf: (flowId: string, ec: EdgeCaseId) => FlowRun): (Issue & { ignored?: boolean })[] {
  const at = iso(scanStart);
  const mk = (flowId: string, ec: EdgeCaseId, i: Omit<Issue, "id" | "fingerprint" | "flowId" | "edgeCase" | "runId" | "createdAt" | "stepsToReproduce" | "evidence"> & Partial<Issue>): Issue => ({
    id: newId("iss"),
    fingerprint: fingerprint(flowId, ec, i.title),
    flowId,
    edgeCase: ec,
    runId: runOf(flowId, ec).id,
    createdAt: at,
    stepsToReproduce: [],
    evidence: {},
    ...i,
  });
  return [
    mk("flow_demo_deposit", "happy", {
      severity: "critical",
      category: "signing",
      title: "Approve button asks for unlimited USDC",
      summary: "The button says “Approve 250 USDC” but the wallet is asked to approve an unlimited amount to HarborVault Router. A compromised router could drain every USDC the user holds.",
      flowName: "Deposit USDC into vault",
      stepIndex: 4,
      stepsToReproduce: ["Open /vaults/usdc", "Connect the wallet", "Type 250 into Amount", "Click “Approve 250 USDC”"],
      expected: "approve(router, 250000000)",
      actual: "approve(router, 2^256 − 1)",
      evidence: { buttonLabel: "Approve 250 USDC", walletAsked: "approve(0x2b7e…09f1, unlimited)", signingReviewId: "sr_demo_approve", screenshot: "shots/approve.png" },
    }),
    mk("flow_demo_withdraw", "reject", {
      severity: "high",
      category: "wallet",
      title: "Rejecting the withdrawal leaves the button stuck",
      summary: "After the wallet rejects (4001) the button stays on “Withdrawing…” and the form can't be used until the page is reloaded.",
      flowName: "Withdraw from vault",
      stepIndex: 4,
      stepsToReproduce: ["Open /vaults/usdc", "Open the Withdraw tab", "Enter 100 shares", "Click Withdraw", "Reject in the wallet"],
      expected: "The button resets and shows “Transaction rejected”.",
      actual: "The button stays disabled on “Withdrawing…”.",
      evidence: { screenshot: "shots/withdraw-stuck.png" },
    }),
    mk("flow_demo_claim", "wrong-network", {
      severity: "medium",
      category: "wallet",
      title: "Wrong network shows a blank rewards page",
      summary: "With the wallet on Ethereum, /rewards renders nothing instead of asking to switch to Base.",
      flowName: "Claim rewards",
      expected: "A prompt to switch to Base.",
      actual: "An empty page; console shows a chain-mismatch error.",
    }),
    mk("flow_demo_deposit", "slow-rpc", {
      severity: "medium",
      category: "rpc",
      title: "Balance shows 0 USDC while the RPC is slow",
      summary: "For about 6 seconds the balance reads 0 USDC and the Max button deposits nothing.",
      flowName: "Deposit USDC into vault",
      unverified: false,
    }),
    mk("flow_demo_connect", "two-wallets", {
      severity: "low",
      category: "ui",
      title: "Wallet picker lists MetaMask twice",
      summary: "With two EIP-6963 wallets installed, the picker shows MetaMask under both the injected and announced entries.",
      flowName: "Connect wallet",
    }),
    { ...mk("flow_demo_siwe", "happy", { severity: "low", category: "ui", title: "Login message has no expiry", summary: "The SIWE message has no Expiration Time.", flowName: "Sign in with Ethereum" }), ignored: true },
  ];
}

// ---------------------------------------------------------------- main

async function main() {
  // Clean previous demo data.
  const [old] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
  if (old) {
    const owned = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, old.id));
    if (owned.length) await db.delete(teams).where(inArray(teams.id, owned.map((o) => o.teamId)));
    await db.delete(user).where(eq(user.id, old.id));
  }

  const userId = newId("usr");
  const teamId = newId("team");
  const appId = newId("app");
  await db.insert(user).values({ id: userId, name: "Demo", email: EMAIL, emailVerified: true });
  await db.insert(account).values({ id: newId("acc"), accountId: userId, providerId: "credential", userId, password: await hashPassword(PASSWORD) });
  const a = generatePrivateKey();
  const b = generatePrivateKey();
  await db.insert(teams).values({ id: teamId, name: "Harbor Labs", plan: "builder" });
  await db.insert(teamMembers).values({ teamId, userId, role: "owner" });
  await db.insert(testWallets).values({
    teamId,
    accountAKeyEnc: encrypt(a),
    accountAAddress: privateKeyToAccount(a).address,
    accountBKeyEnc: encrypt(b),
    accountBAddress: privateKeyToAccount(b).address,
  });

  const settings: AppSettings = { edgeCases: CASES, wallets: ["metamask", "rabby"], chains: [] };
  await db.insert(apps).values({ id: appId, teamId, name: "Harbor Vault", url: APP_URL, host: "localhost", settings, scheduleTime: "07:00", createdAt: ago(10 * 24 * H) });
  await db.insert(apiTokens).values({ id: newId("tok"), appId, name: "GitHub Action", tokenHash: sha256(CI_TOKEN), lastUsedAt: ago(5 * H) });

  // Finished scan #1.
  const scanId = newId("scan");
  const scanStart = ago(26 * H);
  const chains = [{ id: 8453, name: "Base", rpcUrl: "https://base-rpc.publicnode.com", mode: "fork" as const }];
  await db.insert(scans).values({
    id: scanId,
    appId,
    number: 1,
    status: "done",
    trigger: "manual",
    triggeredBy: userId,
    settings,
    chains,
    stages: { map: { status: "done", progress: 1 }, flows: { status: "done", progress: 1 }, "edge-cases": { status: "done", progress: 1 }, signing: { status: "done", progress: 1 } },
    pages: [{ url: `${APP_URL}/` }, { url: `${APP_URL}/vaults/usdc` }, { url: `${APP_URL}/rewards` }, { url: `${APP_URL}/bridge` }],
    costUsd: 3.12,
    startedAt: scanStart,
    finishedAt: new Date(scanStart.getTime() + 13 * 60_000),
    createdAt: scanStart,
  });
  writeArtifact("scans", scanId, "shots/approve.png", png(640, 400, [246, 244, 238]));
  writeArtifact("scans", scanId, "shots/withdraw-stuck.png", png(640, 400, [240, 240, 236]));
  writeArtifact("scans", scanId, "shots/final.png", png(640, 400, [250, 250, 248]));

  const defs = flowDefs();
  for (const f of defs) await db.insert(flows).values({ id: f.id, appId, name: f.name, definition: f, scanId, createdAt: scanStart, updatedAt: scanStart });
  await db.insert(flows).values({ id: bridgeFlow.id, appId, name: bridgeFlow.name, definition: bridgeFlow, createdAt: ago(3 * 24 * H), updatedAt: ago(3 * 24 * H) });

  const matrix = new Map<string, FlowRun>();
  for (const f of defs) for (const ec of CASES) matrix.set(`${f.id}|${ec}`, makeRun(f, ec, scanStart, { finalScreenshot: "shots/final.png" }));
  const runOf = (flowId: string, ec: EdgeCaseId) => matrix.get(`${flowId}|${ec}`)!;
  const reviewRows = reviews(scanStart, runOf);
  const issueRows = issueList(scanStart, runOf);
  for (const r of reviewRows) if (r.runId) for (const run of matrix.values()) if (run.id === r.runId) run.signingReviewIds.push(r.id);
  for (const i of issueRows) for (const run of matrix.values()) if (run.id === i.runId) run.issueIds.push(i.id);

  await db.insert(runs).values([...matrix.values()].map((r) => ({ id: r.id, appId, scanId, flowId: r.flowId, edgeCase: r.edgeCase, status: r.status, result: r, createdAt: scanStart })));
  await db.insert(signingReviews).values(reviewRows.map((r) => ({ id: r.id, appId, scanId, flowId: r.flowId ?? null, fingerprint: r.fingerprint, verdict: r.verdict, data: r, createdAt: scanStart })));
  await db.insert(issues).values(
    issueRows.map(({ ignored, ...i }) => ({
      id: i.id,
      appId,
      scanId,
      runId: i.runId ?? null,
      flowId: i.flowId ?? null,
      fingerprint: i.fingerprint,
      severity: i.severity,
      category: i.category,
      title: i.title,
      data: i,
      status: ignored ? ("ignored" as const) : ("open" as const),
      createdAt: scanStart,
    })),
  );

  // Replay history for sparkbars: 8 earlier happy-path runs per flow.
  for (let n = 8; n >= 1; n--) {
    const batchId = newId("batch");
    const when = ago(n * 24 * H + 26 * H);
    await db.insert(runBatches).values({ id: batchId, appId, trigger: "schedule", status: "done", request: { flowIds: defs.map((f) => f.id), edgeCases: ["happy"] }, startedAt: when, finishedAt: new Date(when.getTime() + 4 * 60_000), createdAt: when });
    await db.insert(runs).values(
      defs.map((f) => {
        const status: RunStatus = f.id === "flow_demo_withdraw" && n === 3 ? "fail" : f.id === "flow_demo_claim" && n <= 2 ? "issue" : "pass";
        const r = makeRun(f, "happy", when, { status });
        return { id: r.id, appId, batchId, flowId: f.id, edgeCase: "happy" as const, status, result: r, createdAt: when };
      }),
    );
  }

  // A CI run after the scan, and a manual replay of the bridge flow that broke.
  const ciBatch = newId("batch");
  const ciAt = ago(5 * H);
  await db.insert(runBatches).values({ id: ciBatch, appId, trigger: "ci", status: "done", request: { flowIds: ["flow_demo_deposit", "flow_demo_withdraw"], edgeCases: ["happy", "reject"], commit: "9c1e4b7a2f", branch: "fix/withdraw-reset" }, startedAt: ciAt, finishedAt: new Date(ciAt.getTime() + 3 * 60_000), createdAt: ciAt });
  const ciRuns = (["flow_demo_deposit", "flow_demo_withdraw"] as const).flatMap((id) =>
    (["happy", "reject"] as EdgeCaseId[]).map((ec) => makeRun(defs.find((f) => f.id === id)!, ec, ciAt, { status: id === "flow_demo_deposit" && ec === "happy" ? "issue" : "pass" })),
  );
  await db.insert(runs).values(ciRuns.map((r) => ({ id: r.id, appId, batchId: ciBatch, flowId: r.flowId, edgeCase: r.edgeCase, status: r.status, result: r, createdAt: ciAt })));

  const bridgeBatch = newId("batch");
  const bAt = ago(2 * H);
  const bRun = makeRun(bridgeFlow, "happy", bAt, { status: "fail", reason: "Couldn't find the “Continue” button." });
  await db.insert(runBatches).values({ id: bridgeBatch, appId, trigger: "manual", status: "done", request: { flowIds: [bridgeFlow.id], edgeCases: ["happy"] }, startedAt: bAt, finishedAt: new Date(bAt.getTime() + 60_000), createdAt: bAt });
  await db.insert(runs).values({ id: bRun.id, appId, batchId: bridgeBatch, flowId: bridgeFlow.id, edgeCase: "happy", status: "fail", result: bRun, createdAt: bAt });
  const fixed: Flow = { ...bridgeFlow, steps: bridgeFlow.steps.map((s, i) => (i === 2 ? { kind: "click", target: btn("Review bridge") } : s)) };
  await db.insert(repairs).values({ id: newId("rep"), flowId: bridgeFlow.id, runId: bRun.id, explanation: "Step 3's button changed from “Continue” to “Review bridge”. A fixed version passed on its own; nothing else changed.", proposed: fixed });

  // Variations on the deposit flow, one of them run.
  const dustId = newId("var");
  await db.insert(variations).values([
    { id: newId("var"), flowId: "flow_demo_deposit", name: "Whole balance", inputs: { amount: "10000" } },
    { id: dustId, flowId: "flow_demo_deposit", name: "Dust amount", inputs: { amount: "0.000001" } },
    { id: newId("var"), flowId: "flow_demo_deposit", name: "On Arbitrum", inputs: {}, chainId: 42161 },
  ]);
  const vBatch = newId("batch");
  const vAt = ago(4 * H);
  const vRun = makeRun(defs[1]!, "happy", vAt, { status: "fail", reason: "0 shares minted", variationId: dustId });
  await db.insert(runBatches).values({ id: vBatch, appId, trigger: "manual", status: "done", request: { flowIds: ["flow_demo_deposit"], edgeCases: ["happy"], variationId: dustId }, startedAt: vAt, finishedAt: new Date(vAt.getTime() + 60_000), createdAt: vAt });
  await db.insert(runs).values({ id: vRun.id, appId, batchId: vBatch, flowId: "flow_demo_deposit", edgeCase: "happy", status: "fail", result: vRun, createdAt: vAt });

  // A described flow waiting for the person to accept it.
  const proposed: Flow = {
    id: "proposed",
    name: "Revoke USDC approval",
    origin: "described",
    startUrl: "/settings/approvals",
    params: [],
    chainId: 8453,
    steps: [
      { kind: "goto", url: "/settings/approvals" },
      { kind: "click", target: btn("Revoke") },
      { kind: "wallet", respond: "approve", note: "Wallet asks to set the USDC approval to 0", expect: { functionName: "approve", amountMustEqual: "0" } },
      { kind: "expect", assert: { type: "visible", text: "No active approvals" } },
    ],
  };
  await db.insert(flowChanges).values({ id: newId("chg"), appId, kind: "describe", prompt: "Revoke the USDC approval from the settings page", status: "done", proposed, explanation: "Found the Approvals list under Settings; the revoke sets the allowance to 0.", createdBy: userId, createdAt: ago(H) });

  // Running scan #2 with live events.
  const liveId = newId("scan");
  const liveStart = ago(4 * 60_000);
  await db.insert(scans).values({
    id: liveId,
    appId,
    number: 2,
    status: "running",
    trigger: "manual",
    triggeredBy: userId,
    settings,
    chains,
    stages: { map: { status: "done", progress: 1 }, flows: { status: "running", progress: 0.4 } },
    pages: [{ url: `${APP_URL}/` }, { url: `${APP_URL}/vaults/usdc` }, { url: `${APP_URL}/rewards` }, { url: `${APP_URL}/bridge` }],
    liveFrame: "frames/live.png",
    startedAt: liveStart,
    createdAt: liveStart,
  });
  writeArtifact("scans", liveId, "frames/live.png", png(1280, 800, [248, 248, 245]));
  const t = (s: number) => iso(new Date(liveStart.getTime() + s * 1000));
  const events: DrillEvent[] = [
    { type: "stage", stage: "map", status: "running", progress: 0 },
    { type: "chains", chains },
    { type: "log", level: "info", message: "Opened localhost:5173. Found a Connect wallet button.", at: t(4) },
    { type: "page", url: `${APP_URL}/` },
    { type: "page", url: `${APP_URL}/vaults/usdc`, title: "USDC vault" },
    { type: "page", url: `${APP_URL}/rewards`, title: "Rewards" },
    { type: "page", url: `${APP_URL}/bridge`, title: "Bridge" },
    { type: "log", level: "info", message: "Mapped 4 pages: home, vault, rewards, bridge.", at: t(40) },
    { type: "stage", stage: "map", status: "done", progress: 1 },
    { type: "stage", stage: "flows", status: "running", progress: 0.4 },
    { type: "flow", flow: defs[0]! },
    { type: "flow-status", flowId: defs[0]!.id, status: "tested" },
    { type: "flow", flow: defs[1]! },
    { type: "flow-status", flowId: defs[1]!.id, status: "running" },
    { type: "log", level: "info", message: "Typing 250 into Amount and clicking “Approve 250 USDC”.", at: t(170) },
    { type: "wallet-request", request: { id: "wr_live_1", method: "eth_sendTransaction", params: [], chainId: 8453, kind: "sign", at: t(180), outcome: "pending" } },
    { type: "frame", path: "frames/live.png", url: `${APP_URL}/vaults/usdc`, at: t(181) },
    { type: "log", level: "warn", message: "The wallet was asked for an unlimited approval; the button said 250 USDC.", at: t(185) },
  ];
  // Rows carry the time of the latest timestamped event before them, as the worker's would.
  let last = liveStart;
  await db.insert(scanEvents).values(
    events.map((event) => {
      if ("at" in event && event.at) last = new Date(event.at);
      else if (event.type === "wallet-request") last = new Date(event.request.at);
      return { scanId: liveId, event, createdAt: last };
    }),
  );

  console.log(`Seeded Harbor Vault (${appId}).
  Log in:   ${EMAIL} / ${PASSWORD}
  CI token: ${CI_TOKEN}
  Report:   /apps/${appId}/scans/${scanId}
  Live:     /apps/${appId}/scans/${liveId}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
