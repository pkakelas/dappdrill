# DappDrill

**Automated tests for web3 dApp frontends.** Give it your dApp's URL. In a minute or two it
works out what people do in your app (deposit, swap, claim, bridge…) and writes a test for each.
It then runs those tests the way a real user would, with a real browser and a wallet, against
a private copy of the chain.

Nothing it does touches mainnet. Every transaction goes to a local [Anvil](https://getfoundry.sh)
fork, so tests can spend, approve and break things without real money involved.

## Why

dApp frontends break in ways ordinary web tests don't catch. The user rejects a transaction
halfway through, the wallet sits on the wrong network, the RPC is slow, gas runs short, or the
button says "Deposit" while the transaction asks for unlimited approval of your tokens. DappDrill
is built to catch those things.

## What it does

- **Finds what to test.** It looks around your app and suggests tests. Each test is a goal, an
  expected result and a few short steps in plain English, and you can edit any of them.
- **Runs them with its own wallet.** An injected EIP-1193 / EIP-6963 wallet signs and sends on
  a local fork of each chain. Chains that can't be forked can run on a testnet with a funded
  test key, and mainnet chain IDs are never run live.
- **Tries the unhappy paths.** From each passing test it builds variants: rejected in the wallet,
  slow or failing RPC, wrong network, low gas, account switch, and more.
- **Reviews every signature request.** It compares what the button said with what the calldata
  does, then checks approval scope, contract source and age, and changes since the last run. Each
  request gets a verdict of *Dangerous*, *Check this* or *Looks consistent*. It never calls one "safe".
- **Confirms before it blames you.** A failure stays *Probably failed* until a second run in a
  fresh browser shows it again. Only then is it reported as a bug.
- **Replays fast.** The browser actions that worked are saved with each test, so later runs
  replay them directly and only fall back to the agent when your UI has changed.

You can use it three ways: through the **web app** (teams, scheduled runs, an assistant that can
drive the browser), the **CLI** (one command, with JSON, Markdown and JUnit output), or **GitHub
Actions** (runs on every PR and comments the results).

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
corepack pnpm cli analyze http://localhost:5173
```

`http://localhost:5173/?bugs=none` serves the same app without the bugs, and
`fixtures/harbor-vault/seeded-bugs.json` lists them.

## The CLI

The engine runs on its own, without the web app or a database:

```bash
dappdrill analyze <url>     # find what to test, write .dappdrill/tests.json, run it
dappdrill run               # run the committed .dappdrill/tests.json
dappdrill run --url <url> --only deposit --conditions --junit junit.xml
```

`--conditions` adds the usual unhappy paths (rejected in wallet, slow RPC…), and `--condition <id>`
adds a specific one. Conditions apply only to tests that ask the wallet to sign.

The tests file is plain JSON, so you can edit a test by hand and commit it. Results go to
`dappdrill-out/`: `results.json`, `summary.md`, and videos and screenshots of every run.

| Exit code | Meaning |
|---|---|
| 0 | Everything passed |
| 1 | A test failed, or a signature was Dangerous (even on a test that passed) |
| 2 | Nothing failed, but something couldn't run: a test that couldn't start, a stopped run, bad flags, a blocked site, no tests |

For chains that can't be forked, pass a funded testnet key with `--live-key-env VAR`.

### In GitHub Actions

Copy [`.github/workflows/dappdrill.example.yml`](.github/workflows/dappdrill.example.yml) into
your dApp's repo. It uses the action in [`.github/actions/dappdrill`](.github/actions/dappdrill),
runs your committed tests against the PR's build and comments the results on the PR.

## How it's built

TypeScript throughout, organised as a pnpm monorepo:

```
apps/web               Next.js web app: accounts, organizations, apps, tests, runs, the assistant
apps/worker            Background jobs (pg-boss) that run the engine and store results in Postgres
apps/site              The marketing site
packages/engine        The engine: Playwright + Anvil + Claude. No database
packages/cli           The `dappdrill` command line
packages/core          Shared types and zod schemas
packages/db            Database schema (Drizzle) and client
fixtures/harbor-vault  The test dApp with seeded bugs
bench/                 Benchmarks against real dApps
```

The engine uses three Claude models. A thinking model looks around the app and suggests tests,
a fast model explores features, runs steps and judges results, and an acting model takes over
the steps the fast model can't do. Models are set in `.env`.

[`CLAUDE.md`](CLAUDE.md) has the architecture notes and the rules the code follows, and
[`docs/product-context.md`](docs/product-context.md) has the product thinking behind it.

## Development

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm drill look <url>   # run one stage of a pass at a time while working on the engine
```

## License

[MIT](LICENSE)
