# DappDrill run

**Broken: 1 problem to fix (1 high).**

https://stake.lido.fi/ · 2 flows · 2 runs · 1m 13s

## Issues

### High

- **Doesn't handle the wallet being on Sepolia** (Wallet handling · Wrap 0.02 stETH to wstETH · Wrong network)
  With the wallet on the wrong network the flow broke (Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): the dApp sent no signing request within 30s) and the dApp neither asked to switch nor told the user.
  Expected: Ask the wallet to switch to Ethereum or show a "wrong network" message. Actual: Step 6 (Approve eth_sendTransaction to 0xae7a…fe84): the dApp sent no signing request within 30s

## Flows

| Flow | Wrong network |
| --- | --- |
| Wrap 0.02 stETH to wstETH | Broken |
| Stake 0.05 ETH | Review |
