# DappDrill scan

**Broken: 1 problem to fix (1 high). 3 runs also broke. 5 more to review.**

https://stake.lido.fi/ · 2 flows · 8 runs · 9m 56s · $2.14

## Issues

### High

- **No message when there isn't enough ETH for gas** (Wallet handling · Stake 0.05 ETH · Low gas)
  With almost no ETH in the account the dApp never asked the wallet to sign and showed nothing the user could act on: Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): the dApp sent no signing request within 30s.
  Expected: Tell the user the account can't pay for gas. Actual: No feedback on the page.

### Medium

- **The page doesn't explain what happened after reject** (UI · Stake 0.05 ETH · Reject · unverified)
  After the wallet rejection, the modal shows only a generic "Transaction Failed / Something went wrong." with a Retry link. It never says the user rejected the request, so a deliberate cancel looks like a protocol or network failure. Detect the wallet's user-rejected error (code 4001 / ACTION_REJECTED) and show something like "Request rejected in wallet" with Retry, not the generic failure text.
  Expected: Show that the request was rejected and let the user try again. Actual: -
- **The page doesn't explain what happened after wrong network** (UI · Stake 0.05 ETH · Wrong network · unverified)
  On the wrong network, the app sent the stake anyway and then showed a 'Transaction Failed' modal saying 'User denied the transaction signature.' The page still says 'Network: Ethereum', and the only option is 'Retry', which will fail the same way. Compare the wallet's chainId with the expected chain before sending, show a 'Switch to Ethereum' prompt (wallet_switchEthereumChain), and map chain-mismatch errors to a wrong-network message instead of 'user denied'.
  Expected: Notice the wrong network and ask the wallet to switch before sending anything. Actual: -
- **The page doesn't explain what happened after switch account** (UI · Stake 0.05 ETH · Switch account · unverified)
  After the account switch the app shows "Transaction Failed – User denied the transaction signature." with a Retry link, which is wrong: the user didn't deny anything, and the rejection likely means the transaction was still set to come from the old account. Listen for the wallet's accountsChanged event, rebuild the pending transaction for the new address, and show a message like "Account changed, please review and confirm again"; the header (0xe00C...6aD2b5) doesn't show which account is in use now.
  Expected: Use the newly selected account for everything that follows. Actual: -
- **Flow breaks when the RPC is slow** (RPC · Stake 0.05 ETH · Slow RPC)
  With 2.5s of latency on every RPC call the flow did not complete: Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): The wallet request doesn't match the flow: expected a call to 0xa1903eab, the dApp calls submit.
  Expected: Keep working, just slower, with a loading state. Actual: Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): The wallet request doesn't match the flow: expected a call to 0xa1903eab, the dApp calls submit
- **Doesn't match the flow's expectation: Stake ETH 0.05 ETH on AppProxyUpgradeable** (Signing · Stake 0.05 ETH · unverified)
  The button says “Stake”. The wallet is asked to call submit(0x11d0…11d0 (wallet address)) on 0xae7a…fE84 (AppProxyUpgradeable, verified) with 0.05 ETH; on the fork −0.05 ETH leaves the wallet.
  Expected: A request that does what “Stake” says Actual: Worth a look. Doesn't match the flow's expectation. Deployment date unknown.

## Flows

| Flow | Happy path | Reject | Wrong network | Switch account | Two wallets | Low gas | Slow RPC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stake 0.05 ETH | Broken | Review | Review | Review | Broken | Broken | Review |
| Wrap 0.02 stETH to wstETH | Broken |  |  |  |  |  |  |

## Signing requests

| Verdict | Request | Flow | Since baseline |
| --- | --- | --- | --- |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
| Check this | Stake ETH 0.05 ETH on 0xae7a…fE84 | Stake 0.05 ETH | New |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
| Check this | Stake ETH 0.05 ETH on AppProxyUpgradeable | Stake 0.05 ETH | New |
