/**
 * The canned pass over the fake vault: a look that suggests tests, explorers that try them and
 * find more, proofs and bug reviews that land while they work, and one of every ending: saved,
 * draft, bug, left out.
 */
import { CONDITIONS, newId, nowIso, type AppSetup, type ExploreBug, type ExploreCheck, type ExploreFeature, type ExploreSuggestion, type ExploreVariation, type TestDraft } from "@dappdrill/core";
import { Board } from "../explore/board.js";
import { beat, chainsOf, frame, isAbort, png, type Engine } from "./index.js";

const MAP = {
  summary: "Harbor is a USDC vault on Base. Users connect a wallet, deposit USDC to earn rewards, withdraw, and claim rewards.",
  pages: [
    { path: "/", purpose: "Landing page with a Launch app button" },
    { path: "/vault", purpose: "Deposit, withdraw and claim; needs a connected wallet" },
  ],
};

const SETUP: AppSetup = {
  startPath: "/vault",
  steps: [{ text: "Connect the wallet" }, { text: "Click Get test USDC" }, { text: "Approve in the wallet" }, { text: "Check the balance shows 1,000 USDC" }],
  when: "once",
  why: "The faucet gives test USDC once per account.",
};

const FEATURES: ExploreFeature[] = [
  { name: "Deposit", tier: "critical", why: "Moves funds into the vault.", startPath: "/vault", brief: "The deposit form and its approval." },
  { name: "Withdraw", tier: "critical", why: "Moves funds out of the vault.", startPath: "/vault", brief: "Taking funds back out, in part or in full." },
  { name: "Claim rewards", tier: "critical", why: "Signs a claim.", startPath: "/vault", brief: "Rewards accrue per block and are claimed with a transaction." },
  { name: "Balances", tier: "important", why: "Users rely on these numbers.", startPath: "/vault", brief: "What the page says against the chain." },
  { name: "Docs", tier: "supporting", why: "Marketing and legal pages.", startPath: "/", brief: "Docs and terms." },
];

const test = (name: string, goal: string, expected: string, steps: string[]): TestDraft => ({ name, goal, expected, startPath: "/vault", steps });

const SUGGESTED: Record<string, TestDraft[]> = {
  Deposit: [
    test("Deposit USDC into the vault", "Deposit a small amount of USDC and see it counted.", "Deposited shows 5.00 USDC.", ["Enter 5 as the amount", "Click Deposit", "Approve in the wallet", "Check Deposited shows 5.00"]),
    test("Deposit more than the balance is refused", "Try to deposit more USDC than the wallet holds.", "The form says Insufficient balance and the wallet is asked nothing.", ["Enter 2000 as the amount", "Click Deposit", "Check the form says Insufficient balance"]),
  ],
  Withdraw: [
    test("Withdraw part of a deposit", "Take part of a deposit back to the wallet.", "Deposited shows 3.00 USDC.", ["Deposit 5 USDC first", "Enter 2 as the amount", "Click Withdraw", "Approve in the wallet", "Check Deposited shows 3.00"]),
    test("Withdraw everything", "Withdraw the whole deposit back to the wallet.", "Deposited shows 0.00 and the balance is back to 1,000 USDC.", ["Deposit 5 USDC first", "Click Max", "Click Withdraw", "Approve in the wallet", "Check Deposited shows 0.00"]),
  ],
  "Claim rewards": [test("Claim accrued rewards", "Claim the rewards a deposit has earned.", "Claimable rewards shows 0.00.", ["Deposit 5 USDC first", "Click Claim rewards", "Approve in the wallet", "Check rewards show 0.00"])],
  Balances: [
    test("Balances match the chain", "Compare the balances on the page with the chain.", "The wallet balance and Deposited both match the chain.", ["Deposit 5 USDC first", "Check the wallet balance", "Check Deposited"]),
    test("Position history lists each deposit", "Open the history of a position after a deposit.", "The history shows one deposit of 5 USDC.", ["Deposit 5 USDC first", "Open History", "Check the deposit is listed"]),
  ],
};

type Check = [name: string, variation: ExploreVariation, pass: boolean, evidence: string];

interface Path {
  name: string;
  checks: Check[];
  /** The suggested test this path tries, by name. */
  test?: string;
  /** A test the explorer found on its own. */
  found?: TestDraft;
  then?: "save" | "skip" | "bug";
  /** How the proof on a clean fork ends. */
  proof?: "draft";
  why?: string;
  /** What the reviewer makes of the bug. */
  verdict?: ExploreBug["status"];
  signing?: boolean;
}

const PATHS: Record<string, Path[]> = {
  Deposit: [
    { name: "Deposit 5 USDC", test: "Deposit USDC into the vault", then: "save", checks: [["Deposit of 5 USDC shows in Deposited", "happy", true, "Shows “5.00 USDC”."], ["Deposit transaction is mined", "agreement", true, "Transaction 0x3f9a1c02… was mined in block 23456791."]] },
    { name: "Deposit 2,000 USDC", test: "Deposit more than the balance is refused", then: "save", checks: [["Depositing more than the balance is refused", "input", true, "Shows “Insufficient balance”."], ["Nothing is asked of the wallet", "input", true, "Nothing was asked to sign on this path."]] },
    { name: "Deposit 0", checks: [["Depositing 0 asks nothing of the wallet", "input", true, "Nothing was asked to sign on this path."]] },
    { name: "Deposit 1.0000001 USDC", then: "bug", verdict: "not-reproduced", why: "A clean browser refused the amount, so the first report was a one-off.", checks: [["Deposit with 7 decimals is refused", "input", false, "The wallet was asked: Deposit 1.0000001 USDC."]] },
    {
      name: "Reject, then deposit again",
      then: "save",
      found: test("Deposit after rejecting in the wallet", "Reject the deposit in the wallet, then deposit again.", "Deposited shows 5.00 USDC.", ["Enter 5 as the amount", "Click Deposit", "Reject in the wallet", "Click Deposit", "Approve in the wallet", "Check Deposited shows 5.00"]),
      checks: [["Deposit after rejecting once still works", "state", true, "Shows “5.00 USDC”."]],
    },
  ],
  Withdraw: [
    { name: "Withdraw 2 of 5 USDC", test: "Withdraw part of a deposit", then: "save", proof: "draft", why: "Step 3, “Click Withdraw”: the Withdraw button stays disabled after the deposit confirms.", checks: [["Partial withdraw returns the funds", "happy", true, "The page shows 997.00, and the chain says 997."]] },
    { name: "Withdraw the whole deposit", test: "Withdraw everything", then: "bug", verdict: "confirmed", why: "The receipt shows the revert, and the page still says the deposit is there.", checks: [["Withdraw everything empties the position", "round-trip", false, "Transaction 0x77b2e410… reverted in block 23456795."]] },
    { name: "Withdraw 10 of 5 USDC", checks: [["Withdrawing more than deposited is refused", "input", true, "Shows “Exceeds your deposit”."]] },
  ],
  "Claim rewards": [
    { name: "Claim after a deposit", test: "Claim accrued rewards", then: "save", signing: true, checks: [["Rewards accrue after a block", "happy", true, "Shows “0.42 USDC”."], ["Claim asks for a signature", "happy", true, "The wallet was asked: claim(address)."], ["Rewards go to zero after claiming", "round-trip", true, "Shows “0.00 USDC”."]] },
    { name: "Claim with nothing to claim", checks: [["Claim is disabled with no rewards", "state", true, "The Claim rewards button is disabled."]] },
  ],
  Balances: [
    { name: "Balances after a deposit", test: "Balances match the chain", then: "save", checks: [["USDC balance matches the chain", "agreement", true, "The page shows 995.00; the chain says 995."], ["Deposited matches the vault", "agreement", true, "The page shows 5.00; the chain says 5."]] },
    { name: "Look for a history page", test: "Position history lists each deposit", then: "skip", why: "The app has no history page.", checks: [] },
  ],
  Docs: [{ name: "Open the docs and terms", checks: [["Docs link opens", "path", true, "The address is https://docs.harbor.example/."], ["Terms page loads", "happy", true, "Shows “Terms of use”."]] }],
};

const round = (usd: number) => Math.round(usd * 100) / 100;

export const fakeExplore: Engine["explore"] = async (target, opts, hooks, sink, signal) => {
  const { artifactsDir } = opts;
  let cost = 0;
  const board = new Board(async (e) => {
    await sink(e);
    await sink({ type: "cost", usd: round((cost += 0.04)) });
  });
  const shot = (name: string) => png(artifactsDir, `screenshots/${name}.png`);
  const known = (name: string) => opts.tests?.some((t) => t.name === name);
  const suggestion = (name: string) => board.state.suggested.find((x) => x.draft.name === name);
  const update = (id: string, fn: (x: ExploreSuggestion) => void) => board.change((s) => void s.suggested.filter((x) => x.id === id).forEach(fn));
  // Proofs and reviews run beside the explorers, as they do for real.
  const jobs: Promise<void>[] = [];
  const beside = (fn: () => Promise<void>) => void jobs.push(fn().catch((e) => (isAbort(e) ? undefined : Promise.reject(e))));

  const prove = async (id: string, path: Path) => {
    const s = board.state.suggested.find((x) => x.id === id)!;
    const worker = `prove_${id}`;
    await beat(signal, 6);
    update(id, (x) => (x.status = "proving"));
    board.addExplorer({ id: worker, title: `Proving: ${s.draft.name}`, feature: s.feature, tier: s.tier, status: "running", doing: "Running it on a clean fork", startedAt: nowIso(), activeAt: nowIso() });
    for (const step of s.draft.steps) {
      board.explorer(worker, { doing: step, frame: await frame(artifactsDir), activeAt: nowIso() });
      await beat(signal, 5);
    }
    const signs = s.draft.steps.some((t) => /approve in the wallet/i.test(t));
    update(id, (x) => {
      if (path.proof === "draft") Object.assign(x, { status: "draft", note: path.why });
      else Object.assign(x, { status: "proved", steps: s.draft.steps.map((text) => ({ text, actions: [] })), provedAt: nowIso(), conditions: s.tier === "critical" && signs ? CONDITIONS.filter((c) => c.default).map((c) => c.id) : [] });
    });
    board.feed(path.proof === "draft" ? "fail" : "test", path.proof === "draft" ? `${s.draft.name} is a draft: ${path.why}` : `Saved as a test: ${s.draft.name}`);
    board.explorer(worker, { status: "done", doing: undefined, finishedAt: nowIso() });
    await hooks.onTest?.(structuredClone(board.state.suggested.find((x) => x.id === id)!));
  };

  const review = async (bugId: string, path: Path) => {
    await beat(signal, 14);
    const status = path.verdict ?? "confirmed";
    let name = "";
    board.change((s) => {
      const b = s.bugs.find((x) => x.id === bugId)!;
      name = b.name;
      b.status = status;
      b.reasoning = path.signing ? "The decoded request is an unlimited approval, which the Claim button never mentions." : path.why;
      if (status !== "confirmed") for (const x of s.suggested) if (x.bugId === bugId && x.status === "bug") Object.assign(x, { status: "suggested", bugId: undefined });
    });
    board.feed(status === "confirmed" ? "bug" : "note", status === "confirmed" ? `Confirmed: ${name}` : `${name}: couldn't reproduce it`);
    // The test an explorer was on when it found a bug that held is saved as the test that found it.
    if (status === "confirmed") for (const x of board.state.suggested.filter((x) => x.bugId === bugId && x.status === "bug")) await hooks.onTest?.(structuredClone(x));
  };

  const file = (bug: Pick<ExploreBug, "explorerId" | "feature" | "name" | "summary" | "steps" | "expected" | "actual" | "check" | "checkId" | "severity" | "source" | "evidence">, path: Path): string => {
    const id = newId("bug");
    board.change((s) => {
      s.bugs.push({ ...bug, id, status: "suspected", seen: 1, at: nowIso() });
      const e = s.explorers.find((x) => x.id === bug.explorerId);
      if (e) e.bugs++;
    });
    board.feed("bug", `Looks wrong: ${bug.name}`, bug.explorerId);
    beside(() => review(id, path));
    return id;
  };

  const explorer = async (feature: ExploreFeature, id: string) => {
    board.explorer(id, { status: "running", startedAt: nowIso(), activeAt: nowIso(), url: new URL(feature.startPath, target.url).href });
    for (const path of PATHS[feature.name] ?? []) {
      const planned = path.test ? suggestion(path.test) : undefined;
      if (path.test && !planned) continue;
      if (planned) update(planned.id, (x) => Object.assign(x, { status: "trying", explorerId: id }));
      board.explorer(id, { path: path.name, doing: path.name, frame: await frame(artifactsDir), activeAt: nowIso() });
      await beat(signal, 8);
      const checkIds: string[] = [];
      let last: ExploreCheck | undefined;
      for (const [name, variation, pass, evidence] of path.checks) {
        board.explorer(id, { doing: `Checking: ${name}`, frame: await frame(artifactsDir), activeAt: nowIso() });
        await beat(signal, 5);
        const check: ExploreCheck = {
          id: newId("chk"),
          explorerId: id,
          feature: feature.name,
          name,
          variation,
          startPath: feature.startPath,
          path: [path.name, `Check: ${name}`],
          assert: { kind: "shows", value: name },
          status: pass ? "pass" : "fail",
          evidence,
          signs: feature.tier === "critical",
          suggestionId: planned?.id,
          screenshot: await shot(`check-${newId("s")}`),
          at: nowIso(),
        };
        checkIds.push(check.id);
        last = check;
        board.change((s) => {
          s.checks.push(check);
          const e = s.explorers.find((x) => x.id === id);
          if (e) e.checks++;
        });
        board.feed(pass ? "pass" : "fail", name, id);
      }
      if (path.signing) {
        board.change((s) => void s.signing.dangerous++);
        file(
          {
            explorerId: id,
            feature: feature.name,
            name: "Dangerous signature: Unlimited USDC approval on claim",
            summary: "Claiming also asks for an unlimited USDC approval to an unverified contract.",
            steps: ["Connect the wallet", "Click Claim rewards", "Look at what the wallet is asked"],
            expected: "The wallet is only asked for what the button says.",
            actual: "It is asked for an unlimited approval.",
            check: "Sign only what the button says",
            severity: "critical",
            source: "signing",
            evidence: { console: [], network: [], chain: ["approve(0x9f3a…c2e1, unlimited)"] },
          },
          path,
        );
      }
      if (path.then === "skip" && planned) {
        update(planned.id, (x) => Object.assign(x, { status: "dropped", note: path.why }));
        board.change((s) => void s.gaps.push({ feature: feature.name, what: planned.draft.name, why: path.why! }));
        board.feed("note", `Left out ${planned.draft.name}: ${path.why}`, id);
      }
      if (path.then === "bug" && last) {
        const bugId = file(
          {
            explorerId: id,
            feature: feature.name,
            name: planned ? `${planned.draft.name} reverts` : "Deposit accepts more decimals than USDC has",
            summary: last.evidence,
            steps: planned?.draft.steps ?? ["Connect the wallet", "Enter 1.0000001 as the amount", "Click Deposit"],
            expected: planned?.draft.expected ?? "The form refuses the amount.",
            actual: last.evidence,
            check: planned ? undefined : "Refuse an amount with too many decimals",
            checkId: last.id,
            severity: "high",
            source: "explorer",
            evidence: { screenshot: last.screenshot, console: planned ? ["Error: execution reverted"] : [], network: [], chain: [last.evidence] },
          },
          path,
        );
        if (planned) update(planned.id, (x) => Object.assign(x, { status: "bug", bugId, note: last!.evidence }));
      }
      if (path.then === "save") {
        const found = path.found && !known(path.found.name) && !suggestion(path.found.name) ? path.found : undefined;
        const sid = planned?.id ?? (found ? newId("sug") : undefined);
        if (!sid) continue;
        if (planned) update(sid, (x) => (x.status = "worked"));
        else
          board.change((s) => {
            s.suggested.push({ id: sid, feature: feature.name, tier: feature.tier, draft: found!, explorerId: id, status: "worked", conditions: [] });
            for (const c of s.checks) if (checkIds.includes(c.id)) c.suggestionId = sid;
          });
        board.feed("pass", `Worked once: ${(planned?.draft ?? found!).name}`, id);
        beside(() => prove(sid, path));
      }
    }
    board.explorer(id, { status: "done", doing: undefined, summary: `Covered ${feature.name}.`, finishedAt: nowIso() });
  };

  try {
    board.phase("looking", "Looking around the app");
    board.addExplorer({ id: "look", title: "Looking around", feature: "", tier: "critical", status: "running", doing: "Opening the app", startedAt: nowIso(), activeAt: nowIso() });
    for (const note of ["USDC vault on Base", "Vault page behind Connect wallet", "Faucet gives test USDC once", "Rewards claimed with a transaction"]) {
      board.explorer("look", { doing: note, frame: await frame(artifactsDir), url: target.url, activeAt: nowIso() });
      board.feed("note", note, "look");
      await beat(signal, 8);
    }
    const saved = opts.setup?.steps.length ? opts.setup : undefined;
    await hooks.onMap?.(MAP, saved ? undefined : SETUP);
    board.change((s) => {
      s.features = structuredClone(FEATURES);
      for (const f of FEATURES) for (const draft of SUGGESTED[f.name] ?? []) if (!known(draft.name)) s.suggested.push({ id: newId("sug"), feature: f.name, tier: f.tier, draft, status: "suggested", conditions: [] });
    });
    board.feed("note", `Found ${FEATURES.length} features and ${board.state.suggested.length} tests to try`);
    board.explorer("look", { status: "done", doing: undefined, finishedAt: nowIso() });

    board.phase("setup", "Running the app's setup");
    board.addExplorer({ id: "setup", title: "Setup", feature: "", tier: "critical", status: "running", doing: "Connect the wallet", startedAt: nowIso(), activeAt: nowIso() });
    for (const step of (saved ?? SETUP).steps) {
      board.explorer("setup", { doing: step.text, frame: await frame(artifactsDir), activeAt: nowIso() });
      await beat(signal, 5);
    }
    board.explorer("setup", { status: "done", doing: undefined, finishedAt: nowIso() });
    board.feed("pass", "The app's setup works");

    board.phase("exploring");
    board.change((s) => (s.deadline = new Date(Date.now() + opts.budgetMinutes * 60_000).toISOString()));
    const queue = FEATURES.map((feature, i) => ({ feature, id: `exp_${i + 1}` }));
    for (const { feature, id } of queue) board.addExplorer({ id, title: feature.name, feature: feature.name, tier: feature.tier, status: "queued" });
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let job = queue.shift(); job; job = queue.shift()) await explorer(job.feature, job.id);
      }),
    );
    board.change((s) => void s.gaps.push({ feature: "Withdraw", what: "Withdraw during a pause", why: "The fork has no way to trigger the admin pause." }));

    board.phase("finishing");
    await Promise.all(jobs);
  } catch (e) {
    if (!isAbort(e)) throw e;
    await Promise.allSettled(jobs);
    board.change((s) => {
      for (const x of s.explorers) if (x.status === "running" || x.status === "queued") Object.assign(x, { status: "stopped", doing: undefined, finishedAt: nowIso() });
      for (const x of s.suggested) {
        if (x.status === "trying") x.status = "suggested";
        if (x.status === "proving") x.status = "worked";
      }
    });
  }
  const total = round(cost + 0.04);
  board.change((s) => (s.costs = { stage: { look: round(total * 0.15), setup: 0, explore: round(total * 0.5), prove: round(total * 0.25), confirm: round(total * 0.1) }, model: { think: round(total * 0.25), fast: round(total * 0.7), act: round(total * 0.05) } }));
  board.phase("done");
  await board.flush();
  return { state: board.state, chains: chainsOf(target), costUsd: total };
};
