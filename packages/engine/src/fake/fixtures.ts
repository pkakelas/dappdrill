/**
 * Canned "Harbor Vault"-style data for the fake engine: the flows a scan finds,
 * the signing requests they make, and how each flow fares under each edge case.
 */
import {
  fingerprint,
  newId,
  nowIso,
  type EdgeCaseId,
  type Flow,
  type Issue,
  type Severity,
  type SigningReview,
  type Verdict,
} from "@dappdrill/core";

export const ACCOUNT_A = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const VAULT = "0x9f3a6c1e0b7d4e2a8c5f1b3d7e9a2c4f6b8dc2e1";
export const ROUTER = "0x7a1c4e2b9d0f3a5c8e1b6d4f2a9c7e5b3d1fa0b7";

export const PAGES = [
  { path: "/", title: "Harbor Vault" },
  { path: "/vault", title: "Vault · Harbor" },
  { path: "/stake", title: "Stake · Harbor" },
  { path: "/history", title: "History · Harbor" },
];

const connect = [
  { kind: "click", target: { role: "button", name: "Connect wallet" } },
  { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true } },
] as const;

/**
 * Flows a scan "discovers". The Withdraw button was later renamed, so replays of it break.
 * Ids are stable per site and flow name, so a rescan updates the same flows instead of adding copies.
 */
export function discoveredFlows(siteUrl: string): Flow[] {
  const flows: Flow[] = [
    {
      id: "",
      name: "Connect wallet",
      origin: "discovered",
      startUrl: "/",
      params: [],
      chainId: 8453,
      steps: [{ kind: "goto", url: "/" }, ...connect, { kind: "expect", assert: { type: "visible", text: "0x5B38…ddC4" } }],
    },
    {
      id: "",
      name: "Deposit USDC",
      origin: "discovered",
      startUrl: "/vault",
      params: [{ name: "amount", default: "100", description: "USDC to deposit" }],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/vault" },
        ...connect,
        { kind: "fill", target: { label: "Amount" }, value: "{{amount}}" },
        { kind: "click", target: { role: "button", name: "Approve USDC" } },
        { kind: "wallet", respond: "approve", expect: { kind: "transaction", functionName: "approve", failIfUnlimited: true } },
        { kind: "click", target: { role: "button", name: "Deposit" } },
        { kind: "wallet", respond: "approve", expect: { kind: "transaction", to: VAULT, functionName: "deposit", amountMustEqual: "{{amount}}" } },
        { kind: "expect", assert: { type: "visible", text: "Deposit confirmed" } },
      ],
    },
    {
      id: "",
      name: "Stake with permit",
      origin: "discovered",
      startUrl: "/stake",
      params: [{ name: "amount", default: "50" }],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/stake" },
        ...connect,
        { kind: "fill", target: { placeholder: "0.00" }, value: "{{amount}}" },
        { kind: "click", target: { role: "button", name: "Stake" } },
        { kind: "wallet", respond: "approve", expect: { kind: "typedData" } },
        { kind: "expect", assert: { type: "visible", text: "Staked" } },
      ],
    },
    {
      id: "",
      name: "Withdraw",
      origin: "discovered",
      startUrl: "/vault",
      params: [],
      chainId: 8453,
      steps: [
        { kind: "goto", url: "/vault" },
        ...connect,
        { kind: "click", target: { role: "button", name: "Withdraw all" } },
        { kind: "wallet", respond: "approve", expect: { kind: "transaction", to: VAULT, functionName: "withdraw" } },
        { kind: "expect", assert: { type: "visible", text: "Withdrawn" } },
      ],
    },
  ];
  return flows.map((f) => ({ ...f, id: `flw_${fingerprint("fake-flow", siteUrl, f.name).slice(0, 14)}` }));
}

/** The fake site renamed this button after the scan; replays looking for it break. */
export const RENAMED = { from: "Withdraw all", to: "Withdraw" };

export function hasWalletStep(flow: Flow): boolean {
  return flow.steps.some((s) => s.kind === "wallet");
}

export function missingStepIndex(flow: Flow): number {
  return flow.steps.findIndex((s) => "target" in s && s.target?.name === RENAMED.from);
}

interface CannedIssue {
  severity: Severity;
  category: Issue["category"];
  title: string;
  summary: string;
  expected?: string;
  actual?: string;
}

/** What goes wrong for a flow under an edge case: run status plus at most one issue. */
export function outcomeFor(flow: Flow, edgeCase: EdgeCaseId): { status: "pass" | "issue" | "fail" | "skipped"; reason?: string; issue?: CannedIssue } {
  const signs = hasWalletStep(flow);
  const name = flow.name.toLowerCase();
  if (!signs && ["reject", "low-gas", "speed-up", "existing-approval", "revoked-approval", "reload-mid-flow"].includes(edgeCase)) {
    return { status: "skipped", reason: "This flow makes no signing request." };
  }
  if (name.includes("deposit") && edgeCase === "happy") {
    return {
      status: "issue",
      issue: {
        severity: "critical",
        category: "signing",
        title: "Approves unlimited USDC to an unverified contract",
        summary: "The Approve button asks for an unlimited USDC allowance for a contract with no verified source. If that contract is compromised, every approved wallet can be drained.",
        expected: "Approve exactly the deposit amount (100 USDC) for the vault.",
        actual: `approve(${ROUTER}, 2^256-1)`,
      },
    };
  }
  if (name.includes("deposit") && edgeCase === "reject") {
    return {
      status: "fail",
      reason: "The page stayed on \"Confirm in wallet…\" after the request was rejected.",
      issue: {
        severity: "high",
        category: "wallet",
        title: "Deposit button stays loading after rejecting in the wallet",
        summary: "After rejecting the approval (error 4001) the button keeps spinning and can't be clicked again until the page is reloaded.",
        expected: "Show that the request was rejected and let the user try again.",
        actual: "Spinner never stops; no message.",
      },
    };
  }
  if (name.includes("withdraw") && edgeCase === "wrong-network") {
    return {
      status: "issue",
      issue: {
        severity: "medium",
        category: "wallet",
        title: "No prompt to switch network before withdrawing",
        summary: "With the wallet on Ethereum, Withdraw sends the request anyway and fails with a generic error instead of asking to switch to Base.",
        expected: "Ask the wallet to switch to Base first.",
        actual: "\"Something went wrong\" toast.",
      },
    };
  }
  if (name.includes("stake") && edgeCase === "slow-rpc") {
    return {
      status: "issue",
      issue: {
        severity: "low",
        category: "rpc",
        title: "Balance shows 0 while the RPC is slow",
        summary: "The staked balance briefly reads 0.00 before the RPC answers, which looks like lost funds.",
        expected: "A loading state until the balance is known.",
        actual: "0.00 for about 4 seconds.",
      },
    };
  }
  return { status: "pass" };
}

export function makeIssue(c: CannedIssue, flow: Flow, edgeCase: EdgeCaseId, runId: string, extra: Partial<Issue> = {}): Issue {
  return {
    id: newId("iss"),
    fingerprint: fingerprint("fake-issue", flow.name, edgeCase, c.title),
    severity: c.severity,
    category: c.category,
    title: c.title,
    summary: c.summary,
    flowId: flow.id,
    flowName: flow.name,
    edgeCase,
    runId,
    stepsToReproduce: flow.steps.map((s) => s.note ?? s.kind),
    expected: c.expected,
    actual: c.actual,
    evidence: {},
    createdAt: nowIso(),
    ...extra,
  };
}

/** Signing reviews for the wallet steps of a flow, one per wallet step. */
/** Accepted reviews by fingerprint; only what the fake compares against. */
export type Baselines = Record<string, Pick<SigningReview, "createdAt" | "verdict">>;

export function reviewsFor(flow: Flow, runId: string, requestIds: string[], baselines: Baselines): SigningReview[] {
  const out: SigningReview[] = [];
  flow.steps.forEach((step, stepIndex) => {
    if (step.kind !== "wallet") return;
    const requestId = requestIds[out.length] ?? newId("req");
    const fn = step.expect?.functionName;
    const kind = step.expect?.kind ?? "transaction";
    const base = { requestId, flowId: flow.id, stepIndex, runId, chainId: flow.chainId ?? 8453, createdAt: nowIso() };
    let review: Omit<SigningReview, "id" | "fingerprint" | keyof typeof base>;
    let verdict: Verdict;
    if (fn === "approve") {
      verdict = "dangerous";
      review = {
        method: "eth_sendTransaction",
        verdict,
        title: `Approve unlimited USDC for ${ROUTER.slice(0, 6)}…${ROUTER.slice(-4)}`,
        summary: "Grants an unlimited USDC allowance to a contract with no verified source. The button said \"Approve USDC\" for a 100 USDC deposit.",
        ui: { buttonLabel: "Approve USDC", pageUrl: "/vault" },
        decoded: {
          kind: "transaction",
          to: USDC,
          contractName: "USDC",
          functionName: "approve",
          signature: "approve(address,uint256)",
          args: [
            { name: "spender", type: "address", value: ROUTER, display: `${ROUTER.slice(0, 6)}…${ROUTER.slice(-4)} (unverified)` },
            { name: "amount", type: "uint256", value: (2n ** 256n - 1n).toString(), display: "Unlimited" },
          ],
          abiSource: "builtin",
        },
        simulation: { status: "ok", balanceChanges: [], gasUsed: "46123" },
        approvals: [{ standard: "erc20", token: USDC, symbol: "USDC", spender: ROUTER, amount: (2n ** 256n - 1n).toString(), display: "Unlimited USDC", unlimited: true }],
        checks: [
          { id: "approval", label: "Approval scope", status: "fail", detail: "Unlimited allowance; the flow only needs 100 USDC." },
          { id: "verified-source", label: "Verified source", status: "fail", detail: "No verified source on Sourcify or Basescan.", unverified: true },
          { id: "ui-match", label: "Matches the button", status: "warn", detail: "The button said \"Approve USDC\" without an amount." },
          { id: "expectation", label: "Flow expectation", status: "fail", detail: "failIfUnlimited is set on this step." },
        ],
        explanation: "Unlimited approval to an unverified spender that is not the vault the user is depositing into.",
        advice: "Approve the exact amount, and approve the vault contract itself.",
      };
    } else if (kind === "typedData") {
      verdict = "check";
      review = {
        method: "eth_signTypedData_v4",
        verdict,
        title: "Sign a USDC permit for the staking contract",
        summary: "An off-chain permit for 50 USDC that stays valid for 30 days.",
        ui: { buttonLabel: "Stake", pageUrl: "/stake" },
        decoded: { kind: "typedData", primaryType: "Permit", domain: { name: "USD Coin", chainId: 8453, verifyingContract: USDC }, args: [{ name: "value", type: "uint256", value: "50000000", display: "50 USDC" }] },
        approvals: [{ standard: "permit", token: USDC, symbol: "USDC", spender: VAULT, amount: "50000000", display: "50 USDC", unlimited: false, expiry: new Date(Date.now() + 30 * 864e5).toISOString() }],
        checks: [
          { id: "approval", label: "Approval scope", status: "pass", detail: "Exactly 50 USDC." },
          { id: "contract-age", label: "Contract age", status: "warn", detail: "Spender deployed 9 days ago.", unverified: true },
        ],
        explanation: "Amount matches the button, but the permit lasts 30 days and the spender is new.",
        advice: "Use a short deadline (minutes, not days).",
      };
    } else {
      verdict = "consistent";
      review = {
        method: "eth_sendTransaction",
        verdict,
        title: fn === "withdraw" ? "Withdraw from Harbor Vault" : "Deposit 100 USDC into Harbor Vault",
        summary: "Calls the verified vault contract with the amount shown on the page.",
        ui: { buttonLabel: fn === "withdraw" ? "Withdraw all" : "Deposit", pageUrl: "/vault" },
        decoded: { kind: "transaction", to: VAULT, contractName: "HarborVault", functionName: fn ?? "deposit", signature: `${fn ?? "deposit"}(uint256)`, args: [{ name: "assets", type: "uint256", value: "100000000", display: "100 USDC" }], abiSource: "sourcify" },
        simulation: { status: "ok", balanceChanges: [{ owner: ACCOUNT_A, token: USDC, symbol: "USDC", decimals: 6, delta: "-100000000", display: "-100 USDC" }] },
        approvals: [],
        checks: [
          { id: "verified-source", label: "Verified source", status: "pass", detail: "Verified on Sourcify." },
          { id: "ui-match", label: "Matches the button", status: "pass", detail: "Amount and action match the page." },
        ],
        explanation: "Target, function and amount match what the page showed.",
      };
    }
    const fp = fingerprint("fake-review", flow.name, stepIndex, review.method, review.decoded.to);
    const prev = baselines[fp];
    out.push({
      ...base,
      ...review,
      id: newId("sig"),
      fingerprint: fp,
      baseline: prev ? { previousAt: prev.createdAt, changes: prev.verdict === verdict ? [] : [{ field: "verdict", before: prev.verdict, after: verdict }] } : undefined,
    });
  });
  return out;
}
