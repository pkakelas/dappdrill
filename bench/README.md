# Real-dApp benchmark

Measures DappDrill on real dApp frontends by driving the CLI, so it measures what users run. For each dApp:

1. **`analyze`**: finds what to test and writes the tests, with no hints unless you pass `--hints`. The product promise is "paste a URL", and the hints in `dapps.json` spell out the flows.
2. **`replay-1..3`**: each runs a fresh copy of what `analyze` wrote, like a CI run from the committed file. `--quick` stops here.
3. **`unhappy`**: the unhappy paths the injected bugs need, run clean as their control.
4. **`mutation-<bug>`**: page scripts in `src/mutations.ts` inject a frontend bug between the dApp and the wallet. Each runs on the tests it applies to, scored against the clean run:
   - **diagnosed**: a worse signing review, or a new issue;
   - **noticed**: the test failed where the clean run passed;
   - **missed**: nothing changed;
   - **not-fired**: the script never triggered, so the case doesn't count.

A dApp with a `buggyUrl` (Harbor Vault) replaces steps 3 and 4 with **`seeded`**: the tests made on the clean build run on the seeded one, unhappy paths included.

`expected/<dapp>.json` lists what a user comes to do. Write it before the first run, so a review can't just approve what was found. A review agent then reads the runs and writes `results/<date>/<dapp>/review.json`: each flow's usefulness and which expected flow it covers, the expected flows missed, and a label for each test:

`real pass`, `empty pass`, `app bug`, `bad test`, `environment`, `engine bug` or `can't run on a fork`.

A pass only counts if the test could also fail, which is what the signed count, the mutations and the seeded build are for.

Mainnet dApps run on local Anvil forks, so nothing reaches a real chain. The corpus and its funding live in `dapps.json`.

The `*-local` entries are open-source frontends (Aave, CoW Swap, GMX) built from source and served on this machine, because their live sites show a bot check to headless browsers. Their `serve` field is the command that starts each one (from `~/workspace/dappdrill-frontends`); `scan` and `replay` refuse to start until they answer. They still read market data, quotes and prices from the live backends, so those can disagree with the fork.

Forks pull state lazily from their upstream RPC. The public defaults (publicnode) rate-limit with 429s under a big dApp's multicalls and keep only recent state, which on Arbitrum ages out within minutes of the pinned block; the page then sees failed or 10-second-plus reads and never loads its data. Set an archive RPC per chain in `.env` to fork from instead:

```bash
BENCH_RPC_1=https://eth-mainnet.g.alchemy.com/v2/<key>
BENCH_RPC_42161=https://arb-mainnet.g.alchemy.com/v2/<key>
```

Spend: `report` adds up `costUsd` from the analysis and every run of a dApp. Replays use the model only when a recorded step stops working; the "Steps on the model" column counts those.

## Running

```bash
set -a; . ./.env; set +a
node_modules/.bin/tsx bench/src/run.ts drill  [ids…] --parallel 2   # costs money
node_modules/.bin/tsx bench/src/run.ts report [ids…]                # summary.json + report.md
```

Results go to `results/<date>/` (`--date` to pick one). Steps that already have a `meta.json` are skipped, so a run can be resumed.

Results from before 2026-11-05 and `labels/` come from the old scan-and-replay pipeline, whose runner is gone.

## Repeating one suite

`repeat.ts` runs the suite the dev harness saved under `.drill/<host>/` several times over and reports what moves between runs: each test's pass rate, the tests that flip, the steps that fell back to the model, cost and time. That is our own flake rate on one app.

```bash
node_modules/.bin/tsx bench/src/repeat.ts https://staging-app.podtestnet.dev --runs 3   # costs money, runs one after another
node_modules/.bin/tsx bench/src/repeat.ts https://staging-app.podtestnet.dev --report
```

Every run keeps the saved wallet (`--keep-wallet`), so an app that makes an account of each new wallet gets none. A live app's account carries what each run leaves, so the setup's reset steps are part of what is measured. Results go to `results/<date>/repeat-<host>/` (`run<i>.json`, `run<i>.log`, `report.md`); more runs on the same date are added after the ones already there.
