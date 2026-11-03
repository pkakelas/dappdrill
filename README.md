# DappDrill

AI QA for web3 dApp frontends. Paste a URL: an agent with its own test wallet explores the
dApp on local Anvil forks, saves the flows it finds as deterministic tests, replays them under
wallet edge cases (reject, wrong network, account switch, low gas, slow RPC, two wallets…) and
reviews every signature request. Nothing touches mainnet.

```
apps/web          Next.js app: accounts, apps, scans, flows, runs, issues, signing reviews, settings
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
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. `corepack pnpm --filter @dappdrill/web seed:demo`
creates a demo account with a scanned app.

## Try it on the test dApp

```bash
corepack pnpm fixture           # anvil on :8545, Harbor Vault on :5173
corepack pnpm cli scan http://localhost:5173 --max-minutes 15
```

`http://localhost:5173/?bugs=none` serves the same app without the seeded bugs
(`fixtures/harbor-vault/seeded-bugs.json` lists them).

## CLI and CI

The engine runs without the web app or a database:

```bash
dappdrill scan <url>                    # explore, save flows to dappdrill-out/flows, test them
dappdrill run --url <url>               # replay .dappdrill/flows; exits 1 on Broken
dappdrill describe "deposit 10 USDC" --url <url>
```

Reports are written as JSON, Markdown and JUnit. Chains that can't be forked run on the live
testnet: pass a funded testnet key with `--live-key-env VAR`. Without one, the wallet signs
messages but can't send transactions. Mainnet chain ids are never run live.

For GitHub, copy `.github/workflows/dappdrill.example.yml` into your dApp's repo. It uses the
action in `.github/actions/dappdrill`, comments results on the PR, and can report to the web
app with the app's CI token (Settings → CI).

## Development

```bash
corepack pnpm typecheck
corepack pnpm test
```

`CLAUDE.md` has the architecture notes and the rules the code follows.
