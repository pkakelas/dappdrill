# Harbor Vault (test fixture)

A small DeFi vault dApp with seeded bugs. DappDrill is run against it to measure how many
of the bugs it catches. The bugs are listed in [`seeded-bugs.json`](./seeded-bugs.json).

```bash
corepack pnpm start     # anvil on :8545 (chain 31337), deploy, site on http://localhost:5173
corepack pnpm stop      # stop both
corepack pnpm verify    # Playwright walk-through: reproduces every bug, checks ?bugs=none
```

`start` is idempotent: it reuses a running anvil and an existing deployment. Logs and pid
files are in `.run/`. From the repo root, `corepack pnpm fixture` runs `start`.

- `http://localhost:5173/` has all bugs on; `?bugs=none` is the fixed app; `?bugs=1,4` turns
  on only those. Links keep the query string.
- The page reads chain state itself via viem over `http://127.0.0.1:8545` and sends
  transactions and signatures through the connected wallet (EIP-6963 picker, `window.ethereum`
  fallback).

## Contracts

Plain Solidity in `contracts/`, no libraries. Deployed by anvil account 0 from nonce 0, so the
addresses are always the same (also written to `site/public/deployments.json`):

| Contract | Address | |
| --- | --- | --- |
| hUSDC | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | ERC-20, 6 decimals, EIP-2612 permit, open `mint` faucet |
| HarborVault | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | ERC-4626-lite: deposit / withdraw / redeem |
| RewardsDistributor | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | 5% deposit bonus, `claim()` |
| Helper | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Suspicious: anyone can pull tokens approved to it |

Deployment also seeds ~102k hUSDC of TVL from anvil accounts 8 and 9 plus some yield, so the
share price is above 1. Anvil accounts 1–7 start with no hUSDC; use "Get test hUSDC".

## Layout

```
contracts/      Solidity (forge build)
scripts/        start / stop / deploy / verify (tsx)
site/           Vite + React + viem frontend; site/src/config.ts has the bug switch
```
