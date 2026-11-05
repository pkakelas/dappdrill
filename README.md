# DappDrill

Tests for web3 dApp frontends. Paste a URL: in a minute or two DappDrill finds the app's main
flows and writes a test for each one, with a goal, an expected result and short steps. It runs
them with its own test wallet on local Anvil forks, adds unhappy paths (rejected in wallet, slow
RPC, wrong network, low gas) and reviews every signature request. Nothing touches mainnet.

```
apps/web          Next.js app: accounts, apps, flows and tests, runs, settings, the assistant
apps/worker       pg-boss jobs that run the engine and store results in Postgres
packages/engine   The drilling backend (Playwright + Anvil + Claude). No database
packages/cli      `dappdrill` CLI: the engine on its own, for CI or local runs
packages/core     Shared types and zod schemas
packages/db       Drizzle schema and client
fixtures/harbor-vault  Local test dApp with nine seeded bugs
```

## Setup

Needs Node 22+, Postgres, [Foundry](https://getfoundry.sh) (`anvil`) and either an
`ANTHROPIC_API_KEY` or a logged-in Claude Code.

```bash
corepack pnpm install
corepack pnpm --filter @dappdrill/engine exec playwright install chromium
cp .env.example .env            # set DATABASE_URL and the secrets
corepack pnpm db:migrate
corepack pnpm dev               # web on :3000 + worker
```

Sign up at http://localhost:3000/signup and paste a URL. Google login turns on when
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

## Try it on the test dApp

```bash
corepack pnpm fixture           # anvil on :8545, Harbor Vault on :5173
corepack pnpm cli analyze http://localhost:5173
```

`http://localhost:5173/?bugs=none` serves the same app without the seeded bugs
(`fixtures/harbor-vault/seeded-bugs.json` lists them).

## CLI and CI

The engine runs without the web app or a database:

```bash
dappdrill analyze <url>                 # find the flows, write .dappdrill/tests.json, run it
dappdrill run                           # run .dappdrill/tests.json
dappdrill run --url <url> --only deposit --unhappy --condition failing-rpc --junit junit.xml
```

`run` exits 0 when the tests passed, 1 when one failed, and 2 when one couldn't run, the run was
stopped or nothing ran. `--unhappy` adds the usual unhappy paths and `--condition <id>` adds any
other, but only to tests that ask the wallet to sign. A test that hasn't reached the wallet yet
runs first and gets its unhappy paths in the same run if it does.

Every signature request is reviewed. Dangerous and Check this reviews show under their test and in
`summary.md`, all of them are in the JUnit output, and `results.json` has the full detail. A
review doesn't change the exit code unless you pass `--fail-on-dangerous`, which exits 1 on a
Dangerous review even if the tests passed.

The tests file is plain JSON: edit a test's goal, expected result or steps by hand and commit it.
Runs save the browser actions that worked back into it, so the next run is fast. Results go to
`dappdrill-out` (`results.json`, `summary.md`, videos and screenshots). Chains that can't be
forked run on the live testnet: pass a funded testnet key with `--live-key-env VAR`. Without
one, the wallet signs messages but can't send transactions. Mainnet chain ids are never run live.

For GitHub, copy `.github/workflows/dappdrill.example.yml` into your dApp's repo. It uses the
action in `.github/actions/dappdrill`, runs the committed tests file against the PR's build and
comments the results on the PR.

## Development

```bash
corepack pnpm typecheck
corepack pnpm test
```

`CLAUDE.md` has the architecture notes and the rules the code follows.
