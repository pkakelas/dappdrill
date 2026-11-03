# DappDrill run

**Broken: 1 problem to fix (1 high).**

https://staging-app.podtestnet.dev/trade · 1 flow · 1 run · 54s

## Issues

### High

- **Doesn't handle the wallet being on Ethereum** (Wallet handling · Enable trading · Wrong network)
  With the wallet on the wrong network the flow broke (Step 5 (Approve eth_signTypedData_v4 DelegationAuth (pod delegation)): the dApp sent no signing request within 30s) and the dApp neither asked to switch nor told the user.
  Expected: Ask the wallet to switch to pod testnet or show a "wrong network" message. Actual: Step 5 (Approve eth_signTypedData_v4 DelegationAuth (pod delegation)): the dApp sent no signing request within 30s

## Flows

| Flow | Wrong network |
| --- | --- |
| Enable trading | Broken |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Sign in to staging-app.podtestnet.dev | Enable trading | New |
