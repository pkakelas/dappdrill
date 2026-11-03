# DappDrill run

**Broken: 3 problems to fix (3 critical). 3 runs also broke.**

https://staging-app.podtestnet.dev/trade · 3 flows · 3 runs · 56s

## Issues

### Critical

- **Unlimited approval to a wallet address, not a contract: Permit 0xA0b8…eB48 for 0x5a1E…5A1e** (Signing · Sign in with wallet)
  The button says “MetaMask →”. The wallet is asked to permit unlimited tokens for 0x5a1E…5A1e, a wallet address rather than a contract.
  Expected: A request that does what “MetaMask →” says Actual: Don't ship this. Unlimited approval to a wallet address, not a contract. Doesn't match the flow's expectation.
- **Unlimited approval to a wallet address, not a contract: Permit 0xA0b8…eB48 for 0x5a1E…5A1e** (Signing · Enable trading)
  The button says “MetaMask →”. The wallet is asked to permit unlimited tokens for 0x5a1E…5A1e, a wallet address rather than a contract.
  Expected: A request that does what “MetaMask →” says Actual: Don't ship this. Unlimited approval to a wallet address, not a contract. Doesn't match the flow's expectation.
- **Unlimited approval to a wallet address, not a contract: Permit 0xA0b8…eB48 for 0x5a1E…5A1e** (Signing · Mint test funds)
  The button says “MetaMask →”. The wallet is asked to permit unlimited tokens for 0x5a1E…5A1e, a wallet address rather than a contract.
  Expected: A request that does what “MetaMask →” says Actual: Don't ship this. Unlimited approval to a wallet address, not a contract. Doesn't match the flow's expectation.

## Flows

| Flow | Happy path |
| --- | --- |
| Sign in with wallet | Broken |
| Enable trading | Broken |
| Mint test funds | Broken |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Dangerous | Permit 0xA0b8…eB48 for 0x5a1E…5A1e | Sign in with wallet | New |
| Dangerous | Permit 0xA0b8…eB48 for 0x5a1E…5A1e | Enable trading | New |
| Dangerous | Permit 0xA0b8…eB48 for 0x5a1E…5A1e | Mint test funds | New |
