# DappDrill

Tests for web3 dApp frontends. Paste a URL: DappDrill looks at the app, lists what users come to do
there and makes a test for each one, a flat list of actions and checks written as sentences. A test
is kept once it goes the same way twice in a row. It runs them with its own test wallet on local
Anvil forks and reviews every signature request. Nothing touches mainnet.

```
apps/web          Next.js app: accounts, apps, tests, runs, settings
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
corepack pnpm cli make http://localhost:5173
```

`http://localhost:5173/?bugs=none` serves the same app without the seeded bugs
(`fixtures/harbor-vault/seeded-bugs.json` lists them).

## CLI and CI

The engine runs without the web app or a database:

```bash
dappdrill make <url>                    # look at the app, make its tests, write .dappdrill/tests.json
dappdrill make <url> --goal "A user deposits 100 USDC into the vault."   # add one test
dappdrill run                           # run .dappdrill/tests.json
dappdrill run --url <url> --only deposit --junit junit.xml
```

`make` writes the file after every test it keeps, so stopping it loses nothing. A test is kept when
it passes twice in a row, or when it fails twice in a row on a fault of the app, which is a bug found.

| Exit code | Meaning |
|---|---|
| 0 | Everything passed |
| 1 | A test failed, or a signature was Dangerous, even on a test that passed |
| 2 | The only problem is a test that couldn't be verified, a run that was stopped (Ctrl-C), a run where nothing ran, or DappDrill itself (bad flags, blocked, no tests) |

Every signature request is reviewed. Dangerous and Check this reviews show under their test and in
`summary.md`, all of them are in the JUnit output, and `results.json` has the full detail.

In JUnit output a test with a Dangerous signature is a failure, whatever its own result, and a test
that couldn't be verified is an error. A signing verdict never changes a test's own outcome in
`results.json`.

The tests file is plain JSON: the setup, what is known about the app, what may be signed, and the
tests. Edit a test's lines by hand and commit it. Runs save the browser actions that worked back
into it, so the next run replays them without a model. Results go to
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
