# Real-dApp benchmark

Measures DappDrill on live dApp frontends, three ways:

- **Precision**: every distinct finding is labeled real or false in `labels/<dapp>.json`, by fingerprint. The report counts it twice: once over the scans' findings, and once over the control replays' findings, which run on the engine as it is now, after fixes for the false findings the scans turned up.
- **Replay stability**: each saved flow is replayed three times (happy path plus the edge cases the injected bugs need); a flow × edge-case cell is stable when all three runs end the same way with the same findings.
- **Recall**: page scripts in `src/mutations.ts` inject a frontend bug between the dApp and the wallet (unlimited approval, a stranger spender, 10× value, a sign-in that is really a permit, ignoring an account switch, hanging on a rejection, skipping a chain switch). Each one is replayed on the flows it applies to and scored against the unmutated replays:
  - **diagnosed**: DappDrill reports the bug for what it is (a dangerous/flagged signing review, or a wallet/UI issue on that edge case);
  - **noticed**: something new shows up, but not the right diagnosis;
  - **missed**: nothing changes;
  - **not-fired**: the script never triggered on that flow, so the case doesn't count.

  Signing bugs also run a second time against baselines accepted from the control run, which is how CI catches a regression.

Mainnet dApps run on local Anvil forks, so nothing reaches a real chain. The corpus and its funding live in `dapps.json`.

The `*-local` entries are open-source frontends (Aave, CoW Swap, GMX) built from source and served on this machine, because their live sites show a bot check to headless browsers. Their `serve` field is the command that starts each one (from `~/workspace/dappdrill-frontends`); `scan` and `replay` refuse to start until they answer. They still read market data, quotes and prices from the live backends, so those can disagree with the fork.

Forks pull state lazily from their upstream RPC. The public defaults (publicnode) rate-limit with 429s under a big dApp's multicalls and keep only recent state, which on Arbitrum ages out within minutes of the pinned block; the page then sees failed or 10-second-plus reads and never loads its data. Set an archive RPC per chain in `.env` to fork from instead:

```bash
BENCH_RPC_1=https://eth-mainnet.g.alchemy.com/v2/<key>
BENCH_RPC_42161=https://arb-mainnet.g.alchemy.com/v2/<key>
```

Spend: `report` adds up `costUsd` from every `scan*` folder of a dApp, so scans that an engine fix made obsolete (kept as `scan-v1`, `scan-v2`) still count. Replays make no model calls.

## Running

```bash
set -a; . ./.env; set +a
node_modules/.bin/tsx bench/src/run.ts scan   [ids…] --parallel 2   # model exploration; costs money
node_modules/.bin/tsx bench/src/run.ts replay [ids…] --parallel 2   # model-free
node_modules/.bin/tsx bench/src/run.ts report                       # summary.json + report.md
```

Results go to `results/<date>/` (`--date` to pick one). Steps that already have a `report.json` are skipped, so a run can be resumed.

## Labels

`labels/<dapp>.json` maps an issue fingerprint to a verdict:

```json
{ "<fingerprint>": { "label": "false", "note": "The spinner is the dApp waiting on its own indexer, not a stuck wallet call." } }
```

A false finding that an engine change has since fixed gets a `fixed` field saying which change.
