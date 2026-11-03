# DappDrill run

**Broken: 4 runs broke. 1 to review.**

https://app.compound.finance/ · 2 flows · 5 runs · 3m 34s

## Issues

### Low

- **Unlimited approval: Approve USDC for TransparentUpgradeableProxy** (Signing · Supply 100 USDC · Happy path · unverified)
  The button says “Approve & Add”. The wallet is asked to approve unlimited USDC for 0xc3d6…cdc3 (TransparentUpgradeableProxy, verified).
  Expected: A request that does what “Approve & Add” says Actual: Worth a look. Unlimited approval. Deployment date unknown.

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account |
| --- | --- | --- | --- | --- |
| Withdraw 40 USDC | Broken |  |  |  |
| Supply 100 USDC | Broken | Broken | Broken | – |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Approve USDC for TransparentUpgradeableProxy | Supply 100 USDC | New |
| Check this | Supply 100000000 on TransparentUpgradeableProxy | Supply 100 USDC | New |
