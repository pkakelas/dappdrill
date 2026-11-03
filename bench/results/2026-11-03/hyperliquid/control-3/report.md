# DappDrill run

**Broken: 1 problem to fix (1 high). 1 run also broke.**

https://app.hyperliquid-testnet.xyz/trade · 1 flow · 4 runs · 2m 15s

## Issues

### High

- **Doesn't handle the wallet being on Ethereum** (Wallet handling · Connect wallet, accept terms and sign trading connection · Wrong network)
  With the wallet on the wrong network the flow broke (Step 7 (Establish Connection (enable trading / agent approval)): Could not find role=button name="Establish Connection" (tried button "Establish Connection", button ~"Establish Connection")) and the dApp neither asked to switch nor told the user.
  Expected: Ask the wallet to switch to Arbitrum Sepolia or show a "wrong network" message. Actual: Step 7 (Establish Connection (enable trading / agent approval)): Could not find role=button name="Establish Connection" (tried button "Establish Connection", button ~"Establish Connection")

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account |
| --- | --- | --- | --- | --- |
| Connect wallet, accept terms and sign trading connection | OK | Broken | Broken | – |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Sign Hyperliquid:AcceptTerms for HyperliquidSignTransaction | Connect wallet, accept terms and sign trading connection | New |
| Check this | Sign HyperliquidTransaction:ApproveAgent for HyperliquidSignTransaction | Connect wallet, accept terms and sign trading connection | New |
