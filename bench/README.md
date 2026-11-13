# Real-dApp measurements

What DappDrill found on real dApp frontends, kept from before tests became flat lists made by the
test maker. The runner that produced these drove the old `dappdrill analyze` and its unhappy-path
conditions, and went with them; it is in the git history.

- `dapps.json`: the dApps, their chains and what the test wallet was funded with.
- `expected/<dapp>.json`: what a user comes to do there, written before the first run.
- `labels/<dapp>.json`: a label for each test of a run (`real pass`, `empty pass`, `app bug`, `bad test`, `environment`, `engine bug`, `can't run on a fork`).
- `results/<date>/`: the runs, each with a review and a report.

To measure the new maker on one of these, run `corepack pnpm tests <url> <suite.json>` and compare
what it kept with `expected/<dapp>.json`.
