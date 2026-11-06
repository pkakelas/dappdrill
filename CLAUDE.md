# DappDrill

Tests for web3 dApp frontends. Paste a URL. In a minute or two an agent finds the
app's main uses and writes a test for each (goal, expected result, short steps).
Tests run with our own wallet against local Anvil forks (never mainnet). Unhappy paths
(reject, slow RPC, wrong network, low gas…) are derived from happy-path tests, and every
signature request is reviewed. A fast assistant on every page can see the app map and
drive the browser. Product context: `docs/product-context.md`. Layout reference:
`docs/designs/*.html`, where the v2 UX notes in the product context win where the two differ.
The web UI is shadcn/ui (new-york, neutral) on Tailwind v4: use the components in `apps/web/src/components/ui/`
(add more with the shadcn CLI) and keep pages plain. Colour comes as the soft tinted tiles of the New app page
(`Tile` and `TINT` in `apps/web/src/components/tests/tile.tsx`) and the status tokens (good, bad, warn, live, fork)
next to the shadcn theme in `apps/web/src/app/globals.css`; the brand red is only in the logo.

## Layout

```
packages/core     Shared types + zod schemas (TestSpec, TestStep, TestRunResult, AppMap, CONDITIONS, DrillEvent…). No IO.
packages/db       Drizzle schema + client + AES-GCM secret helpers. Postgres (Supabase later).
packages/engine   The backend that drills a dApp. No DB. Public API in src/api.ts.
  src/types.ts      Seams between engine modules (ChainController, WalletController, DrillSession, SigningReviewer, Llm, RecoveryJudge)
  src/chain/        Anvil forks, live-mode passthrough, RPC faults, chain detection
  src/wallet/       Injected EIP-1193/EIP-6963 provider (page side) + controller (node side)
  src/browser/      Playwright session: video, trace, console + RPC capture, page JSON-RPC routing
  src/pipeline/     analyze (the CLI's quick look: find what to test, write tests) and runTests (cached actions first, the agent when they stop working)
  src/replay/       Replaying recorded actions + unhappy-path conditions, used by pipeline/
  src/explore/      One pass over an app: look around and suggest tests, check the setup, an explorer per feature,
                    prove each test on a fresh fork (replaying the explorer's actions first), confirm bugs
  src/agent/        Claude: LLM backends, analyst, tester, judge, test writer, assistant chat
  src/fake/         Canned engine for UI work (DAPPDRILL_FAKE_ENGINE=1)
  src/signing/      Signing review: decode, simulate, approvals, source/proxy/age, known-bad, UI match, baseline diff
packages/cli      `dappdrill analyze` / `dappdrill run` over a committed tests file (JSON + Markdown + JUnit output)
apps/worker       pg-boss jobs: explorations, test runs, test drafts, assistant turns, scheduled runs. Engine events → DB
apps/web          Next.js app: auth (Better Auth, email/password + Google), organizations, all product pages
fixtures/harbor-vault  Local test dApp with seeded bugs, used to measure what we catch
```

Engine contract: the worker and CLI call only `explore`, `analyze` (CLI only), `runTests`, `writeTest`, `chatTurn`
(via `loadEngine()` from `@dappdrill/engine/fake`). Events stream through a `DrillEventSink`. Artifacts (videos,
screenshots, traces) are files under an `artifactsDir`; paths in results are relative to it.

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
  Test status vocabulary: Passed / Failed / Couldn't run (plus Running, Queued, Not run yet).
- Keep it clean, but don't overengineer: small modules, few abstractions, comments only where they help.
- Three models: thinking `claude-opus-5-5` (env `DAPPDRILL_MODEL`) looks around an app and suggests tests; fast
  `claude-sonnet-5-5` (env `DAPPDRILL_FAST_MODEL`) explores each feature, runs test steps, judges results, writes
  tests and answers the assistant; acting `claude-opus-5-5` (env `DAPPDRILL_ACT_MODEL`) takes over steps the
  fast model can't do. Signing review gets no model during test runs, so a button label too vague for
  the rules stays unverified. With `ANTHROPIC_API_KEY` set we use the Anthropic SDK; otherwise the
  Claude Agent SDK and the local Claude Code login.

## Commands

```bash
corepack pnpm install
corepack pnpm db:migrate                 # apply drizzle migrations (DATABASE_URL in .env)
corepack pnpm dev                        # web (3000) + worker
corepack pnpm fixture                    # Harbor Vault test dApp: anvil :8545 + site :5173
corepack pnpm cli analyze http://localhost:5173
corepack pnpm typecheck
```

Use `scripts/pnpm-locked.sh <pnpm args>` instead of bare pnpm when adding dependencies
(several agents may share this checkout).

Local services: Postgres `postgres://opencouncil@127.0.0.1:5499/dappdrill`, psql at
`/Applications/Postgres.app/Contents/Versions/latest/bin/psql`. Foundry (anvil/forge/cast) on PATH.
