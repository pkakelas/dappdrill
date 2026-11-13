# DappDrill

Tests for web3 dApp frontends. Paste a URL. A look lists what users come to the app to do, and the
test maker turns each goal into a test: a flat list of actions and checks, written as sentences and done
by code or by a model. A test is kept once it goes the same way twice in a row. Tests run with our own
wallet against local Anvil forks (never mainnet), and every signature request is reviewed. Unhappy paths
(reject, slow RPC, wrong network, low gas…) are not built on this runner yet. The plan and what was measured:
`docs/plans/simple-tests.md`. Product context: `docs/product-context.md`. Layout reference:
`docs/designs/*.html`, where the v2 UX notes in the product context win where the two differ.
The web UI is shadcn/ui (new-york, neutral) on Tailwind v4: use the components in `apps/web/src/components/ui/`
(add more with the shadcn CLI) and keep pages plain. Colour comes as the soft tinted tiles of the New app page
(`Tile` and `TINT` in `apps/web/src/components/tests/tile.tsx`) and the status tokens (good, bad, warn, live, fork)
next to the shadcn theme in `apps/web/src/app/globals.css`; the brand red is only in the logo.

## Layout

```
packages/core     Shared types + zod schemas (Suite, Test, Action, Check, TestResult in suite.ts; MakeState and MakeGoal in
                  make.ts; DrillTarget, ChainConfig, SigningReview, DrillEvent…). No IO.
packages/db       Drizzle schema + client + AES-GCM secret helpers. Postgres (Supabase later). An app row holds its settings
                  and its suite (setup, notes, what may be signed); `tests`, `test_runs` and `makes` are tables. Helpers that
                  read them are in src/tests.ts.
packages/engine   The backend that drills a dApp. No DB. Public API in src/api.ts.
  src/types.ts      Seams between engine modules (ChainController, WalletController, DrillSession, SigningReviewer, Llm, Inbox)
  src/chain/        Anvil forks, live-mode passthrough, chain detection
  src/wallet/       Injected EIP-1193/EIP-6963 provider (page side) + controller (node side)
  src/browser/      Playwright session: video, trace, console + RPC capture, page JSON-RPC routing, and a wallet
                    balance the app's own server reports answered from the fork
  src/run/          The runner: a suite of tests, each a flat list of actions and checks done by code or by a model.
                    A recorded action is replayed; a model works it out again when the recording stops working
  src/make/         Writing the tests: the look lists goals worth a test (it signs nothing), and the maker turns a goal
                    into a test by doing it once, writing it as sentences, then running and repairing it until two
                    runs in a row go the same way. A test that fails every time on a fault of the app is kept, a bug
                    found, once a second look by the thinking model agrees the app is at fault and not the test or
                    our own setup. What looked wrong on the way gets a test of its own, kept only when it fails
  src/replay/       Replaying recorded browser actions, used by run/
  src/agent/        Claude: LLM backends, page snapshots, the browser tools a model acts with
  src/inbox/        A throwaway inbox for apps that sign in by email code
  src/fake/         Canned engine for UI work (DAPPDRILL_FAKE_ENGINE=1)
  src/signing/      Signing review: decode, simulate, approvals, source/proxy/age, known-bad, UI match
packages/cli      `dappdrill make` / `dappdrill run` over a committed tests file (JSON + Markdown + JUnit output)
apps/worker       pg-boss jobs: makes, test runs, scheduled runs. Engine events → DB
apps/web          Next.js app: auth (Better Auth, email/password + Google), organizations, all product pages
apps/site         The marketing site: one static page (Next.js export) with its own styles, nothing shared with apps/web
fixtures/harbor-vault  Local test dApp with seeded bugs, used to measure what we catch
bench             Measurements kept from the old pass: the dApps, what was expected of each, results. No code
```

Engine contract: the worker and CLI call only `makeTests`, `makeTest` and `runSuite` (via `loadEngine()` from
`@dappdrill/engine/fake`). Events stream through a `DrillEventSink`, and progress (a goal started, a test kept, a
line done) through the callbacks each takes. Artifacts (videos, screenshots, traces) are files under an
`artifactsDir`; paths in results are relative to it. The worker keeps them under `ARTIFACTS_DIR/<runs|makes>/<id>/`.

Organizations: apps, test wallets, domains and integrations belong to an organization (Better Auth's
organization plugin; tables `organization`, `member`, `invitation`). Roles are owner / admin / member, and
what each may do is in `apps/web/src/lib/permissions.ts`. Server actions check with `orgAccess(orgId, permission)`
or `requireApp(appId)` from `apps/web/src/lib/session.ts`; forms send their `orgId` rather than trusting the cookie.

## Rules

- TypeScript everywhere, ESM, packages consumed as source (no build step). Run with `tsx`.
- Validate anything persisted or crossing a process boundary with the zod schemas in core.
- Never send a transaction to a mainnet chain. Forks are local Anvil. Live mode (a funded
  testnet key for chains that can't be forked) refuses mainnet chain IDs unless the app
  explicitly allows it.
- Signing review verdicts are Dangerous / Check this / Looks consistent, and never "safe".
  Data from indexers or explorers that we couldn't confirm on the fork is marked unverified.
- Never bypass CAPTCHAs or bot checks. If blocked, report it as blocked.
- UI copy is plain: no "AI" badges or gradients, and "simulate" only means transaction simulation.
  A test's outcome is Passed / Failed / Couldn't verify (plus Running, Queued, Stopped, Not run yet). A failure
  is run once more before it counts. Couldn't verify is for a run nobody can call a pass or a fail: a line that
  couldn't be done, a check that couldn't be decided, our own side breaking. A test kept because it fails every
  time on a fault of the app is a bug found, and says what was expected and what the app did.
- Keep it clean, but don't overengineer: small modules, few abstractions, comments only where they help.
- Three models: thinking `claude-opus-5-5` (env `DAPPDRILL_MODEL`) looks around an app and takes the second look
  at a test that fails; fast `claude-sonnet-5-5` (env `DAPPDRILL_FAST_MODEL`) writes and repairs tests, judges
  checks and takes over an action the quick model couldn't do; quick `claude-haiku-5-5` (env
  `DAPPDRILL_QUICK_MODEL`) does a test's model actions first. Signing review gets no model during test runs, so
  a button label too vague for the rules stays unverified. With `ANTHROPIC_API_KEY` set we use the Anthropic
  SDK; otherwise the Claude Agent SDK and the local Claude Code login.

## Commands

```bash
corepack pnpm install
corepack pnpm db:migrate                 # apply drizzle migrations (DATABASE_URL in .env)
corepack pnpm dev                        # web (3000) + worker
corepack pnpm site                       # marketing site (3100)
corepack pnpm fixture                    # Harbor Vault test dApp: anvil :8545 + site :5173
corepack pnpm cli make http://localhost:5173   # the CLI as users get it: make | run
corepack pnpm typecheck
corepack pnpm suite <url> <suite.json>  # run a suite file (fixtures/harbor-vault/tests.json, fixtures/pod/tests.json) and print each line's result, time and cost; --runs n, --only text, --target <a kept target.json: its accounts, chains and inbox>
corepack pnpm look <url> <suite.json>   # list the goals worth a test, and add what it learned about the app to the suite file's notes
corepack pnpm make <url> <suite.json> "<goal>"   # make one test from a goal and add it to the suite file once it is proven; --start /path, --dry
corepack pnpm tests <url> <suite.json>  # the whole way, as a user gets it: the look, a test made for each of its goals (up to 20), then one run of them all; --count n, --target
```

The last four (packages/engine/dev/) are for working on the engine without the web app or the CLI's file
format: they print each line's result, time and cost, and keep everything under `.drill/`.

Forks read through a local relay over the chain's RPCs that keep old state. Public RPCs prune it or rate-limit,
so set `DAPPDRILL_RPC_<chainId>` (comma-separated URLs) to an archive RPC where runs must not depend on them.

Use `scripts/pnpm-locked.sh <pnpm args>` instead of bare pnpm when adding dependencies
(several agents may share this checkout).

Local services: Postgres on 127.0.0.1:5499, database `dappdrill` (the connection string is `DATABASE_URL` in `.env`), psql at
`/Applications/Postgres.app/Contents/Versions/latest/bin/psql`. Foundry (anvil/forge/cast) on PATH.
