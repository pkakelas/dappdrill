import { Flow } from "@dappdrill/core";

/** The test dApp's deposit flow: connect MetaMask, approve TUSD, deposit, see the confirmation. */
export function depositFlow(startUrl: string, token: string, vault: string, overrides: Partial<Flow> = {}): Flow {
  return Flow.parse({
    id: "flow_deposit",
    name: "Deposit TUSD",
    origin: "recorded",
    startUrl,
    params: [{ name: "amount", default: "5" }],
    steps: [
      { kind: "click", target: { role: "button", name: "Connect wallet" } },
      { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true } },
      { kind: "fill", target: { testId: "amount" }, value: "{{amount}}" },
      { kind: "click", target: { role: "button", name: "Deposit" } },
      { kind: "wallet", respond: "approve", expect: { kind: "transaction", to: token, functionName: "approve", spenderMustBe: vault, amountMustEqual: "{{amount}}", failIfUnlimited: true } },
      { kind: "wallet", respond: "approve", expect: { kind: "transaction", to: vault, functionName: "deposit" } },
      { kind: "expect", assert: { type: "visible", text: "Deposited {{amount}} TUSD" } },
    ],
    chainId: 31337,
    ...overrides,
  });
}
