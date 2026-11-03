# DappDrill scan

**Broken: 3 problems to fix (3 high). 5 runs also broke. 7 more to review.**

https://app.compound.finance/ · 2 flows · 14 runs · 12m 50s · $2.35

## Issues

### High

- **With two wallets installed, the dApp talks to Rabby instead of MetaMask** (Wallet handling · Supply 100 USDC · Two wallets)
  Both wallets announced themselves through EIP-6963 and the user picked MetaMask, but requests went to Rabby (probably via window.ethereum). Users with two wallets end up signing with the wrong one.
  Expected: Use the provider from the EIP-6963 announcement the user selected. Actual: Rabby got wallet_requestPermissions.
- **Clicking 'Submit Transaction' twice while the app is busy sends two requests** (Wallet handling · Supply 100 USDC · Slow RPC)
  With a slow RPC the button stayed clickable, and a second click produced another eth_sendTransaction (supply(0xA0b8…eB48 (USD Coin), 100000000) to 0xc3d688B66703497DAA19211EEdff47f25384cdc3). A user who approves both pays twice.
  Expected: Disable the button as soon as it is clicked, until the request is answered. Actual: 2 identical requests from two clicks.
- **Clicking 'Submit Transaction' twice while the app is busy sends two requests** (Wallet handling · Withdraw 40 USDC · Slow RPC)
  With a slow RPC the button stayed clickable, and a second click produced another eth_sendTransaction (withdraw(0xA0b8…eB48 (USD Coin), 40 cUSDCv3) to 0xc3d688B66703497DAA19211EEdff47f25384cdc3). A user who approves both pays twice.
  Expected: Disable the button as soon as it is clicked, until the request is answered. Actual: 2 identical requests from two clicks.

### Medium

- **Flow breaks when the RPC is slow** (RPC · Supply 100 USDC · Slow RPC)
  With 2.5s of latency on every RPC call the flow did not complete: Step 8 (Approve eth_sendTransaction to 0xc3d6…cdc3): The wallet request doesn't match the flow: expected a call to 0xf2b9fdb8, the dApp calls supply.
  Expected: Keep working, just slower, with a loading state. Actual: Step 8 (Approve eth_sendTransaction to 0xc3d6…cdc3): The wallet request doesn't match the flow: expected a call to 0xf2b9fdb8, the dApp calls supply
- **Doesn't match the flow's expectation: Supply 100000000 on TransparentUpgradeableProxy** (Signing · Supply 100 USDC · unverified)
  The button says “Submit Transaction”. The wallet is asked to call supply(0xA0b8…eB48 (USD Coin), 100000000) on 0xc3d6…cdc3 (TransparentUpgradeableProxy, verified); on the fork −100 USDC leaves the wallet.
  Expected: A request that does what “Submit Transaction” says Actual: Worth a look. Doesn't match the flow's expectation. Deployment date unknown.
- **The page doesn't explain what happened after reject** (UI · Withdraw 40 USDC · Reject · unverified)
  After the rejection the UI goes back to its pre-submit state: the 'Withdraw USDC 40.0000' pending action is still listed and 'Submit Transaction' is still active, so retrying works, but no toast, banner or inline message says the request was rejected. Catch the wallet's user-rejected error (code 4001 / ACTION_REJECTED) and show a message like 'Transaction rejected in wallet — submit again to retry' next to the pending action.
  Expected: Show that the request was rejected and let the user try again. Actual: -
- **The page doesn't explain what happened after low gas** (UI · Withdraw 40 USDC · Low gas · unverified)
  After the low-gas failure the page looks unchanged: the 'Withdraw USDC 40.0000' pending action and the 'Submit Transaction' button are still there, with no error, toast or banner saying there isn't enough ETH for gas, and the 0.0000 ETH balance isn't flagged. Catch the insufficient-funds error from the wallet/RPC and show a clear message like 'Not enough ETH to pay gas, add ETH and retry' next to Submit Transaction.
  Expected: Tell the user there isn't enough ETH for gas and let them try again. Actual: -
- **Flow breaks when the RPC is slow** (RPC · Withdraw 40 USDC · Slow RPC)
  With 2.5s of latency on every RPC call the flow did not complete: Step 7 (Approve eth_sendTransaction to 0xc3d6…cdc3): The wallet request doesn't match the flow: expected a call to 0xf3fef3a3, the dApp calls withdraw.
  Expected: Keep working, just slower, with a loading state. Actual: Step 7 (Approve eth_sendTransaction to 0xc3d6…cdc3): The wallet request doesn't match the flow: expected a call to 0xf3fef3a3, the dApp calls withdraw
- **Doesn't match the flow's expectation: Withdraw 40 cUSDCv3 on TransparentUpgradeableProxy** (Signing · Withdraw 40 USDC · unverified)
  The button says “Submit Transaction”. The wallet is asked to call withdraw(0xA0b8…eB48 (USD Coin), 40 cUSDCv3) on 0xc3d6…cdc3 (TransparentUpgradeableProxy, verified); on the fork −40 cUSDCv3 leaves the wallet.
  Expected: A request that does what “Submit Transaction” says Actual: Worth a look. Doesn't match the flow's expectation. Deployment date unknown.

### Low

- **The button asks for an approval and the request is an approval of Unlimited: Approve USDC for TransparentUpgradeableProxy** (Signing · Supply 100 USDC · unverified)
  The button says “Approve & Add”. The wallet is asked to approve unlimited USDC for 0xc3d6…cdc3 (TransparentUpgradeableProxy, verified).
  Expected: A request that does what “Approve & Add” says Actual: Worth a look. The button asks for an approval and the request is an approval of Unlimited. The model disagrees: The page sets up a supply of exactly 100 USDC. The header button says "Supply 100.0000 USDC", the pending action is "Supply USDC 100.0000", and the wallet balance preview drops by about 100 USDC. The wallet request is a USDC approve() for an unlimited amount (2^256 − 1). The spender, 0xc3d6…cdc3, looks like Compound's cUSDCv3 Comet proxy, so the counterparty is probably the expected one. The token (USDC) and the action (an approval before a supply) also fit "Approve & Add". The amount does not. A user who read the page would expect an approval for 100 USDC, not permanent permission to move their entire USDC balance and anything they receive later. An unlimited approval behind a flow that names a specific amount fails the amount check. Unlimited approval. Deployment date unknown.

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account | Two wallets | Low gas | Slow RPC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Supply 100 USDC | Broken | Broken | Broken | – | Broken | – | Broken |
| Withdraw 40 USDC | Broken | Review | Broken | – | Review | Review | Broken |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Approve USDC for TransparentUpgradeableProxy | Supply 100 USDC | New |
| Check this | Supply 100000000 on TransparentUpgradeableProxy | Supply 100 USDC | New |
| Check this | Withdraw 40 cUSDCv3 on TransparentUpgradeableProxy | Withdraw 40 USDC | New |
| Check this | Withdraw 40 cUSDCv3 on TransparentUpgradeableProxy | Withdraw 40 USDC | New |
| Check this | Withdraw 40 cUSDCv3 on TransparentUpgradeableProxy | Withdraw 40 USDC | New |
| Check this | Withdraw 40 cUSDCv3 on TransparentUpgradeableProxy | Withdraw 40 USDC | New |
| Check this | Withdraw 40 cUSDCv3 on TransparentUpgradeableProxy | Withdraw 40 USDC | New |
