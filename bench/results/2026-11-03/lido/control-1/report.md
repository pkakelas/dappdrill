# DappDrill run

**Broken: 1 problem to fix (1 high). 2 runs also broke.**

https://stake.lido.fi/ · 2 flows · 8 runs · 4m 50s

## Issues

### High

- **Rejecting 'Unlock tokens and wrap' leaves the button stuck on 'Unlock tokens and wrap'** (Wallet handling · Wrap 0.02 stETH to wstETH · Reject)
  After rejecting the wallet request the page kept a disabled 'Unlock tokens and wrap' button, so the user can't try again without reloading.
  Expected: Re-enable the button and show what happened. Actual: The 'Unlock tokens and wrap' button is still disabled 2s later.

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account |
| --- | --- | --- | --- | --- |
| Wrap 0.02 stETH to wstETH | Broken | Broken | Broken | – |
| Stake 0.05 ETH | OK | OK | OK | – |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
