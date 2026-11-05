/** The canned exploration of the fake vault: every phase, three explorers, one bug of each kind. */
import { closeGate, newId, nowIso, type CheckReplay, type ExploreCandidate, type ExploreCheck, type ExploreVariation } from "@dappdrill/core";
import { Board } from "../explore/board.js";
import { sweepable } from "../explore/replays.js";
import { beat, chainsOf, frame, isAbort, png, type Engine } from "./index.js";

const AREAS = [
  { id: "area_deposit", title: "Deposit", flow: "Deposit", tier: "critical", brief: "The deposit form and its approval.", startPath: "/vault", exclude: [], round: 1 },
  { id: "area_withdraw", title: "Withdraw", flow: "Withdraw", tier: "critical", brief: "Taking funds back out.", startPath: "/vault", exclude: [], round: 1 },
  { id: "area_rewards", title: "Claim rewards", flow: "Claim rewards", tier: "critical", brief: "Claiming what accrued.", startPath: "/vault", exclude: [], round: 1 },
  { id: "area_balances", title: "Balances", flow: "Balances", tier: "important", brief: "What the page says against the chain.", startPath: "/vault", exclude: [], round: 1 },
  { id: "area_docs", title: "Docs and legal", flow: "Docs", tier: "supporting", brief: "Everything that isn't the app.", startPath: "/", exclude: [], round: 1 },
] as const;

type Script = [name: string, variation: ExploreVariation, pass: boolean, evidence: string][];

const SCRIPTS: Record<string, Script> = {
  area_deposit: [
    ["Deposit of 5 USDC shows in Deposited", "happy", true, "Shows “5.00 USDC”."],
    ["Deposit transaction is mined", "agreement", true, "Transaction 0x3f9a1c02… was mined in block 23456791."],
    ["Depositing more than the balance is refused", "input", true, "Shows “Insufficient balance”."],
    ["Depositing 0 asks nothing of the wallet", "input", true, "Nothing was asked to sign on this path."],
    ["Deposit with 7 decimals is refused", "input", false, "The wallet was asked: Deposit 1.0000001 USDC."],
    ["Deposit after rejecting once still works", "state", true, "Shows “5.00 USDC”."],
  ],
  area_withdraw: [
    ["Partial withdraw returns the funds", "happy", true, "The page shows 995.00, and the chain says 995."],
    ["Withdraw everything empties the position", "round-trip", false, "Transaction 0x77b2e410… reverted in block 23456795."],
    ["Withdrawing more than deposited is refused", "input", true, "Shows “Exceeds your deposit”."],
  ],
  area_rewards: [
    ["Rewards accrue after a block", "happy", true, "Shows “0.42 USDC”."],
    ["Claim asks for a signature", "happy", true, "The wallet was asked: claim(address)."],
    ["Rewards go to zero after claiming", "round-trip", true, "Shows “0.00 USDC”."],
  ],
  area_balances: [
    ["USDC balance matches the chain", "agreement", true, "The page shows 1,000.00; the chain says 1000."],
    ["Deposited matches the vault", "agreement", true, "The page shows 5.00; the chain says 5."],
  ],
  area_docs: [
    ["Docs link opens", "path", true, "The address is https://docs.harbor.example/."],
    ["Terms page loads", "happy", true, "Shows “Terms of use”."],
  ],
};

export const fakeExplore: Engine["explore"] = async (target, opts, hooks, sink, signal) => {
  const { artifactsDir } = opts;
  let cost = 0;
  const board = new Board(async (e) => {
    await sink(e);
    await sink({ type: "cost", usd: Math.round((cost += 0.04) * 100) / 100 });
  });
  const replays: CheckReplay[] = [];
  const shot = (name: string) => png(artifactsDir, `screenshots/${name}.png`);

  try {
    board.phase("setup", "Checking the wallet connects");
    board.addExplorer({ id: "setup", title: "Connecting the wallet", flow: "", tier: "critical", status: "running", doing: "Connecting the wallet", checks: 0, bugs: 0, startedAt: nowIso(), activeAt: nowIso() });
    for (let i = 0; i < 2; i++) {
      board.explorer("setup", { frame: await frame(artifactsDir), activeAt: nowIso() });
      await beat(signal, 8);
    }
    board.explorer("setup", { status: "done", doing: undefined, finishedAt: nowIso() });
    board.feed("pass", "The wallet connects");

    board.phase("planning", "Deciding what matters most");
    await beat(signal, 10);
    board.change((s) => {
      s.flows = [
        { name: "Deposit", tier: "critical", why: "Moves funds into the vault." },
        { name: "Withdraw", tier: "critical", why: "Moves funds out of the vault." },
        { name: "Claim rewards", tier: "critical", why: "Signs a claim." },
        { name: "Balances", tier: "important", why: "Users rely on these numbers." },
        { name: "Docs", tier: "supporting", why: "Marketing and legal pages." },
      ];
      s.areas = AREAS.map((a) => ({ ...a, exclude: [] }));
    });
    board.feed("note", "5 areas across 3 Critical, 1 Important and 1 Supporting flows");

    board.phase("exploring");
    board.change((s) => (s.deadline = new Date(Date.now() + opts.budgetMinutes * 60_000).toISOString()));
    for (const a of AREAS) board.addExplorer({ id: `exp_${a.id}`, title: a.title, flow: a.flow, tier: a.tier, status: "queued", checks: 0, bugs: 0 });

    const explorer = async (area: (typeof AREAS)[number]) => {
      const id = `exp_${area.id}`;
      board.explorer(id, { status: "running", startedAt: nowIso(), activeAt: nowIso(), url: new URL(area.startPath, target.url).href });
      for (const [name, variation, pass, evidence] of SCRIPTS[area.id]!) {
        board.explorer(id, { path: name, doing: `Trying: ${name}`, frame: await frame(artifactsDir), activeAt: nowIso() });
        await beat(signal, 10);
        board.explorer(id, { doing: `Checking: ${name}`, frame: await frame(artifactsDir), activeAt: nowIso() });
        await beat(signal, 6);
        const check: ExploreCheck = {
          id: newId("chk"),
          explorerId: id,
          flow: area.flow,
          name,
          variation,
          startPath: area.startPath,
          path: ["Connect the wallet", "Enter the amount", `Check: ${name}`],
          assert: { kind: "shows", value: name },
          status: pass ? "pass" : "fail",
          evidence,
          signs: area.tier === "critical",
          screenshot: await shot(`check-${newId("s")}`),
          at: nowIso(),
        };
        replays.push({ id: check.id, name, flow: area.flow, startPath: area.startPath, actions: [], assert: check.assert });
        board.change((s) => {
          s.checks.push(check);
          const e = s.explorers.find((x) => x.id === id);
          if (e) e.checks++;
        });
        board.feed(pass ? "pass" : "fail", `${name}: ${evidence}`, id);
        if (!pass) {
          board.change((s) => {
            s.bugs.push({
              id: newId("bug"),
              explorerId: id,
              flow: area.flow,
              name,
              summary: evidence,
              steps: check.path,
              expected: name,
              actual: evidence,
              severity: "high",
              status: "suspected",
              source: "explorer",
              evidence: { screenshot: check.screenshot, console: ["Error: execution reverted"], network: [], chain: [evidence] },
              at: nowIso(),
            });
            const e = s.explorers.find((x) => x.id === id);
            if (e) e.bugs++;
          });
          board.feed("bug", name, id);
        }
      }
      if (area.id === "area_rewards") {
        board.change((s) => {
          s.signing.dangerous++;
          s.bugs.push({
            id: newId("bug"),
            explorerId: id,
            flow: area.flow,
            name: "Dangerous signature: Unlimited USDC approval on claim",
            summary: "Claiming also asks for an unlimited USDC approval to an unverified contract.",
            steps: ["Connect the wallet", "Click Claim", "Look at what the wallet is asked"],
            expected: "The wallet is only asked for what the button says.",
            actual: "It is asked for an unlimited approval.",
            severity: "critical",
            status: "suspected",
            source: "signing",
            evidence: { console: [], network: [], chain: ["approve(0x9f3a…c2e1, unlimited)"] },
            at: nowIso(),
          });
        });
        board.feed("bug", "Dangerous signature: Unlimited USDC approval on claim", id);
      }
      board.explorer(id, { status: "done", doing: undefined, summary: `Covered ${area.title}.`, finishedAt: nowIso() });
    };

    const queue = [...AREAS];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let a = queue.shift(); a; a = queue.shift()) await explorer(a);
      }),
    );
    board.change((s) => void s.gaps.push({ flow: "Withdraw", what: "Withdraw during a pause", why: "The fork has no way to trigger the admin pause." }));

    board.phase("extracting", `Sorting ${board.state.checks.length} checks`);
    await beat(signal, 8);

    const candidates: ExploreCandidate[] = board.state.checks
      .filter((c) => c.status === "pass" && c.flow !== "Docs" && c.variation !== "path")
      .slice(0, 8)
      .map((c) => ({
        id: newId("cand"),
        flow: c.flow,
        tier: c.flow === "Balances" ? "important" : "critical",
        draft: { name: c.name, goal: c.name, expected: c.evidence, startPath: c.startPath, steps: ["Connect the wallet", "Enter the amount", "Approve in the wallet", "Check the result"] },
        checkIds: [c.id],
        why: "It proves the funds moved.",
        status: "waiting",
        conditions: [],
      }));
    board.change((s) => (s.candidates = candidates));
    board.feed("note", `${candidates.length} of ${board.state.checks.length} checks earned a test`);

    board.phase("proving", `Proving ${candidates.length} tests on fresh forks`);
    board.addExplorer({ id: "prove_1", title: "Proving tests", flow: "", tier: "critical", status: "running", checks: 0, bugs: 0, startedAt: nowIso(), activeAt: nowIso() });
    for (const [i, c] of candidates.entries()) {
      board.change((s) => (s.candidates.find((x) => x.id === c.id)!.status = "proving"));
      board.explorer("prove_1", { doing: `First run: ${c.draft.name}`, flow: c.flow, frame: await frame(artifactsDir), activeAt: nowIso() });
      await beat(signal, 8);
      const failed = i === 3;
      board.change((s) => {
        const x = s.candidates.find((y) => y.id === c.id)!;
        x.status = failed ? "draft" : "proved";
        if (failed) x.note = "Step 3, “Approve in the wallet”: nothing was asked to sign.";
        else x.steps = c.draft.steps.map((text) => ({ text, actions: [] }));
      });
      board.feed(failed ? "fail" : "test", failed ? `${c.draft.name} stays a draft` : `Saved ${c.draft.name}`);
      await hooks.onTest?.(structuredClone(board.state.candidates.find((x) => x.id === c.id)!));
    }
    board.explorer("prove_1", { status: "done", doing: undefined, finishedAt: nowIso() });

    board.phase("confirming", `Reviewing ${board.state.bugs.length} suspected bugs`);
    for (const b of [...board.state.bugs]) {
      await beat(signal, 8);
      const isDeposit = b.flow === "Deposit";
      board.change((s) => {
        const x = s.bugs.find((y) => y.id === b.id)!;
        x.status = isDeposit ? "not-reproduced" : "confirmed";
        x.reasoning = isDeposit ? "A fresh browser rejected the amount, so the first report was a one-off." : "The screenshot and the receipt agree with the report.";
      });
      board.feed(isDeposit ? "note" : "bug", `${b.name}: ${isDeposit ? "couldn't reproduce" : "confirmed"}`);
    }

    board.phase("closing");
    await beat(signal, 4);
    const gate = closeGate(board.state);
    if (gate.unreviewed.length || gate.unsettled.length) throw new Error("The fake exploration left something open");
  } catch (e) {
    if (!isAbort(e)) throw e;
    board.change((s) => s.explorers.forEach((x) => {
      if (x.status === "running" || x.status === "queued") x.status = "stopped";
      x.doing = undefined;
    }));
  }
  board.phase("done");
  await board.flush();
  return { state: board.state, replays, chains: chainsOf(target), costUsd: Math.round(cost * 100) / 100 };
};

export const fakeSweep: Engine["sweep"] = async (_target, replays, _opts, _sink, signal) => {
  const results: Awaited<ReturnType<Engine["sweep"]>>["sweep"]["results"] = {};
  for (const r of replays.filter(sweepable)) {
    await beat(signal, 2);
    results[r.id] = { status: "pass", evidence: "Same as when it was explored." };
  }
  return { sweep: { at: nowIso(), results }, costUsd: 0 };
};
