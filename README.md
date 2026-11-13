# DappDrill

**Automated tests for web3 dApp frontends.** Give it your dApp's URL. It looks around the app,
lists what people come to do there (deposit, swap, claim, bridge…) and makes a test for each: a
short list of actions and checks written as plain sentences. It runs those tests the way a real
user would, with a real browser and a wallet, against a private copy of the chain.

Nothing it does touches mainnet. Every transaction goes to a local [Anvil](https://getfoundry.sh)
fork, so tests can spend, approve and break things without real money involved.

## Why

dApp frontends break in ways ordinary web tests don't catch. A balance that doesn't update after
a deposit, a button that never leaves "Confirming…", or a button that says "Deposit" while the
transaction asks for unlimited approval of your tokens. DappDrill is built to catch those things.

## What it does

- **Finds what to test.** It looks around your app and lists the goals worth a test. Each test is
  a flat list of actions and checks in plain English, and you can edit any line.
- **Only keeps tests that hold.** A test is kept once it goes the same way twice in a row. One that
  fails every time because of the app, and not the test, is kept as a bug found, saying what was
  expected and what the app did.
- **Runs them with its own wallet.** An injected EIP-1193 / EIP-6963 wallet signs and sends on a
  local fork of each chain. Chains that can't be forked run on their test network with test funds
  you provide, and mainnet chain IDs are never run live.
- **Reviews every signature request.** It compares what the button said with what the calldata
  does, then checks approval scope, contract source and age. Each request gets a verdict of
  *Dangerous*, *Check this* or *Looks consistent*. It never calls one "safe".
- **Replays fast.** The browser actions that worked are saved with each test, so later runs replay
  them directly and only fall back to a model when your UI has changed.

You can use it three ways: through the **web app** (teams, scheduled runs), the **CLI** (one
command, with JSON, Markdown and JUnit output), or **GitHub Actions** (runs on every PR and comments
the results).

## Quick start

You'll need Node 22+, Postgres, [Foundry](https://getfoundry.sh) (for `anvil`) and either an
`ANTHROPIC_API_KEY` or a logged-in [Claude Code](https://claude.com/claude-code).

```bash
corepack pnpm install
corepack pnpm --filter @dappdrill/engine exec playwright install chromium
cp .env.example .env            # set DATABASE_URL and the two secrets
corepack pnpm db:migrate
corepack pnpm dev               # web app on :3000 + background worker
```

Open http://localhost:3000/signup, create an account and paste a dApp URL. Google login turns on
when you set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Try it on the bundled test dApp

Harbor Vault is a small vault app with nine bugs planted on purpose. It's what we use to measure
what DappDrill catches.

```bash
corepack pnpm fixture           # anvil on :8545, Harbor Vault on :5173
corepack pnpm cli make http://localhost:5173
```

`http://localhost:5173/?bugs=none` serves the same app without the bugs, and
`fixtures/harbor-vault/seeded-bugs.json` lists them.

## The CLI

The engine runs on its own, without the web app or a database:

```bash
dappdrill make <url>                    # look at the app, make its tests, write .dappdrill/tests.json
dappdrill make <url> --goal "A user deposits 100 USDC into the vault."   # add one test
dappdrill run                           # run .dappdrill/tests.json
dappdrill run --url <url> --only deposit --junit junit.xml
```

`make` writes the file after every test it keeps, so stopping it loses nothing.

| Exit code | Meaning |
|---|---|
| 0 | Everything passed |
| 1 | A test failed, or a signature was Dangerous, even on a test that passed |
| 2 | The only problem is a test that couldn't be verified, a run that was stopped (Ctrl-C), a run where nothing ran, or DappDrill itself (bad flags, blocked, no tests) |

Dangerous and Check this reviews show under their test and in `summary.md`, all of them are in the
JUnit output, and `results.json` has the full detail. In JUnit output a test with a Dangerous
signature is a failure, whatever its own result, and a test that couldn't be verified is an error.

The tests file is plain JSON: the setup, what is known about the app, what may be signed, and the
tests. Edit a test's lines by hand and commit it. Results go to `dappdrill-out/`: `results.json`,
`summary.md`, and videos and screenshots of every run.

For chains that can't be forked, pass a funded testnet key with `--live-key-env VAR`. Without one,
the wallet signs messages but can't send transactions.

### In GitHub Actions

Copy [`.github/workflows/dappdrill.example.yml`](.github/workflows/dappdrill.example.yml) into
your dApp's repo. It uses the action in [`.github/actions/dappdrill`](.github/actions/dappdrill),
runs your committed tests against the PR's build and comments the results on the PR.

## How it's built

TypeScript throughout, organised as a pnpm monorepo:

```
apps/web               Next.js web app: accounts, organizations, apps, tests, runs
apps/worker            Background jobs (pg-boss) that run the engine and store results in Postgres
apps/site              The marketing site
packages/engine        The engine: Playwright + Anvil + Claude. No database
packages/cli           The `dappdrill` command line
packages/core          Shared types and zod schemas
packages/db            Database schema (Drizzle) and client
fixtures/harbor-vault  The test dApp with seeded bugs
bench/                 What was measured on real dApps
```

The engine uses three Claude models. A thinking model looks around the app and takes a second look
at a test that fails, a fast model writes and repairs tests and judges checks, and a quick model
does a test's model actions first. Models are set in `.env`.

[`CLAUDE.md`](CLAUDE.md) has the architecture notes and the rules the code follows, and
[`docs/product-context.md`](docs/product-context.md) has the product thinking behind it.

## Development

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm make <url> <suite.json> "<goal>"   # make one test while working on the engine
```

`CLAUDE.md` lists the other engine commands (`look`, `suite`, `tests`).

## License

[MIT](LICENSE)
