# DappDrill scan

**Broken: 1 run broke.**

https://app.spark.fi/ · 2 flows · 2 runs · 5m 51s · $1.32

## Flows

| Flow | Happy path |
| --- | --- |
| Deposit 100 USDC into Savings | OK |
| Withdraw 40 USDC from Savings | Broken |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Approve USDC for ERC1967Proxy | Deposit 100 USDC into Savings | New |
| Check this | Deposit 100 USDC on ERC1967Proxy | Deposit 100 USDC into Savings | New |
