# DappDrill scan

**Broken: 1 run broke. 1 to review.**

https://staging-app.podtestnet.dev/trade · 3 flows · 15 runs · 9m 14s · $2.09

## Issues

### Medium

- **No message after rejecting 'MetaMask →'** (Wallet handling · Sign in with wallet · Reject)
  After rejecting the request the page shows no error or hint, so the user doesn't know the action didn't happen.
  Expected: Say the request was rejected and that the user can try again. Actual: No feedback text found on the page.

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account | Two wallets | Low gas | Slow RPC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sign in with wallet | OK | Review | OK | OK | OK | – | – |
| Enable trading | OK | OK | OK | OK | OK | – | – |
| Mint test funds | Broken |  |  |  |  |  |  |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Looks consistent | Sign DelegationAuth for pod delegation | Enable trading | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Looks consistent | Sign DelegationAuth for pod delegation | Enable trading | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Looks consistent | Sign DelegationAuth for pod delegation | Enable trading | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Looks consistent | Sign DelegationAuth for pod delegation | Enable trading | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Looks consistent | Sign DelegationAuth for pod delegation | Enable trading | New |
| Looks consistent | Sign in to staging-app.podtestnet.dev | Mint test funds | New |
| Looks consistent | Sign MintRequest for PodFaucet | Mint test funds | New |
