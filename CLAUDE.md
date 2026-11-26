# DappDrill

Tests for web3 dApp frontends. Paste a URL. A look lists what users come to the app to do, and the
test maker turns each goal into a test: a flat list of actions and checks. The code of a line is the test
(a recorded action, a check by code) and its sentence explains it in plain words. A test is kept once it
goes the same way twice in a row with no model. Tests run with our own wallet in the app's real environment:
its own chains through their RPCs, with a new account paid from a funded key on every start, or one kept
account that a reset puts back before each test. Every signature request is reviewed. A test may have
the user say no in the wallet (reject a signature, refuse to connect or to switch network); the other unhappy paths
(slow RPC, low gas…) are not built on this runner yet. The plans and what was measured:
`docs/plans/simple-tests.md`, and `docs/plans/real-environment-tests.md` for why there are no forks and no
model in a run. Product context: `docs/product-context.md`. Layout reference:
`docs/designs/*.html`, where the v2 UX notes in the product context win where the two differ.
The web UI is shadcn/ui (new-york, neutral) on Tailwind v4: use the components in `apps/web/src/components/ui/`
(add more with the shadcn CLI) and keep pages plain. Colour comes as the soft tinted tiles of the New app page
(`Tile` and `TINT` in `apps/web/src/components/tests/tile.tsx`) and the status tokens (good, bad, warn, live)
next to the shadcn theme in `apps/web/src/app/globals.css`; the brand red is only in the logo.

## Layout

```
packages/core     Shared types + zod schemas (Suite, Test, Action, Check, CodeAssert, TestResult in suite.ts; MakeState and
                  MakeGoal in make.ts; DrillTarget, ChainConfig, SigningReview, DrillEvent…). No IO.
packages/db       Drizzle schema + client + AES-GCM secret helpers. Postgres (Supabase later). An app row holds its settings
                  (which account it is tested as, what a new account is paid) and its suite (setup, reset, notes, what may
                  be signed); `tests`, `test_runs` and `makes` are tables (a repair is a row in `makes`). Helpers that
                  read them are in src/tests.ts.
packages/engine   The backend that drills a dApp. No DB. Public API in src/api.ts.
  src/types.ts      Seams between engine modules (ChainController, WalletController, DrillSession, SigningReviewer, Llm, Inbox)
  src/chain/        The app's chains through their real RPCs, and chain detection. Nothing is forked
  src/wallet/       Injected EIP-1193/EIP-6963 provider (page side) + controller (node side)
  src/browser/      Playwright session: video, trace, console, and a log of the page's JSON-RPC calls (nothing is rerouted)
  src/run/          The runner: a suite of tests, each a flat list of lines done by code. A run calls no model: a line
                    that isn't code yet, or whose recording no longer fits the page, ends Couldn't verify and the result
                    says the test can be repaired. env.ts holds the accounts (new and paid, or kept) and suite.ts the
                    clean start before each test (a new account and the setup, or the reset)
  src/make/         Writing the tests: the look lists goals worth a test (it signs nothing), and the maker turns a goal
                    into a test by doing it once, writing it as code with a sentence per line, then running and
                    repairing it until two runs in a row with no model go the same way. A test that fails every time
                    on a fault of the app is kept, a bug found, once a second look by the thinking model agrees the app
                    is at fault and not the test or our own setup. What looked wrong on the way gets a test of its own,
                    kept only when it fails. repair-suite.ts writes kept tests as code again
  src/replay/       Replaying recorded browser actions, used by run/
  src/agent/        Claude: LLM backends, page snapshots, the browser tools a model acts with
  src/inbox/        A throwaway inbox for apps that sign in by email code
  src/fake/         Canned engine for UI work (DAPPDRILL_FAKE_ENGINE=1)
  src/signing/      Signing review: decode, simulate (an eth_call on the chain), approvals, source/proxy/age, known-bad, UI match
packages/cli      `dappdrill make` / `dappdrill run` / `dappdrill repair` over a committed tests file (JSON + Markdown + JUnit output)
apps/worker       pg-boss jobs: makes, test runs, repairs, scheduled runs. Engine events → DB
apps/web          Next.js app: auth (Better Auth, email/password + Google), organizations, all product pages
apps/site         The marketing site: one static page (Next.js export) with its own styles, nothing shared with apps/web
fixtures/harbor-vault  Local test dApp with seeded bugs, used to measure what we catch
bench             Measurements kept from the old pass: the dApps, what was expected of each, results. No code
```

Engine contract: the worker and CLI call only `makeTests`, `makeTest`, `runSuite` and `repairSuite` (via `loadEngine()`
from `@dappdrill/engine/fake`). Events stream through a `DrillEventSink`, and progress (a goal started, a test kept, a
line done) through the callbacks each takes. Artifacts (videos, screenshots, traces) are files under an
`artifactsDir`; paths in results are relative to it. The worker keeps them under `ARTIFACTS_DIR/<runs|makes>/<id>/`.

Lines: an action is code when it has a recording (`run`), a check when it has an `expect` (`CodeAssert`: shows, hides,
said, url, button, signed, not-signed, mined, changes, figures, no-error, and `any` / `all` of those; each may
`wait`). A check can be as rich as the app needs: figures compared within a tolerance, a difference before and after,
any of several outcomes, what the wallet was asked in the whole test or (`latest`) by the latest action alone. A
recorded step may be optional (done only when the page asks for it) and may name the row it acts in. The wallet
approves a request to connect or to switch network the moment it comes, so a `refuse` step goes before the step that
makes the app ask, in the same recording; a recording whose refusal the app never asked for doesn't pass. `by: "llm"`, or
an action with no recording, means "not written as code yet", and only making and repairing (`byModel`) let a model do
such a line.

Accounts: `DrillTarget.account` is `new` (fresh keys on every start, account A paid what `fund` lists from
`fundedKey`, then the setup) or `kept` (`fundedKey` or the kept accounts are the user, the setup once, the suite's
`reset` lines before each test). Apps that make a user of every wallet they see belong on a kept account.
A test may say what its own new account starts with (`Test.fund`, in place of the app's list; empty for an account
that holds nothing). New accounts paid by a key are made from that key and an id of the run (kept in the run's
`test-accounts.json`), and what a test leaves on one is sent back to the key before the next account is paid
(`run/sweep.ts`), so a suite runs again and again on the same funds.
On new accounts a suite runs four tests at the same time, each in a browser of its own (`atOnce`, `--at-once n`, env
`DAPPDRILL_AT_ONCE`); a test the key can't pay yet waits for another test's account to be sent back. On a kept
account tests run one after another.

Organizations: apps, test wallets, domains and integrations belong to an organization (Better Auth's
organization plugin; tables `organization`, `member`, `invitation`). Roles are owner / admin / member, and
what each may do is in `apps/web/src/lib/permissions.ts`. Server actions check with `orgAccess(orgId, permission)`
or `requireApp(appId)` from `apps/web/src/lib/session.ts`; forms send their `orgId` rather than trusting the cookie.

## Rules

- TypeScript everywhere, ESM, packages consumed as source (no build step). Run with `tsx`.
- Validate anything persisted or crossing a process boundary with the zod schemas in core.
- Tests act on the app's real chains with the keys the app's owner gave. Nothing is refused because a chain is
  a mainnet: which chain and which key an app is tested with is its owner's call.
- Signing review verdicts are Dangerous / Check this / Looks consistent, and never "safe".
  Data from indexers or explorers that we couldn't confirm on the chain is marked unverified.
- Never bypass CAPTCHAs or bot checks. If blocked, report it as blocked.
- UI copy is plain: no "AI" badges or gradients, and "simulate" only means transaction simulation.
  A test's outcome is Passed / Failed / Couldn't verify (plus Running, Queued, Stopped, Not run yet). A failure
  is run once more before it counts. Couldn't verify is for a run nobody can call a pass or a fail: a line that
  isn't code yet or no longer fits the page (the test is repaired), a check that couldn't be decided, our own side
  breaking. A test kept because it fails every time on a fault of the app is a bug found, and says what was
  expected and what the app did.
- Keep it clean, but don't overengineer: small modules, few abstractions, comments only where they help.
- A run calls no model. Three models work only while tests are made or repaired: thinking `claude-opus-5-5`
  (env `DAPPDRILL_MODEL`) looks around an app and takes the second look at a test that fails; fast
  `claude-sonnet-5-5` (env `DAPPDRILL_FAST_MODEL`) writes and repairs tests, writes checks as code and takes over an
  action the quick model couldn't do; quick `claude-haiku-5-5` (env `DAPPDRILL_QUICK_MODEL`) does an action that has
  no code first. Signing review gets no model, so a button label too vague for the rules stays unverified. With
  `ANTHROPIC_API_KEY` set we use the Anthropic SDK; otherwise the Claude Agent SDK and the local Claude Code login.

## Commands

```bash
corepack pnpm install
corepack pnpm db:migrate                 # apply drizzle migrations (DATABASE_URL in .env)
corepack pnpm dev                        # web (3000) + worker
corepack pnpm site                       # marketing site (3100)
corepack pnpm fixture                    # Harbor Vault test dApp: anvil :8545 + site :5173; prints the --key and --fund flags to test it with
corepack pnpm cli make http://localhost:5173   # the CLI as users get it: make | run | repair
corepack pnpm collect <run id> --key <hex> --chain id[=rpc]   # send back to the funding key what the accounts of a run that was cut short still hold; --fund chainId:token:amount names an ERC-20 to look for
corepack pnpm typecheck
corepack pnpm suite <url> <suite.json>  # run a suite file with no model (fixtures/harbor-vault/tests.json, fixtures/pod/tests.json) and print each line's result and time; --runs n, --only text, --at-once n
corepack pnpm repair <url> <suite.json> # write the suite file's lines as code again, with models: the setup and reset, then every test with a line that isn't code, or --only text; --dry
corepack pnpm look <url> <suite.json>   # list the goals worth a test, and add what it learned about the app to the suite file's notes
corepack pnpm make <url> <suite.json> "<goal>"   # make one test from a goal and add it to the suite file once it is proven; --start /path, --dry
corepack pnpm tests <url> <suite.json>  # the whole way, as a user gets it: the look, a test made for each of its goals (up to 20), then one run of them all; --count n
```

The last five (packages/engine/dev/) are for working on the engine without the web app or the CLI's file
format: they print each line's result and time (and its cost, where models work), and keep everything under
`.drill/`. They share the account flags told in `packages/engine/dev/target.ts`: `--account new|kept`,
`--key <hex>` (the funded key), `--fund chainId[:token]:amount` (what a new account is paid, repeatable),
`--chain id[=rpc]`, and `--target <a kept target.json: its accounts, chains and inbox>`, which means a kept account.
`make` also takes `--starts-with chainId[:token]:amount|nothing` for what that one test's account starts with.

Use `scripts/pnpm-locked.sh <pnpm args>` instead of bare pnpm when adding dependencies
(several agents may share this checkout).

Local services: Postgres on 127.0.0.1:5499, database `dappdrill` (the connection string is `DATABASE_URL` in `.env`), psql at
`/Applications/Postgres.app/Contents/Versions/latest/bin/psql`. Foundry (anvil/forge/cast) on PATH, needed only for the fixture.
