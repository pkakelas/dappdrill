# DappDrill

**Automated tests for web3 dApp frontends.** Give it your dApp's URL. It looks around the app,
lists what people come to do there (deposit, swap, claim, bridge…) and makes a test for each: a
short list of actions and checks, each one code with a plain sentence that explains it. It runs
those tests the way a real user would, with a real browser and a wallet, in the environment your
app really runs in: its own chains, its own servers.

The wallet is yours to choose. Give it a key that holds test funds and every test starts on a new
account paid from it, or keep one account and say how to put it back before each test.

## Why

dApp frontends break in ways ordinary web tests don't catch. A balance that doesn't update after
a deposit, a button that never leaves "Confirming…", or a button that says "Deposit" while the
transaction asks for unlimited approval of your tokens. DappDrill is built to catch those things.

## What it does

- **Finds what to test.** It looks around your app and lists the goals worth a test. Each test is
  a flat list of actions and checks. Every line is code, with a sentence in plain English that says
  what it does, and you can edit any line.
- **Only keeps tests that hold.** A test is kept once it goes the same way twice in a row. One that
  fails every time because of the app, and not the test, is kept as a bug found, saying what was
  expected and what the app did.
- **Runs them with its own wallet.** An injected EIP-1193 / EIP-6963 wallet signs and sends on the
  chains your app uses, through their own RPCs. Nothing is forked, so an app whose server, indexer
  or second chain has to see the transaction works like any other.
- **Checks what matters.** A check can compare figures within a tolerance, a balance before and
  after, a row in a table, or accept any of several outcomes when the app has more than one right
  answer.
- **Reviews every signature request.** It compares what the button said with what the calldata
  does, then checks approval scope, contract source and age. Each request gets a verdict of
  *Dangerous*, *Check this* or *Looks consistent*. It never calls one "safe".
- **Runs with no model.** A run is code from the first line to the last: fast, the same every
  time, and no API key in CI. When your UI changes and a line no longer fits the page, the run says
  so, and a repair writes that line again.

You can use it three ways: through the **web app** (teams, scheduled runs), the **CLI** (one
command, with JSON, Markdown and JUnit output), or **GitHub Actions** (runs on every PR and comments
the results).

## Quick start

You'll need Node 22+, Postgres and either an `ANTHROPIC_API_KEY` or a logged-in
[Claude Code](https://claude.com/claude-code). The bundled test dApp also needs
[Foundry](https://getfoundry.sh) (for `anvil`).

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
corepack pnpm fixture           # anvil on :8545, Harbor Vault on :5173, and the flags to test it with
corepack pnpm cli make http://localhost:5173 --key <the key it printed> --fund 31337:1
```

`http://localhost:5173/?bugs=none` serves the same app without the bugs, and
`fixtures/harbor-vault/seeded-bugs.json` lists them.

## The CLI

The engine runs on its own, without the web app or a database:

```bash
dappdrill make <url>                    # look at the app, make its tests, write .dappdrill/tests.json
dappdrill make <url> --goal "A user deposits 100 USDC into the vault."   # add one test
dappdrill run                           # run .dappdrill/tests.json, with no model
dappdrill run --url <url> --only deposit --junit junit.xml
dappdrill repair                        # write again the lines a run couldn't do
```

`make` writes the file after every test it keeps, so stopping it loses nothing. `make` and `repair`
use a model; `run` never does.

The account the tests act as:

```bash
--account new --key <hex> --fund 84532:0.05 --fund 84532:0x036C…CF7e:100   # a new account per start, sent this much
--account kept --key <hex>                                                 # the same account on every run
```

The key can also come from `$DAPPDRILL_KEY`. With a kept account, the tests file's `reset` lines put
the account back before each test (cancel what is open, withdraw what was deposited).

| Exit code | Meaning |
|---|---|
| 0 | Everything passed |
| 1 | A test failed, or a signature was Dangerous, even on a test that passed |
| 2 | The only problem is a test that couldn't be verified (one that needs `repair` says so), a run that was stopped (Ctrl-C), a run where nothing ran, or DappDrill itself (bad flags, blocked, no tests) |

Dangerous and Check this reviews show under their test and in `summary.md`, all of them are in the
JUnit output, and `results.json` has the full detail. In JUnit output a test with a Dangerous
signature is a failure, whatever its own result, and a test that couldn't be verified is an error.

The tests file is plain JSON: the setup, the reset, what is known about the app, what may be
signed, and the tests. Edit a test's lines by hand and commit it. Results go to `dappdrill-out/`:
`results.json`, `summary.md`, and videos and screenshots of every run.

Without a key the wallet signs messages but can't pay for transactions.

### In GitHub Actions

Copy [`.github/workflows/dappdrill.example.yml`](.github/workflows/dappdrill.example.yml) into
your dApp's repo. It uses the action in [`.github/actions/dappdrill`](.github/actions/dappdrill),
runs your committed tests against the PR's build and comments the results on the PR. It needs the
funded key as a secret (`DAPPDRILL_KEY`), and no model key.

## How it's built

TypeScript throughout, organised as a pnpm monorepo:

```
apps/web               Next.js web app: accounts, organizations, apps, tests, runs
apps/worker            Background jobs (pg-boss) that run the engine and store results in Postgres
apps/site              The marketing site
packages/engine        The engine: Playwright + a wallet + Claude. No database
packages/cli           The `dappdrill` command line
packages/core          Shared types and zod schemas
packages/db            Database schema (Drizzle) and client
fixtures/harbor-vault  The test dApp with seeded bugs
bench/                 What was measured on real dApps
```

The engine uses three Claude models, and only while tests are made or repaired. A thinking model
looks around the app and takes a second look at a test that fails, a fast model writes and repairs
tests, and a quick model does an action that has no code yet. Models are set in `.env`.

[`CLAUDE.md`](CLAUDE.md) has the architecture notes and the rules the code follows, and
[`docs/product-context.md`](docs/product-context.md) has the product thinking behind it.

## Development

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm make <url> <suite.json> "<goal>"   # make one test while working on the engine
```

`CLAUDE.md` lists the other engine commands (`look`, `suite`, `repair`, `tests`).

## License

[MIT](LICENSE)
