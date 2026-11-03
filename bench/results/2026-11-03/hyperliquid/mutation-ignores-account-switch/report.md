# DappDrill run

**Broken: 1 problem to fix (1 critical). 1 more to review.**

https://app.hyperliquid-testnet.xyz/trade · 1 flow · 1 run · 18s

## Issues

### Critical

- **After switching accounts, the typed-data signature still comes from the old account** (Wallet handling · Connect wallet, accept terms and sign trading connection · Switch account)
  The wallet switched to 0x4fca79b12ae6088d26c98fa864831383dd0dd461 but the dApp asked to sign from 0xec07cf1f3e6f6955f650211482bd39ac2fe02614. A real wallet refuses this, and a user who switched accounts would act on the wrong one.
  Expected: Sign from 0x4fca79b12ae6088d26c98fa864831383dd0dd461, the account the wallet now exposes. Actual: The request names 0xec07cf1f3e6f6955f650211482bd39ac2fe02614.

### Medium

- **Uncaught error on the page during switch account** (UI · Connect wallet, accept terms and sign trading connection · Switch account)
  The page threw 1 uncaught error(s). First: UserRejectedRequestError: User rejected the request. Details: User rejected the request. Version: viem@2.44.0
  Expected: - Actual: UserRejectedRequestError: User rejected the request. Details: User rejected the request. Version: viem@2.44.0

## Flows

| Flow | Switch account |
| --- | --- |
| Connect wallet, accept terms and sign trading connection | Broken |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Sign Hyperliquid:AcceptTerms for HyperliquidSignTransaction | Connect wallet, accept terms and sign trading connection | New |
