# Tests on the app's real environment, run by code

Proposed and built on 2026-11-18, stages 1 to 4. It replaces the fork parts of `simple-tests.md`. The
sections from "Why" on are the proposal as it was written; "Built" says what was decided on the way and what
was measured.

## Built

Decided while building, and where these differ from the proposal below, these win:

1. **Mainnet is not guarded.** Nothing refuses, warns off or needs a tick because a chain holds real money.
   Which chain and which key an app is tested with is its owner's call. `Suite.signing` stays as the owner's
   own choice of what may be signed.
2. **The code of a line is the test; its sentence explains it.** A check may be as rich as it needs to be:
   figures compared within a tolerance, a difference between before and after, any of several outcomes, a wait
   until something settles, what the wallet was asked in the whole test or by the latest action alone. It
   stays data (`CodeAssert` in core), each kind something Playwright can do, no model.
3. **A run never calls a model.** `by: "llm"`, or an action with no recording, now means "not written as
   code yet". Such a line, or a recording that no longer fits the page, ends Couldn't verify and the result
   says the test can be repaired. Only making and repairing let a model do a line.
4. **Repair is `repairSuite`**: the setup and the reset first, then each test once with a model, its
   model-answered checks written as code, then proven by two runs with no model that go the same way. The
   worker has a repair job, the web app a Repair button, the CLI `dappdrill repair`, and engine work
   `corepack pnpm repair`.
5. **No migration.** The key column is still `live_key_enc`; in a target it is `fundedKey`. An app saved
   before this with a key and no `account` is kept, with no key it is new.
6. **Export to `.spec.ts` is not built.**

Measured on Harbor Vault (local Anvil, a new account for every test, paid 1 ETH from Anvil's first key; the
seven tests and 50 lines of `fixtures/harbor-vault/tests.json`):

| What | Result | Time | Models |
|---|---|---|---|
| The tests file as it was, no model | 7 Couldn't verify: the setup's recording no longer fits the page, and says it can be repaired | 53 s | $0 |
| Repair, in five goes | the setup and all 7 tests, every line code | about 22 min | $2.22 |
| Run on the fixed app (`?bugs=none`), no model | 7 of 7 Passed | 183 s | $0 |
| Run with the bugs on, no model | 7 of 7 Failed, each on a seeded bug | 460 s (a failure is run twice) | $0 |

What the repairs showed, each fixed in the engine:

- A repair only reaches the lines before the first failing check, so tests repaired on the buggy app kept
  lines that weren't code. Repairing on the fixed app wrote them. An app's owner repairs on a build that works.
- `signed` and `not-signed` read every request since the test began, so "claiming asked for the claim alone"
  failed on a test that deposits first. They take `latest: true` now, and the check writer uses it.
- A figure's label was matched at its first mention on the page, so a sentence that said "vault shares … 5%
  bonus" won over the row named "Vault shares". A line that begins with the label wins now.
- A suite that looked all code, whose setup recording had drifted, was "nothing to repair". The setup is
  always tried now.

Not measured or verified yet:

- pod and Axelar. Their kept tests hold lines that aren't code, so each needs one repair before it runs, on
  the kept account, with the owner's go.
- The worker's repair job against a real database, and `dappdrill repair` end to end (both have unit tests).
- Stage 1's "pod's 10 tests go the same way five runs in a row", and stage 3's side-by-side of model and
  code checks, which the repair replaced: it keeps a check only when code and model agree on the same page.

## Why

We have two clients and local forks fit neither.

- **pod** runs on its own L1, which Anvil can't fork. It already runs in live mode, on one kept account that
  remembers every earlier run.
- **Axelar** needs several chains at once, and its server reads the real chain: balances, receipts and
  allowances come from somewhere our copy never reaches. Every fix so far patched one more server answer.

The engine assumes a world it can copy and put back. Neither app lives in one. So the suggestion is to stop
copying the world, and to give tests a clean start another way: a new account, or a reset.

## What we already have

| Need | Already there | Missing |
|---|---|---|
| Run on the real chain | `ChainConfig.mode: "live"`, `liveKey`, `allowMainnetLive` | It is the exception, not the rule |
| New accounts each run | `freshAccounts()` in `run/env.ts`, only when no key is given | No funds on them, and no choice |
| A kept account | `liveKey`, and the kept login the setup saves | Nothing puts it back before a test |
| Telling this run's entries from old ones | `Test.values` (`{{price}}`), filled into recordings too | Nothing |
| Taking back what a test did | `Test.cleanup` | Runs only after a test stops early |
| Actions done by code | Recordings (`Step`, `Locator`), replayed by `replay/` with no model | A step can't be optional ("confirm if asked") |
| Checks done by code | 9 kinds in `run/code-check.ts`; figures read in `run/figures.ts` | Comparing figures; a row found by its text |
| Signing review | Decode, approvals, source and age, known-bad, UI match | Simulation leans on the fork |

Lines in the 10 tests of pod's tests file (`fixtures/pod/tests.json`) today: 28 code actions, 2 model actions,
19 code checks, 20 model checks. Its cleanups add 3 code actions and 3 model actions. A run costs about $0.33, of which $0.31 is the model answering checks.

## The suggested approach

### 1. One way to run: the app's real environment

Live mode becomes the only mode and forks are deleted. An app is a URL, the chains it uses, and an account.

Out of the engine, about 1,400 lines plus their tests:

- `chain/`: `anvil.ts`, `upstream.ts`, `relayed.ts`, `deal-erc20.ts`, `balance-reads.ts`, and the fork half of `controller.ts`
- `browser/backend-balances.ts`, and the routing in `browser/rpc-route.ts` (what it records for a run stays)
- `run/pin.ts`, the fork parts of `run/env.ts` and `run/suite.ts` (`relays`, pinning, heartbeat)
- `make/funding.ts`, the FORKED prompt sections, fork-blind detection, and the out-of-reach goals added last week
- the fork half of `signing/simulate.ts`
- in core: `mode`, `forkBlock`, `forkable`, `tokens`; in the web app: the fork settings and the fork status colour

Also gone: the archive RPC settings (`DAPPDRILL_RPC_<chainId>`), and Foundry as something the CLI's users must install.

### 2. Accounts: one choice per app

| Choice | What happens | For |
|---|---|---|
| **New account for every test** | A new wallet (and a new inbox address for email logins). If the owner gives a funding key, we send the new account the coin and tokens listed, then do the setup. Tests stand alone and can run side by side. | Testnets, an owner's local chain, any app where sign-up is free |
| **Kept account** | The owner's key or kept login. Before each test we do the app's **reset lines** (for example "cancel every open order, close every position"), recorded like the setup. Tests run one after another. `cleanup` and `values` stay as they are. | pod staging (capped at two users), mainnet apps |

A reset URL (a request we send before each test, for owners who have a reset endpoint) is a small addition to
the second row. It is left out until someone has one.

### 3. Every line of a kept test is code, and a run uses no model

Actions already are. The work is the checks. pod's 20 model checks sort like this:

| What the check says | Count | As code |
|---|---|---|
| Text or a state is shown, or isn't (some inside one row) | 11 | Existing kinds, plus a row found by its text |
| Figures compared (adds up, not more than, within 2%) | 8 | A new `figures` kind on top of `run/figures.ts` |
| What the wallet was asked for | 1 | Existing `signed` and `not-signed` |

The 2 model actions, and the 3 in the cleanups, become recordings once a step can be optional. That is
expected, not yet tried.

Then:

- The draft writes checks as code. A model check is kept only where no code kind can say the claim, and the
  test shows it as one. The aim is none; whether none is reachable is measured in stage 3.
- A run never calls a model. When a recording stops working the line is Couldn't verify ("the page isn't as
  recorded"), not quietly redone another way.
- Repair is its own job, with the code `make/repair.ts` and `make/prove.ts` already have. The web app starts it
  after a run that stopped on an action; the CLI gets `dappdrill repair`. A repaired test replaces the kept
  one only after it goes the same way twice.

What this gives: a run that costs nothing, gives the same result each time, and needs no API key in CI.
What it takes out of `run/`: the model ladder in `action.ts` and, if the count reaches none, `llm-check.ts`.
Making tests still needs the models (`make/` and `agent/`, about 3,500 lines). That part doesn't get smaller.

### 4. Playwright files are an export, not the format

Each line is already one Playwright call that our code makes: a `Locator` is `getByRole`, `getByLabel` or
`getByTestId`, and a check is an `expect`. So `dappdrill export` can write one `.spec.ts` per test, each line
a `test.step` named by its sentence, with the wallet as a fixture. It is one-way and built when a client asks.
The rule that keeps it possible: no line kind that can't be written as Playwright.

Storing model-written `.spec.ts` files as the tests themselves is not suggested, for four reasons:

1. Code written from what a page says would run on our worker. Lines are data; a spec file is a program.
2. The product shows a test as lines with a result each. Sentences would have to be pulled back out of code.
3. Repairing data is replacing one line. Repairing code is editing a file and hoping the rest still holds.
4. It rewrites `run/` and `replay/` (about 2,000 lines that work) and changes nothing for pod or Axelar.

Worth another look if clients want to own and edit the files themselves.

## What it costs

- **Mainnet-only apps, Axelar first.** Without a copy of the chain there are three levels:
  1. A new, empty account: pages, quotes, refusals. Free.
  2. A kept account that holds tokens and may not sign: up to the first wallet request, and a check of what
     was asked. Costs the owner nothing, but can't get past an approval.
  3. Whole flows: on the app's testnet site if it has one, or with real money if the owner chooses.
- **Signing review.** Simulation on a copy goes. What stays is asking the real chain whether the transaction
  would revert, and why. Balance changes we can't confirm are marked unverified, as the rule already says.
- **The owner funds the tests.** We no longer mint tokens. On testnets this is a faucet key.
- **A test can't be put back by the chain.** A reset that misses something leaks into the next test. `values`
  and new accounts are the guard.
- **The seeded-bug numbers for Harbor Vault** have to be measured again. It runs as an owner's local chain with
  a new account per test, funded from Anvil's first key, which makes it the test bed for stage 1.

## Stages

1. **Accounts and reset, on live mode as it is.** The per-app choice, funding from a key, reset lines, optional
   steps. Done when Harbor Vault passes with new accounts, and pod's 10 tests go the same way five runs in a row
   on the kept account.
2. **Delete forks.** Done when the type check and tests pass, Harbor Vault still passes, and the CLI runs on a
   machine without Foundry. `CLAUDE.md` and `simple-tests.md` are brought in line.
3. **Checks as code.** The `figures` kind and rows by text. Convert pod's 20 and Axelar's 4 model checks once,
   run both forms side by side, keep the code form where they agree. Then the draft writes code first.
4. **No model in a run.** Replay only, repair as its own job, `dappdrill repair`.
5. **Export**, when a client asks.

Stage 1 comes before 2 so pod is never without working tests. Stages 3 and 4 don't depend on 1 and 2.

## Open questions

- Does Axelar have a testnet site we may test, or will they fund a kept account that never signs?
- Decided: no model lines in a run. A check that can't be written as code stays "not code yet" and is Couldn't verify.
- What isn't measured: how many of pod's failures while making tests came from the model's answers varying,
  and how many from what the kept account held. Stage 1 fixes only the second, stage 3 only the first.
