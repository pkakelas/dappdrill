# DappDrill run

**Broken: 2 problems to fix (2 high). 3 more to review.**

https://staging-app.podtestnet.dev/trade · 3 flows · 3 runs · 56s

## Issues

### High

- **Rejecting 'MetaMask →' leaves the button stuck on 'Connecting…'** (Wallet handling · Sign in with wallet · Reject)
  After rejecting the personal_sign request the page kept a disabled 'Connecting…' button, so the user can't try again without reloading.
  Expected: Re-enable the button and show what happened. Actual: The 'Connecting…' button is still disabled 2s later.
- **Rejecting 'MetaMask →' leaves the button stuck on 'Enabling trading…'** (Wallet handling · Enable trading · Reject)
  After rejecting the personal_sign request the page kept a disabled 'Enabling trading…' button, so the user can't try again without reloading.
  Expected: Re-enable the button and show what happened. Actual: The 'Enabling trading…' button is still disabled 2s later.

### Medium

- **No message after rejecting 'MetaMask →'** (Wallet handling · Sign in with wallet · Reject)
  After rejecting the request the page shows no error or hint, so the user doesn't know the action didn't happen.
  Expected: Say the request was rejected and that the user can try again. Actual: No feedback text found on the page.
- **No message after rejecting 'MetaMask →'** (Wallet handling · Enable trading · Reject)
  After rejecting the request the page shows no error or hint, so the user doesn't know the action didn't happen.
  Expected: Say the request was rejected and that the user can try again. Actual: No feedback text found on the page.
- **No message after rejecting 'MetaMask →'** (Wallet handling · Mint test funds · Reject)
  After rejecting the request the page shows no error or hint, so the user doesn't know the action didn't happen.
  Expected: Say the request was rejected and that the user can try again. Actual: No feedback text found on the page.

## Flows

| Flow | Reject |
| --- | --- |
| Sign in with wallet | Broken |
| Enable trading | Broken |
| Mint test funds | Review |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Sign in to staging-app.podtestnet.dev | Sign in with wallet | New |
| Check this | Sign in to staging-app.podtestnet.dev | Enable trading | New |
| Check this | Sign DelegationAuth for pod delegation | Enable trading | New |
| Check this | Sign in to staging-app.podtestnet.dev | Mint test funds | New |
| Check this | Sign MintRequest for PodFaucet | Mint test funds | New |
