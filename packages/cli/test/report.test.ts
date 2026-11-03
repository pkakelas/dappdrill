import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DrillTarget, type DrillEvent, type FlowRun, type Issue, type ScanReport } from "@dappdrill/core";
import { fakeEngine } from "@dappdrill/engine/fake";
import { exitCodeFor, healthLine, renderJunit, renderMarkdown, reportHealth } from "../src/report/index.js";

process.env.DAPPDRILL_FAKE_DELAY_MS = "0";
const target = DrillTarget.parse({ url: "http://localhost:4000", chains: [{ id: 84532, rpcUrl: "http://127.0.0.1:1", mode: "fork" }] });

let report: ScanReport;
const events: DrillEvent[] = [];

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "dappdrill-cli-test-"));
  report = await fakeEngine.scan(target, { artifactsDir: dir }, (e) => void events.push(e));
});

describe("fake engine", () => {
  it("streams every kind of event the product shows", () => {
    const types = new Set(events.map((e) => e.type));
    for (const t of ["stage", "log", "frame", "chains", "page", "flow", "flow-status", "wallet-request", "signing-review", "issue", "run", "cost"]) {
      expect(types, t).toContain(t);
    }
    expect(new Set(report.issues.map((i) => i.severity))).toEqual(new Set(["critical", "high", "medium", "low"]));
    expect(new Set(report.signingReviews.map((r) => r.verdict))).toEqual(new Set(["dangerous", "check", "consistent"]));
  });

  it("returns a partial report when aborted", async () => {
    const abort = new AbortController();
    const dir = await mkdtemp(join(tmpdir(), "dappdrill-cli-test-"));
    let flows = 0;
    const partial = await fakeEngine.scan(target, { artifactsDir: dir }, (e) => {
      if (e.type === "flow" && ++flows === 2) abort.abort();
    }, abort.signal);
    expect(partial.stoppedEarly).toBe(true);
    expect(partial.runs.length).toBeLessThan(report.runs.length);
  });

  it("replays a renamed button as a broken step, and repairFlow fixes it", async () => {
    const withdraw = report.flows.find((f) => f.name.startsWith("Withdraw"))!;
    const dir = await mkdtemp(join(tmpdir(), "dappdrill-cli-test-"));
    const result = await fakeEngine.replay(target, [withdraw], { edgeCases: ["happy"], artifactsDir: dir }, () => {});
    const run = result.runs[0]!;
    expect(run.status).toBe("fail");
    const fix = await fakeEngine.repairFlow(target, withdraw, run, { artifactsDir: dir }, () => {});
    expect(JSON.stringify(fix?.flow)).not.toContain("Withdraw all");
  });
});

describe("report health", () => {
  const run = (status: FlowRun["status"], issueIds: string[] = []) => ({ ...report.runs[0]!, id: `r-${status}`, status, issueIds });
  const issue = (severity: Issue["severity"]) => ({ ...report.issues[0]!, id: `i-${severity}`, severity });

  it("is Broken when a run failed even without issues", () => {
    expect(reportHealth({ runs: [run("fail")], issues: [] })).toBe("broken");
    expect(healthLine({ runs: [run("fail")], issues: [] })).toBe("Broken: 1 run broke.");
  });

  it("is Review for medium/low only, OK for nothing", () => {
    expect(reportHealth({ runs: [run("issue")], issues: [issue("medium")] })).toBe("review");
    expect(healthLine({ runs: [run("pass")], issues: [] })).toBe("OK: No problems found.");
  });

  it("doesn't call an empty scan OK", () => {
    expect(healthLine({ runs: [], issues: [] })).toBe("Nothing tested: no flows were found or run.");
  });

  it("doesn't double-count a failed run explained by a critical issue", () => {
    const line = healthLine({ runs: [run("fail", ["i-critical"])], issues: [issue("critical"), issue("low")] });
    expect(line).toBe("Broken: 1 problem to fix (1 critical). 1 more to review.");
  });

  it("maps --fail-on to exit codes", () => {
    expect(exitCodeFor("broken", "broken")).toBe(1);
    expect(exitCodeFor("review", "broken")).toBe(0);
    expect(exitCodeFor("review", "review")).toBe(1);
    expect(exitCodeFor("ok", "review")).toBe(0);
    expect(exitCodeFor("broken", "never")).toBe(0);
  });
});

describe("renderers", () => {
  it("markdown leads with health and never calls anything safe", () => {
    const md = renderMarkdown(report, { title: "Harbor", link: "https://x/report" });
    expect(md).toContain("Broken:");
    expect(md).toContain("Dangerous");
    expect(md).toContain("Looks consistent");
    expect(md).toContain("https://x/report");
    expect(md.toLowerCase()).not.toMatch(/\bsafe\b/);
  });

  it("junit has a testcase per run and fails the broken ones", () => {
    const xml = renderJunit(report);
    expect(xml.match(/<testcase /g)?.length).toBe(report.runs.length);
    expect(xml).toContain("<failure");
    expect(xml).toContain("<skipped");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});
