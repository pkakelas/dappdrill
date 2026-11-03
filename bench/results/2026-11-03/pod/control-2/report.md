# DappDrill run

**Broken: 1 problem to fix (1 high). 1 more to review.**

https://staging-app.podtestnet.dev/trade · 3 flows · 12 runs · 2m 41s

## Issues

### High

- **Doesn't handle the wallet being on Ethereum** (Wallet handling · Enable trading · Wrong network)
  With the wallet on the wrong network the flow broke (Step 4 (Enable trading): Could not find role=button name="Enable trading" (tried button "Enable trading", button ~"Enable trading")) and the dApp neither asked to switch nor told the user.
  Expected: Ask the wallet to switch to pod testnet or show a "wrong network" message. Actual: Step 4 (Enable trading): Could not find role=button name="Enable trading" (tried button "Enable trading", button ~"Enable trading")

### Medium

- **No message after rejecting 'MetaMask →'** (Wallet handling · Sign in with wallet · Reject)
  After rejecting the request the page shows no error or hint, so the user doesn't know the action didn't happen.
  Expected: Say the request was rejected and that the user can try again. Actual: No feedback text found on the page.

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account |
| --- | --- | --- | --- | --- |
| Sign in with wallet | OK | Review | OK | OK |
| Enable trading | OK | OK | Broken | – |
| Mint test funds | OK | OK | Review | OK |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Check this | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Check this | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Check this | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Check this | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Check this | Sign DelegationAuth for pod delegation | Enable trading | New |
| Check this | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Check this | Sign DelegationAuth for pod delegation | Enable trading | New |
| Check this | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Check this | Sign in to staging-app.podtestnet.dev | Mint test funds | New |
| Check this | Sign MintRequest for PodFaucet | Mint test funds | New |
| Check this | Sign in to staging-app.podtestnet.dev | Mint test funds | New |
| Check this | Sign MintRequest for PodFaucet | Mint test funds | New |
| Check this | Sign in to staging-app.podtestnet.dev | Mint test funds | New |
| Check this | Sign MintRequest for PodFaucet | Mint test funds | New |
| Check this | Sign in to staging-app.podtestnet.dev | Mint test funds | New |
| Check this | Sign MintRequest for PodFaucet | Mint test funds | New |
