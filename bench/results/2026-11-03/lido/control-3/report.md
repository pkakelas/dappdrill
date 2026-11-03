# DappDrill run

**Broken: 5 runs broke. 1 to review.**

https://stake.lido.fi/ · 2 flows · 8 runs · 5m 12s

## Issues

### Medium

- **No message after rejecting 'Stake'** (Wallet handling · Stake 0.05 ETH · Reject)
  After rejecting the request the page shows no error or hint, so the user doesn't know the action didn't happen.
  Expected: Say the request was rejected and that the user can try again. Actual: No feedback text found on the page.

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account |
| --- | --- | --- | --- | --- |
| Wrap 0.02 stETH to wstETH | Broken | Broken | Broken | – |
| Stake 0.05 ETH | Broken | Review | Broken | – |
