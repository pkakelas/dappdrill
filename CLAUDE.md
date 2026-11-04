# DappDrill

Tests for web3 dApp frontends. Paste a URL. In a minute or two an agent finds the
app's main flows and writes one test per flow (goal, expected result, short steps).
Tests run with our own wallet against local Anvil forks (never mainnet). Unhappy paths
(reject, slow RPC, wrong network, low gas…) are derived from happy-path tests, and every
signature request is reviewed. A fast assistant on every page can see the app map and
drive the browser. Product context: `docs/product-context.md`. Layout reference:
`docs/designs/*.html`, where the v2 UX notes in the product context win where the two differ.
The web UI is shadcn/ui (new-york, neutral) on Tailwind v4: use the components in `apps/web/src/components/ui/`
(add more with the shadcn CLI) and keep pages plain. Only problems get colour, through the status tokens
(bad, warn, live) next to the shadcn theme in `apps/web/src/app/globals.css`; the brand red is only in the logo.

## Layout

```
packages/core     Shared types + zod schemas (TestSpec, TestStep, TestRunResult, AppMap, CONDITIONS, DrillEvent…). No IO.
packages/db       Drizzle schema + client + AES-GCM secret helpers. Postgres (Supabase later).
packages/engine   The backend that drills a dApp. No DB. Public API in src/api.ts.
  src/types.ts      Seams between engine modules (ChainController, WalletController, DrillSession, SigningReviewer, Llm, RecoveryJudge)
  src/chain/        Anvil forks, live-mode passthrough, RPC faults, chain detection
  src/wallet/       Injected EIP-1193/EIP-6963 provider (page side) + controller (node side)
  src/browser/      Playwright session: video, trace, console + RPC capture, page JSON-RPC routing
  src/pipeline/     analyze (find flows, write tests) and runTests (cached actions first, the agent when they stop working)
  src/replay/       Replaying recorded actions + unhappy-path conditions, used by pipeline/
  src/agent/        Claude: LLM backends, analyst, tester, judge, test writer, assistant chat
  src/fake/         Canned engine for UI work (DAPPDRILL_FAKE_ENGINE=1)
  src/signing/      Signing review: decode, simulate, approvals, source/proxy/age, known-bad, UI match, baseline diff
packages/cli      `dappdrill analyze` / `dappdrill run` over a committed tests file (JSON + Markdown + JUnit output)
apps/worker       pg-boss jobs: analysis, test runs, test drafts, assistant turns, scheduled runs. Engine events → DB
apps/web          Next.js app: auth (Better Auth, email/password + Google), all product pages
fixtures/harbor-vault  Local test dApp with seeded bugs, used to measure what we catch
```

Engine contract: the worker and CLI call only `analyze`, `runTests`, `writeTest`, `chatTurn`
(via `loadEngine()` from `@dappdrill/engine/fake`). Events stream through a `DrillEventSink`. Artifacts (videos,
screenshots, traces) are files under an `artifactsDir`; paths in results are relative to it.

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
  Test status vocabulary: Passed / Failed / Couldn't run (plus Running, Queued, Not run yet). Only problems get colour.
- Keep it clean, but don't overengineer: small modules, few abstractions, comments only where they help.
- Three models: thinking `claude-opus-5-5` (env `DAPPDRILL_MODEL`) analyzes apps; fast
  `claude-haiku-5-5` (env `DAPPDRILL_FAST_MODEL`) runs test steps, judges results, writes tests and
  answers the assistant; acting `claude-sonnet-5-5` (env `DAPPDRILL_ACT_MODEL`) takes over steps the
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
