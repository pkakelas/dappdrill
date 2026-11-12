# Simple tests: how we would build it

Status: a plan, its decisions and its open questions, written 2026-11-12 from a read of the code at `a92c44f`.
Stages 1 to 3 of the build order are built and measured on Harbor Vault (below). The test maker and the look
(stage 5) are built too and were tried on Harbor Vault and on pod's staging app. The rest is still a plan.

## What is built (2026-11-12)

- The types: `packages/core/src/suite.ts`.
- The runner: `packages/engine/src/run/` (`suite.ts`, `test.ts`, `action.ts`, `code-check.ts`, `llm-check.ts`),
  exported as `runSuite`. It imports nothing from the old test pipeline.
- Two hand-written suites: `fixtures/harbor-vault/tests.json` (seven tests, 50 lines, on a fork) and
  `fixtures/pod/tests.json` (ten tests, 69 lines, on pod's own chain with the one kept account).
- A test can name `values` picked afresh on every run and a `cleanup` done when it stopped half way.
- `pnpm suite <url> <suite.json> [--runs n] [--only text] [--target file]` prints every line's result, time
  and cost. `--target` is a `target.json` that `pnpm drill` kept: its accounts, chains and inbox.
- The test maker: `packages/engine/src/make/` (`draft.ts`, `prove.ts`, `repair.ts`, `maker.ts`), exported as
  `makeTest`. `pnpm make <url> <suite.json> "<goal>"` adds the test to the suite file once it is proven.
- The look: `make/look.ts`, exported as `lookForGoals`. `pnpm look <url> <suite.json>` prints the goals and
  adds its notes to the suite file.
- `Suite.notes`, what the page said (`browser/said.ts`) and, on a line that didn't pass, the page's text
  (`LineResult.page`), all described under "The test maker" below.
- Two suites the maker wrote: `fixtures/harbor-vault/made.json` (six tests) and `fixtures/pod/made.json`
  (five tests). How they came out is under "What making tests showed".

What code can check today: `shows`, `hides`, `said`, `url`, `button` (enabled or disabled), `signed`,
`not-signed`, `mined` (optionally the transaction that holds some text), `changes` (a labelled figure moved
by an amount).

Measured on Harbor Vault, forked, on a laptop:

| Line | Time | Cost |
| --- | --- | --- |
| Action by code (click, type, approve in the wallet) | 0.6 s to type, 2.4 s with one wallet request, 4.3 s with two | none |
| Action by a model (Haiku) | 8 to 12 s | $0.014 |
| Check by code on the page, the wallet or the chain | under 0.1 s | none |
| Check by code on a figure on another page | 0.7 s | none |
| Check by a model (Sonnet) | 2.7 to 4.5 s | $0.02 |
| Around each test (browser, landing, bot check, reading figures, video) | 4 to 6 s | none |

The same deposit takes 21 s with code actions and 45 s with model actions. The whole suite takes about 155 s
and $0.24. With every seeded bug off it passed 7 of 7 in each of four runs. With one bug on at a time (1, 2,
3, 8) the tests that touch it failed and the others passed. Bugs 4, 5, 6, 7 and 9 need conditions (wrong
network, a second account, low gas, a slow RPC, two wallets), which the new runner doesn't have yet.

Not built: conditions, `needs`, the heavier code checks (an amount by the token's decimals, a balance against
the chain, prices), a maker for the setup, and moving the worker, the web app and the CLI over. Until those
move, the old pipeline stays.

## The shape

A test is a flat list of actions and checks. Each says who does it.

```ts
type Suite = {
  setup?: { startPath: string; steps: Action[] }   // once, in its own browser: connect, get funds
  tests: Test[]
}

type Test = {
  id: string
  name: string
  goal: string                    // for people and the models; nothing is judged against it
  startPath: string
  steps: (Action | Check)[]
}

type Action = CodeAction | LlmAction
type CodeAction = { type: "action"; by: "code"; do: string; run: BrowserAction[] }
type LlmAction  = { type: "action"; by: "llm";  do: string }

type Check = CodeCheck | LlmCheck
type CodeCheck = { type: "check"; by: "code"; claim: string; expect: CodeAssert }
type LlmCheck  = { type: "check"; by: "llm";  claim: string }

type Outcome = "passed" | "failed" | "unverified"   // Passed, Failed, Couldn't verify
```

These are in `packages/core/src/suite.ts`. The outcome is called `Outcome` because core already has a
`Verdict` (the signing review's). A test also has `values` (numbers picked afresh on every run and written
`{{name}}` anywhere in it) and `cleanup` (actions done when the test stopped before its last action, so an
account that isn't reset gets back what the test left on it).

- A `CodeAction` is replayed by Playwright with no model. Its `do` text stays, so a person can
  read it and a model can redo it when the recording stops working.
- An `LlmAction` is for what differs on every run. Haiku does it, Sonnet when Haiku can't.
- A `CodeCheck` is a fact: text on the page, a button, a number that moved, a signature, a mined transaction.
- An `LlmCheck` is meaning. Sonnet answers yes, no or can't tell, and it never saw the actions being done.
- The suite's setup exists because a check on how far a figure moved reads it before the test's first
  action, and in a fresh browser the wallet isn't connected, so the figure isn't on the page yet. The
  setup runs once, its browser storage and wallet connection are saved, and every test starts from them.
  Forks are put back to that point after every test.

Outcome: Passed when every line passed. Failed when a check failed or the app would not let an
action be done. Couldn't verify when a check answered "can't tell", an action couldn't be done for a
reason that isn't the app's, or a line wasn't reached. Once a line hasn't passed, no further action
is done; the checks up to the next action still say what they find.

## What the code already has

Most of the runner exists under other names.

| Needed | Today | Where |
|---|---|---|
| Replay first, model when it breaks | `runStep`: recorded actions, then the fast model, then the acting model | `packages/engine/src/agent/tester.ts:64` |
| Guards on re-recording | A new path that skips a named action, or signs where the old one didn't, doesn't replace the recording | `packages/engine/src/pipeline/steps.ts:104` |
| Code checks after a step | `runChecks` / `evaluateCheck`, 11 kinds | `packages/engine/src/explore/checks.ts:24` |
| Read a figure by its label | `labelled(pageText, label)` | `packages/engine/src/explore/display.ts:104` |
| A read before the first step | `readBaseline`, live chains only, a prose note of up to 300 characters | `packages/engine/src/agent/tester.ts:237` |
| A model deciding a result | `judgeExpected`, ok or not, on the whole expected sentence | `packages/engine/src/agent/tester.ts:246` |
| Undo steps on a live account | `spec.after` | `packages/engine/src/pipeline/tests.ts:253` |
| A kept account | `liveKey`; the harness has `--keep-wallet`. Without a key, new accounts every run | `packages/engine/src/pipeline/env.ts:201` |
| Values in recordings | `{{amount}}`, `{{account}}` in fills, URLs and expected text | `packages/engine/src/replay/replay.ts:209` |
| "Not the app's fault" | `blame: ours / input / base`, `stuck`, unpaid wallet, backends that can't see the fork | `packages/core/src/test.ts:181` |
| Models per role | `DAPPDRILL_FAST_MODEL`, `DAPPDRILL_ACT_MODEL` | `packages/engine/src/agent/llm.ts:28` |

Three things are tangled today and become one thing each:

- Two things are called a step: `TestStep` (a line of the test) and `Step` (one recorded click).
  The second becomes `BrowserAction`.
- Three ways to assert: an `expect` kind inside recordings, `WalletExpectation` on wallet
  actions, and `CheckAssert`. They become `Check`.
- `expected` plus the end-of-run judge becomes a `ModelCheck` like any other.

## What the measurements say

Pod, 4 runs of 8 tests, 2026-11-10 (`bench/results/2026-11-10/repeat-staging-app.podtestnet.dev/report.md`):

- 30 of 32 passed. Both failures were ours:
  - A step fell back to the model, which typed 1,000,000 where the step said 300,000, and the
    app answered with a different message than the test expected.
  - The judge wasn't sure a list was fresh, and said no.
- A run cost $0.85 to $2.38 and took 8 to 10 minutes. The setup with its reset took 111 to 187
  seconds of that.
- Per run, a test that replayed fully cost about $0.03 to $0.06 (the read before and the judge).
  The one that fell back most cost about $0.68. The per-test figures in the report are totals
  over four runs.

Harbor Vault has nine seeded bugs. Three are caught by the signing review (1, 2, 8) and six by
conditions (reject, wrong network, account switch, low gas, slow RPC, two wallets). None is
caught by a plain happy-path check. So conditions and the signing review are what the fixture
measures, and both have to work on the new runner before the old one goes.

## Tests written by hand

These are the tests we write before any explorer, so the explorer has a target. Written here as
a sketch; labels marked `?` have to be read off the app first. `A` is an action, `C` a check.

### Harbor Vault (a fork, so a clean account on every run)

```
Deposit 100 hUSDC                                   start /
A code   Connect the wallet
A code   Click Get test hUSDC, approve in the wallet
C code   mined
A code   Enter 100 as the deposit amount
A code   Click Approve 100 hUSDC, approve in the wallet
C code   signed: an approval of 100 hUSDC to the vault        <- bug 1 (asks for unlimited)
A code   Click Deposit, approve in the wallet
C code   mined
C code   changes: "Your deposit"? by +100
C code   changes: "Wallet balance"? by -100
```

```
Deposit, rejected in the wallet                     start /
A code   (as above, up to Deposit)
A code   Click Deposit, reject in the wallet
C code   nothing was mined
C code   button "Deposit" is enabled                          <- bug 3 (stays on Confirming…)
C model  The page says the request was rejected and can be tried again
```

```
Claim rewards                                       start /
A code   Connect the wallet
A code   Click Claim rewards, approve what the wallet asks
C code   signed: nothing gives an allowance to an address other than the vault or the distributor   <- bug 2
```

```
Sign in                                             start /
A code   Click Sign in, approve in the wallet
C code   signed: a message, not a Permit                      <- bug 8
```

Bugs 4, 5, 6, 7 and 9 need the wallet or the network put in a state first (wrong chain, a second
account, no gas, a slow RPC, two wallets). See question 10.

### Pod (a live chain, one kept account)

Built and run: `fixtures/pod/tests.json`. The setup signs in with the wallet (3 s) and every test starts
from there. Nothing is reset between tests or runs; a test tells its own order from older ones by a price
picked for the run.

| Test | Lines | By code | By a model | One pass |
| --- | --- | --- | --- | --- |
| Withdrawing more than the account holds is refused | 6 | 5 | 1 check | 10 s |
| Rejecting “Enable trading” in the wallet leaves trading off | 8 | 7 | 1 check | 14 s |
| An order over the leverage limit is blocked | 5 | 4 | 1 check | 13 to 15 s |
| Home's figures agree with each other | 3 | 0 | 3 checks | 15 s |
| Place a resting limit order and cancel it | 11 | 6 | 4 checks, 1 action | 51 s |
| Home's Orders keeps up without a reload | 7 | 6 | 1 check | 25 s |
| Withdraw to the connected wallet | 8 | 6 | 2 checks | 23 s |
| Rejecting a deposit in the wallet queues nothing | 8 | 5 | 3 checks | 25 s |
| Open a market long on AAPL and close it | 10 | 6 | 3 checks, 1 action | 50 s |
| The tests left nothing on the account | 3 | 2 | 1 check | 9 s |

The whole suite took 277, 312 and 338 s in its last three runs, for $0.55 to $0.80. Nine of ten passed in the
last one; the tenth fails on the app (below). A line on pod:

| Line | Time | Cost |
| --- | --- | --- |
| Action by code: type or click | 0.6 to 1.4 s | none |
| Action by code with a wallet signature | 2.3 s | none |
| Action by code with a wallet transaction, or placing an order | 2.9 to 3.5 s | none |
| Action by code that reloads a page | 2.4 to 3.0 s | none |
| Action by a model (Haiku: cancel the order at a price, close a position) | 13 to 18 s | $0.02 |
| Check by code | under 0.1 s; up to 5 s when it waits for a list; 1.9 s for a figure on another page | none |
| Check by a model (Sonnet) | 2.7 to 5.9 s | $0.02 to $0.03 |
| Around each test | 5 to 9 s | none |

What the tests found on pod:

- **The order lists are behind.** The app asks its server for the orders at gaps that double after each
  page load (1, 2, 3, 5, 9, 17, 33 s) and doesn't ask again after placing or cancelling. A cancelled order
  keeps reading Open, with its Cancel button, after the page said “confirmed”; a new order can be missing
  from Home's Orders for half a minute. “Home's Orders keeps up without a reload” fails on this every
  time the cancel is a click. It passed when a model did the cancel, only because the model took 15 s.
- **A market order expired once** in six runs, at a limit 1.7% above the estimate. The run after it filled.

What they showed about the runner:

- **A notice that is on the page for three seconds can't be a model's check.** Whether it is still there
  depends on how long the lines before took, so the check flips between runs. Read it with a code check
  straight after a code action. Better: the runner keeps what the page said while an action ran, and
  checks read from that. Not built.
- **A rerun that passes hides this.** Three tests failed first and passed when run again, and counted as
  Passed. Each was a check of ours reading a notice too late. The first reason is now kept on the result.
- **A list beside the form is not this order's news.** A check that read “no order expired” failed on the
  row of the run before. Claims name the run's own price or amount, or read after a reload.
- **“None are open” can't be read off a paged list.** The check reads the filter's own count instead.
- **A button named with a count (“All 214”) is a new button on the next run.** Code then failed and a model
  took 56 s to do the click. The recorded name has to leave the count out.
- **One model check cost $0.26 instead of $0.03**, once. The cost of a line is not steady through the Claude login.
- **Typing can change the words that found the field.** The price box is found by its “Est.” badge, which
  turns to “Limit” on the first key. The fill now holds the field itself. This was a 30 s stall.
- **A probe written as a test costs like one.** Asking a model to look around through an action line cost
  $0.73 once, because a failed line is rerun. Looking around belongs to the explorer.

What each full run leaves: about $20 less cash (the withdrawal) and nothing else.

### What writing them showed

New check kinds: `changes` (a figure moved by an amount, with a wait), `row` (the line holding a
value also shows a word), `button` (enabled or disabled). `signed` needs to say what must not be
there, not only what must.

New parts of a test: `needs` (what must be true before, else Couldn't verify) and values unique
to a run. Values are built, and so is a cleanup for a test that stopped half way; `needs` and `row` are not.

## The test maker (design, 2026-11-12)

One thing writes tests: the **maker**. A goal goes in ("place a limit buy and cancel it"), a proven test
comes out. There is no explorer beside it and no writer after it. Two small things stand around it: the
app's **notes**, and a **look** that only lists goals.

### Notes

`Suite.notes` is what is known about the app that a doer needs and the page doesn't say: "after a full
reload trading has to be enabled again", "never approve a deposit". Each note is a sentence and says where
it came from: the owner, the look, or the maker. Doers read them (the maker's walker, a model doing an
action). Judges never do: a check is decided from the page and the wallet alone. Nothing about one app
lives in the engine; what we know about pod is in pod's suite file.

### What the page said

A notice that shows for three seconds is gone before a check looks. The session now keeps every line of
text the page showed and when (`browser/said.ts`: an observer in the page, lines sent to node as they
appear, `alert()` texts too). Two readers:

- a code check `said {text}`: the text is on the page now, or the page showed it since the latest action began;
- a model's check gets the lines the page showed during the latest action and has since removed.

`shows` keeps meaning "on the page now". A state that flashed and was taken back must not pass a `shows`.

### Draft, prove, repair

A test is its sentences. Recordings are a cache the runner fills in.

1. **Draft.** A walker (the fast model, browser tools, the notes) does the goal once to learn the app,
   then writes only sentences: name, start page, values, the lines, the cleanup, what it learned (notes)
   and what looked wrong. For each action it says whether the same clicks work on every run (code) or it
   takes reading the page each time (model). Checks are a model's unless code can read the fact exactly:
   the wallet, the chain, a figure that moves by an amount, a fixed text, a notice. A check says what a
   user is entitled to expect, not what happened to show. On a live chain the test ends with the account
   as it found it.
2. **Prove.** The runner runs the test, one run at a time, no second chances. A code action with no
   recording is done by a model from its sentence and the runner hands back what it did
   (`LineResult.recorded`); `withRecordings` writes that into the test with the run's values put back as
   `{{names}}`. So the first run also proves a model can do every action from its sentence alone, which
   is what happens whenever a recording breaks. **Proven** means two runs in a row of the very same test
   went the same way with nothing redone.
3. **Repair.** When a line doesn't pass, or passes in one run and not the next, a model reads the run and
   says which it is: the test is wrong (it rewords, drops or adds lines), the app is wrong (the line
   stays, a finding is written, and a way round may go into the notes and the test), or it can't tell
   (run again). Every repair is in the maker's report. It reads the page at that line as text and as a
   picture, how every run of this wording went, and what was already found and changed.

Every line of a run that went another way than expected is decided from that one run, the first one
first. A check that fails behind a line already left to fail gets its own verdict: it may be the same
fault, and then it stands too, or it may be wrong by itself, and then it is put right. The checks after
an action the app wouldn't take are not asked about: they have nothing to look at. A line nobody can
decide twice is taken out when it is a check; when it is an action the making ends.

The aim is a **stable** test, not a green one. A test that fails the same way twice because the app
doesn't do what the goal asks is kept as it is: that is a bug found. What the maker may never do is make
a check pass by weakening it without saying so.

Limits: seven runs and four changes to the test. Running again to find out, and leaving a line to fail,
are not changes; the seven runs limit those. A recording that had to be made three times is given up and
the action stays a model's. A recording that lost one of the run's values is not kept. Cleanup lines are
always a model's. Out of budget, the test comes back unproven with the reason and isn't added to the
suite.

Nothing the maker does may sign on a live mainnet, whatever the app allows: it is off the written steps.

### The look

App in, a list of goals out (and a few notes). It reads pages and clicks around but signs nothing: every
wallet request is refused, so it fills a form to see what it asks and stops there. Each goal is a sentence
for the maker that says who the user is, what they do and how it ends, most important first: what the app
is for, the way back out of each, what the app must refuse, what a user is told when they say no in the
wallet. It starts as the set-up user, is told which pages the app links to, and is sent back once when it
hands in with a linked page unopened. It is the one place the thinking model is used. At most twelve goals,
leaving out what the suite's tests already cover.

### Pieces

- core `suite.ts`: `Suite.notes`, `said`, `CodeAction.run` may be empty (not recorded yet),
  `LineResult.recorded`, `withRecordings`.
- engine `browser/said.ts`; `run/` gives notes to doers and takes a wallet refusal; `openSuite` shares the
  setup and the fresh-state run between `runSuite` and the maker.
- engine `make/`: `draft.ts` (the walker and what it writes), `prove.ts` (the loop, with the runner and the
  repairer passed in, so it is tested with scripted runs), `repair.ts`, `maker.ts` (ties them to a suite),
  `look.ts`.
- `pnpm make <url> <suite.json> "<goal>"` writes the test and the new notes into the suite file and prints
  the report. `pnpm look <url> <suite.json>` prints goals.

### What making tests showed

Tried 2026-11-12 on a laptop, with the fast model drafting and repairing and the thinking model looking.

**Harbor Vault, every seeded bug off.** Six goals, six tests proven passing, 59 lines between them: 23
actions by code, 19 checks by code, 17 checks by a model (`fixtures/harbor-vault/made.json`).

| Goal | Proven after | Time | Cost |
| --- | --- | --- | --- |
| Deposit 100 hUSDC | 3 runs | 122 s | $0.54 |
| Reject the deposit in the wallet, then do it | 3 runs | 174 s | $0.71 |
| Deposit 100, take 40 back | 3 runs | 182 s | $0.61 |
| Claim rewards | 4 runs, one repair | 182 s | $0.65 |
| Sign in with the wallet | 3 runs | 87 s | $0.46 |
| Revoke the vault's approval | 3 runs | 133 s | $0.49 |

A draft costs $0.33 to $0.38. The first run takes 30 to 74 s because a model does every action and is
recorded; the runs after it take 13 to 27 s. The one repair replaced a model's check that compared the
rewards before and after, which nothing on the page could answer, with a check by code.

The six run as a suite in 123 s for $0.33 and all pass. With every seeded bug on, all six fail, each on a
bug it should meet: the unlimited approval (deposit, withdraw, revoke), the button stuck on "Confirming…"
after a rejection, claim sending an approval, sign-in asking for a Permit. Made with the bugs on, the
deposit test comes out proven failing on the unlimited approval (101 s, $0.43).

**The look.** Harbor Vault: 11 goals in 60 s for $0.87. Pod: 11 goals and four notes in 96 s for $1.17,
with nothing signed. The notes were the kind a test writer needs: where Close is hidden, that typing a
price makes a limit order, that the first order asks for a one-time signature.

**Pod staging, one kept account on its own chain.** Five tests proven (`fixtures/pod/made.json`), made one
at a time from the look's goals.

| Goal | Came out | Lines | Time | Cost |
| --- | --- | --- | --- | --- |
| A $50 limit Long on Apple rests open, then is cancelled | Passes, 4 runs, one repair | 12 | 362 s | $1.25 |
| A $50 market Long on Apple at 5×, then closed | Fails on a fault of the app, 5 runs, one repair | 17 | 540 s | $1.33 |
| A Long far past the leverage limit is refused | Passes | 7 | 147 s | $0.56 |
| Rejecting "Enable trading" in the wallet | Passes, one repair | 4 | 135 s | $0.61 |
| Withdrawing more than the balance is refused | Passes | 6 | 101 s | $0.38 |

Run as a suite, the five take 243 s and $0.53: four pass and the market Long fails, twice, on the same
check. A code action takes 0.6 to 3.9 s there, a model's check 2.7 to 5.9 s and about $0.03, the one
action left to a model (cancelling the newest order) 13 s.

What it found on pod, for pod to confirm:

- **A position opened at 5× shows about 20× on Home.** Leverage reads 19.98× and margin used is about
  $2.45 for a position of about $48.90. The test fails on it in every run, so it is a proven finding.
  The test was made twice from scratch (882 s and $2.54 the first time, before the changes below) and
  both drafts came to the same finding. The lines after the failing check (closing the position) have
  never run, so they have no recording yet; the cleanup closes the position on every run.
- One market order in the second making came back Expired instead of Filled. The repairer said it
  couldn't tell from one run, the next run filled, and nothing was filed.
- **The Orders list is stale after an order is placed or cancelled**, until the page is reloaded. The
  limit-order test goes round it with a reload and reports it; it has no failing test of its own.
- A $50 market order filled for about $48.90. Reported, not proven.

After the batch the hand-written "the tests left nothing on the account" test passed: no Apple position
and no open orders. Two of the look's goals were left out on purpose: rejecting a deposit (an approval
there reaches a real testnet) and a real withdrawal.

**app.pod.network, pod's production site, an app the engine had not seen.** Its public page is a list of
markets and a waitlist; the app itself is behind a login that makes a real account, so the suite has
`signing: "refused"` and an owner's note not to log in (`fixtures/pod/production.json`). The look gave four
goals in 48 s for $0.75. The maker proved all four as passing, 31 lines, in 77 to 152 s and $0.42 to $0.72
each, with one repair: a model doing "click Login" had also closed the dialog, and its recording kept both
clicks. As a suite the four run in 69 s for $0.09. Nothing was typed into the login and the wallet was
never asked.

Behind the login (`fixtures/pod/production-member.json`, `signing: "setup"`): the owner started the first
sign-in by hand, since it makes an account on a live site. A model signs in with the kept wallet in 20 s
for $0.02 on every run. There is no gate and no second page: Deposit, Join the Waitlist and every market
card open one dialog, a deposit of USDC on Arbitrum with a 10 USDC minimum. With an empty wallet the look
gave four goals in 72 s for $0.72; a second look that assumed funds gave seven. The maker proved all four
as passing, 34 lines, in 104 to 243 s and $0.40 to $0.86 each, with one repair. As a suite they pass in
about 103 s for $0.06, and the only thing approved in the wallet is the sign-in. What it showed:

- The maker crashed on any setup that approves in the wallet: its mainnet rule read the open suite before
  there was one. `openSuite` now hands the rule the env.
- A check that said the dialog was "the same as the one before" passed three proving runs and came back
  Couldn't verify in the suite: whoever decides a check doesn't see earlier pages. The drafter is now told
  never to write one, and the line was reworded by hand.
- The maker wrote two notes it had been given. They were removed by hand; the rule is in its prompt already.
- `pnpm make` writes the suite file from the copy it read at the start, so a look or a make that runs
  beside it loses its notes.
- With an empty wallet the dialog says "Insufficient balance. You need at least 10 USDC." for 5 and for
  150 alike, so the test of the minimum can't tell the two apart. The minimum, over-balance, MAX and reject
  goals need USDC on the fork; the deposit and the withdraw need an approval, which stays refused here.

**app.axelar.network, from the URL alone (`pnpm tests`, `fixtures/axelar/tests.json`).** One command: the
look, a test for each goal, one run of them all. The suite file didn't exist, so it began with a setup of one
sentence, connect the wallet. The look is now told that a goal ends with something changed for the user or
with a refusal that protects them, that a dialog opening or a filter filtering is a line inside such a test,
and to give about ten when the app has that much. It gave eight in 116 s for $0.92: bridge ETH to USDC on
Base, to ETH on Arbitrum, to another recipient, to XRP Ledger, a malformed recipient, more than the balance,
a rejection in the wallet, Max. Seven were proven in 122 to 350 s and $0.45 to $0.80 each, six with no
repair, 62 lines. The XRP Ledger one was given up: no address the app would take. The run: six Passed, one
Failed, 240 s, $0.33. All of it: 32 minutes, $5.71. What it showed:

- Max puts the whole ETH balance in the amount, so the test fails on "leaves ETH for gas". The page then says
  "Quote unavailable", but the fork wallet holds 100 ETH and the quote may be refused for its size, so what
  follows the full balance is not shown.
- Seen, with no test failing on it: Swap history rounds the received amount down (0.009 against a quote of 0.009962).
- No goal used the wallet's 100 USDC, the one route with an approval first.
- A fresh browser shows "No swaps yet" after the same wallet bridged on the fork, so the history is kept in the browser.
- The setup stays a sentence a model does on every run (14 s, $0.02). Every action in the tests replays by code; of the $0.33 a run costs, $0.31 is checks by a model.

What the trials changed in the maker, none of it about pod:

- The first limit-order try wasn't proven after five runs. Its price was fixed, so this run's order
  couldn't be told from the cancelled orders of earlier runs. The draft now turns a figure the goal names
  into a range picked on every run when the account keeps its history.
- The repairer only had a picture of what was in view. A line that doesn't pass now keeps the page's text
  (`LineResult.page`) and the repairer reads it.
- "Can't tell, run again" used up repairs. Only changes to the test count now.
- In the market-order test two checks kept failing behind the line left to fail and nobody looked at
  them. Every failing line of a run is decided now (see Repair above).
- A recording that had to be made again in a run doesn't count that run toward proven, even when the
  clicks came out the same.

What is still weak:

- A finding the test goes round, or one seen in passing, has no failing test. It could be handed back to
  the maker as a goal of its own.
- The maker's notes on Harbor Vault said little a page doesn't say. The rule was tightened ("most tests
  add none"); nothing prunes notes yet.
- The drafter sometimes checks a notice with `shows` when it is gone a moment later. The repairer is now
  told to make it `said` instead of removing the check.
- A test on a live chain costs two to five times a forked one to make: the runs are slower, the account
  has history, the app's lists lag.
- The setup still has to be written by hand.

## Build order

0. **Try Haiku on what we have.** Setting `DAPPDRILL_FAST_MODEL=claude-haiku-5-5` and
   `DAPPDRILL_ACT_MODEL=claude-sonnet-5-5` needs no code. One pod run and one Harbor Vault run
   answer whether Haiku can do the steps at all. Costs money and uses pod's kept account.
1. **Types and hand-written suites.** The new types in core with zod, a converter from today's
   tests, and the suites above as files. Done when the suites parse.
2. **The runner.** Walk the list: replay or model for actions, code or model for checks, the
   read before for `changes`, values, the verdict. Reuses `runStep`, `replayScript`,
   `evaluateCheck` and the judge. `pnpm drill run` takes a suite file.
3. **Measure.** Harbor Vault: every test passes on `?bugs=none`, and with each bug on, the right
   test fails. Pod: ten runs through `bench/src/repeat.ts`, no wrong Failed.
4. **Conditions on the new runner.** Reject and wrong network first.
5. **The maker and the look.** Built (see "The test maker"). Their target was the hand-written
   suites: on Harbor Vault and on pod they come back with tests that do the same job.
6. **Worker, database, web, CLI.** Switch them over, then delete the old pass, the Bugs and
   Checks tabs, the second look and the assistant.

Stages 1 to 3 touch the engine and core only. Nothing a user sees changes until stage 6.

## Decisions (2026-11-12)

The first is the owner's. The rest were left to the plan and can be changed.

1. **The writer decides code or model, and leans to the model.** Code is only for the trivial:
   - Actions: one click, fill or select on a control with a stable name, opening a page,
     approving or rejecting in the wallet.
   - Checks: exact text shows or is gone, the address, what was signed, mined or not, a button
     enabled or disabled, a figure changed by an amount.
   - Everything else is an `LLMAction` or a `ModelCheck`.
   - The maker says which lines are code. A code action starts with no recording: the first run
     has a model do it from its sentence and keeps what it did. A test a person types starts as
     model lines.
   - The samples above were written before this and mark more lines as code than the writer would.
   - To watch in stage 3: both pod flips came from model-run parts, so the share of model lines
     is what moves cost, time and wrong results.
2. **A step that only sometimes applies is an `LLMAction`.** "Enable trading and sign, if the
   page asks." No optional flag on a test's lines.
3. **A value unique to the run is declared on the test** as a range and a count of decimals
   (`values: { price: { from: 150, to: 180, decimals: 2 } }`). The runner picks one and fills
   `{{price}}` wherever it appears. The writer sets the range from what the explorer saw. A
   range can go stale when a market moves; that is accepted for now.
4. **A figure on another page:** a `changes` check may say where the figure is
   (`on: "/home"`). The runner opens that page and reads it before the first action. No "read"
   line.
5. **Conditions** (a test run with something made to go wrong on purpose) need no machinery of
   their own:
   - What the user does wrong is an action: reject in the wallet, switch account.
   - What is wrong from the start is one field on the test, `under`: wrong network, no gas, a
     slow RPC, two wallets installed.
   - What the app should do then is written as ordinary checks (the button is enabled again,
     the page says it was rejected, the wallet was asked once).
   - These six come first because Harbor Vault's bugs need them. The other seven wait.
6. **Where the suites live:** Harbor Vault's in `fixtures/harbor-vault/tests.json`, committed.
   Pod's under `.drill/`, not committed. Harbor Vault gets one test per seeded bug plus deposit
   and withdraw; pod gets its eight saved tests rewritten.
7. **`expected` goes.** On conversion it becomes one `ModelCheck` at the end.
8. **An uncaught page error fails any test** without being written as a line.
9. **A Dangerous signature fails the test.** "Check this" is shown and changes nothing.
10. **The ladder is Haiku, then Sonnet.** No third model. When a model redoes a code action,
    the report says so.
11. **One plain rerun before Failed** replaces the second look. Failed means it failed twice.
12. **When our side breaks:** one quiet retry, then Couldn't verify.
13. **We make and keep one account per app on a live chain.** Getting funds is part of the
    app's setup. Runs on one app go one at a time.
14. **The reset steps go.** A test undoes only what it did.

The test type with these in:

```ts
type Test = {
  id: string
  name: string
  goal: string
  startPath: string
  under?: "wrong-network" | "low-gas" | "slow-rpc" | "two-wallets"
  values?: Record<string, { from: number; to: number; decimals: number }>
  steps: (Action | Check)[]
  cleanup?: Action[]
}
```

## Open questions

Questions 1 to 4, 9 to 15, 19, 20, 21, 27 and 29 to 31 are answered under Decisions; they stay
here for the reasoning. The others are open. Marked **[1]** when stage 1 or 2 couldn't start
without an answer. A line starting "Lean:" is what I would do, not something decided.

### The test format

1. **[1] An action nobody has recorded yet.** A test a person types has no recording. Is it a
   `CodeAction` with an empty `run` that the first run fills in, or an `LLMAction` that gets
   promoted? Lean: `run` may be empty; `LLMAction` means "never record".
2. **[1] Steps that only sometimes apply.** "Enable trading, if the page asks." Recorded actions
   have an `optional` flag today. Is that enough, or is every such step an `LLMAction`?
3. **[1] Values unique to a run.** Who says what a valid value is (a price needs the market's
   tick size and has to stay far from the market)? Lean: the test declares a range and a step,
   and the runner picks within it.
4. **[1] A figure on another page.** `changes: "Cash"` needs Cash read before the first action,
   but Cash is on Home and the test may start on Trade. Either the runner visits a page first,
   or the test gets an explicit "read" line after all. I said earlier there would be no third
   kind of line; writing the pod tests suggests there may have to be.
5. **A figure inside a table row.** `labelled` reads the first number after a label. A position
   size in the "Apple" row, third column, needs more than that.
6. **How long a check waits.** Cash falls some seconds after a withdrawal; an order's status
   changes after a reload. One default, or a wait per check?
7. **How close is close enough.** Fees, rounding, and figures that move with the market. Today:
   1% in the judge's prompt, 0.5% in adds-up, 5% for amounts, 3% for prices.
8. **`needs`.** How a test states what must be true first, who checks it (code by label, or a
   model), and whether a failed need can trigger a fix ("mint when cash is short").
9. **Does `expected` stay?** Lean: no. On conversion it becomes one `ModelCheck` at the end, so
   old tests keep behaving as they do now.
10. **[1] Conditions.** Is "rejected in the wallet" a plain test whose wallet action says
    reject? What about the ones that set up the network or the wallet first (wrong network, slow
    RPC, low gas, account switch, two wallets)? Today they are 13 conditions in a 928-line file
    with their own built-in checks (stuck button, blank page, double submit). Six of Harbor
    Vault's nine bugs are found there.
11. **Checks that always run.** An uncaught page error, or NaN on the page: implicit on every
    test, or written as lines?
12. **A Dangerous signature.** Today it sends an alert and does not change a test's result.
    Should it fail the test? And what does "Check this" do? The review gets no model during runs.

### The runner

13. **The ladder.** Replay, then Haiku, then Sonnet. Does Opus stay as a last step? When a model
    redoes a recorded action, does the report say "the app changed here"?
14. **A wrong Failed.** The second look (a model retrying in a fresh browser) goes. Is one plain
    rerun of a failed test enough to replace it, or nothing at all? What rate of wrong Failed is
    acceptable?
15. **When our side breaks.** Today: one quiet retry, then the run "says nothing". With three
    verdicts, is that Couldn't verify?
16. **What a model check sees.** The page text, a screenshot, what the wallet sent? The judge
    gets all three today plus the steps.
17. **Haiku on real pages.** Not measured. Stage 0 answers it.
18. **Haiku through the Claude login.** Local runs use the Agent SDK with the Claude Code login,
    not an API key. Not checked that Haiku runs that way.

### One kept account on a live chain

19. **Whose key.** Do we make and store one account per app, or does the owner give a funded
    key? How does a new account get gas the first time?
20. **The reset steps.** Pod's setup cancels every order and closes every position, which is two
    to three minutes of each run. With tests that judge changes it can go. Does anything still
    need it (a cap on open orders, margin held by old orders)?
21. **Tests getting in each other's way.** One account, so a test that closes "all" closes
    another test's position, and resting orders hold margin. Do tests only ever undo their own
    work, and does order matter?
22. **Cleanup that fails.** Leftovers pile up over weeks. Is there a tidy-up now and then?
23. **The faucet.** Mint only when cash is short. Where does that rule live?
24. **Apps that sign for the user.** Pod's orders are signed by a key the page makes, so our
    wallet never sees them and `signed` and `mined` have nothing to look at. Only the page can
    be checked there.
25. **Deposits on pod** go to real Arbitrum Sepolia and need real testnet funds. In or out?
26. **Thin order books.** Far-from-market limit orders are safe. Market orders may never fill.
    Is "Couldn't verify: nothing to trade against" acceptable for a client?
27. **Two runs at once.** A scheduled run and a manual one on the same account. A lock per app?
28. **What a kept account can't test.** First-time flows and empty states. Accept, or keep a
    way to run those on a new account now and then?

### The hand-written tests

29. **[1] Where they live.** `.drill/` is ignored by git, and main just removed the pod results
    from the repo. Lean: Harbor Vault's suite is committed; pod's stays out of the repo.
30. **[1] Which tests.** Lean: Harbor Vault, one test per seeded bug plus deposit and withdraw;
    pod, the eight saved ones rewritten.
31. **What "good" is.** Lean: the bar in stage 3.
32. **Harbor Vault's labels.** I have not read the fixture's pages; the labels above are guesses.

### The maker and the look

33. **What the explorer hands over.** Answered: there is no explorer. The look hands over goals
    and notes; the maker does each goal itself and learns what it needs on the way.
34. **How we compare** made tests with the hand-written ones. Answered for Harbor Vault: by
    whether they catch the same seeded bugs. They do, for the four bugs that need no condition.
35. **Coverage and time.** "Every page and every action that signs or moves funds" with a cap.
    What the cap is, and how "not covered" is shown.
36. **A test a person adds.** The dialog asks what the user does and how you know it worked.
    The second answer becomes a `ModelCheck`. Does the writer later turn it into code checks?
37. **Editing.** What a person can change in the UI: the `do` text (which drops the recording),
    checks in plain words, values.
46. **A finding with no failing test.** One the test went round, or one seen in passing. Lean:
    hand it back to the maker as a goal, so every reported fault has a test that fails on it.
47. **A maker for the setup.** Signing in and getting funds are still written by hand.
48. **Recordings made again in an ordinary run.** The maker keeps them; `runSuite` hands them
    back and nobody saves them yet. Lean: the worker saves them when the test passed.
49. **Failed, then passed on the rerun.** Shown as Passed today. Lean: say "on the second try".
50. **What an owner forbids.** Partly answered: `Suite.signing: "refused"` lets nothing be
    approved in the wallet for an app, by a model or by a recording (rejecting still works). It
    is for a production app, or one that makes an account of whoever signs in. `"setup"` lets
    the setup sign in and refuses everything in a test, for an account we were told to make
    there (`fixtures/pod/production-member.json`, not run yet). The mainnet
    refusal only knows the chain IDs in our list, so an app's own mainnet needs this rule.
    Still a note only: forbidding one kind of request ("never approve a deposit"), and typing
    into a form (an email into a sign-up).
51. **Notes that go stale or say nothing.** Who removes them, and when.
52. **A finding only the app's owner can confirm** (a leverage figure, a fill price). The test
    is kept failing; the report should say what to ask them.

### Moving over

38. **Stored tests.** The `tests` table, app setups, `.drill/`, and tests files committed in
    users' repos by the CLI. A converter covers them; does the CLI file need a version?
39. **Old explorations and runs.** Six explorations. Drop them, or keep them readable?
40. **The fake engine** (771 lines, for UI work) has to speak the new shape.
41. **The repeat benchmark** reads today's result type and has to follow.
42. **This branch is two commits behind main.**
43. **Engine edits restart the dev worker** and end a running pass.

### Product

44. **Words.** The CLI says "Couldn't run" today; emails say "regression". All move to the
    three verdicts?
45. **What a run costs** in the new shape is unknown until stage 3.
