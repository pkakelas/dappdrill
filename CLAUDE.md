# DappDrill

AI QA for web3 dApp frontends. Paste a URL. An agent with its own wallet explores
the dApp against local Anvil forks (never mainnet), saves the flows it finds as
deterministic tests, replays them under wallet edge cases, and reviews every
signature request. Product context: `docs/product-context.md`. Layout reference:
`docs/designs/*.html`, where the v2 UX notes in the product context win where the two differ.
The look (paper and ink, Newsreader for text, Plex Mono for controls, pill buttons) follows the
marketing site in `../dappdrill-site`; tokens live in `apps/web/src/app/globals.css`.

## Layout

```
packages/core     Shared types + zod schemas (Flow, Step, Issue, SigningReview, FlowRun, DrillEvent…). No IO.
packages/db       Drizzle schema + client + AES-GCM secret helpers. Postgres (Supabase later).
packages/engine   The backend that drills a dApp. No DB. Public API in src/api.ts.
  src/types.ts      Seams between engine modules (ChainController, WalletController, DrillSession, SigningReviewer, Llm, RecoveryJudge)
  src/chain/        Anvil forks, live-mode passthrough, RPC faults, chain detection
  src/wallet/       Injected EIP-1193/EIP-6963 provider (page side) + controller (node side)
  src/browser/      Playwright session: video, trace, console + RPC capture, page JSON-RPC routing
  src/replay/       Deterministic flow replay + edge-case matrix + issue detection
  src/agent/        Claude: LLM backends, explorer, describe-a-flow, repair, recovery judge, test inbox
  src/signing/      Signing review: decode, simulate, approvals, source/proxy/age, known-bad, UI match, baseline diff
packages/cli      `dappdrill` CLI for CI / standalone runs (JSON + Markdown + JUnit output)
apps/worker       pg-boss jobs: scans, replays, schedules, flow changes, notifications. Engine events → DB
apps/web          Next.js app: auth (Better Auth, email/password + Google), all product pages
fixtures/harbor-vault  Local test dApp with seeded bugs, used to measure what we catch
```

Engine contract: the worker and CLI call only `scan`, `replay`, `describeFlow`, `repairFlow`
from `@dappdrill/engine`. Events stream through a `DrillEventSink`. Artifacts (videos,
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
  Status vocabulary: Broken / Review / OK. Only problems get colour.
- Keep it clean, but don't overengineer: small modules, few abstractions, comments only where they help.
- Default model `claude-opus-5-5` (env `DAPPDRILL_MODEL`). With `ANTHROPIC_API_KEY` set we use
  the Anthropic SDK; otherwise the Claude Agent SDK and the local Claude Code login.

## Commands

```bash
corepack pnpm install
corepack pnpm db:migrate                 # apply drizzle migrations (DATABASE_URL in .env)
corepack pnpm dev                        # web (3000) + worker
corepack pnpm fixture                    # Harbor Vault test dApp: anvil :8545 + site :5173
corepack pnpm cli scan http://localhost:5173
corepack pnpm typecheck
```

Use `scripts/pnpm-locked.sh <pnpm args>` instead of bare pnpm when adding dependencies
(several agents may share this checkout).

Local services: Postgres `postgres://opencouncil@127.0.0.1:5499/dappdrill`, psql at
`/Applications/Postgres.app/Contents/Versions/latest/bin/psql`. Foundry (anvil/forge/cast) on PATH.
