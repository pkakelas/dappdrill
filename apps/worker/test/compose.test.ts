import { describe, expect, it } from "vitest";
import { FlowRun, Issue } from "@dappdrill/core";
import { alertText, composeAlert, composeScanDone, slackPayload } from "../src/notify/compose.js";
import { utcMinute } from "../src/jobs/schedule.js";

const issue = (severity: Issue["severity"], title: string): Issue =>
  Issue.parse({
    id: `iss_${title}`,
    fingerprint: `fp_${title}`,
    severity,
    category: "signing",
    title,
    summary: "",
    flowName: "Deposit USDC",
    createdAt: new Date().toISOString(),
  });

describe("composeAlert", () => {
  const base = { appName: "Harbor", what: "scan" as const, link: "http://app/apps/a/scans/s" };

  it("stays quiet when nothing new broke", () => {
    expect(composeAlert({ ...base, newIssues: [], regressions: [] })).toBeNull();
  });

  it("lists problems worst first, with counts and the link", () => {
    const alert = composeAlert({
      ...base,
      newIssues: [issue("high", "Reject leaves spinner"), issue("critical", "Unlimited approval")],
      regressions: [{ flowName: "Withdraw", edgeCase: "happy" }],
    })!;
    expect(alert.title).toBe("Harbor: 3 new problems in the latest scan");
    expect(alert.lines[0]).toBe("Critical: Unlimited approval (Deposit USDC)");
    expect(alert.lines[2]).toMatch(/^Broke: Withdraw · Happy path/);
    expect(alert.counts).toBe("1 critical, 1 high · 1 flow broke");
    expect(alertText(alert)).toContain(base.link);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 9 }, (_, i) => issue("high", `p${i}`));
    const alert = composeAlert({ ...base, newIssues: many, regressions: [] })!;
    expect(alert.lines).toHaveLength(7);
    expect(alert.lines.at(-1)).toBe("and 3 more");
  });

  it("escapes Slack control characters", () => {
    const alert = composeAlert({ ...base, newIssues: [issue("critical", "<script> & co")], regressions: [] })!;
    const json = JSON.stringify(slackPayload(alert));
    expect(json).toContain("&lt;script&gt; &amp; co");
    expect(json).toContain(`<${base.link}|Open the report>`);
  });
});

describe("composeScanDone", () => {
  const at = new Date().toISOString();
  const run = (id: string, status: FlowRun["status"], issueIds: string[] = []): FlowRun =>
    FlowRun.parse({ id, flowId: "flow_dep", edgeCase: "reject", status, issueIds, startedAt: at, finishedAt: at });
  const base = { appName: "Harbor", number: 4, failed: false, flows: [{ id: "flow_dep", name: "Deposit USDC" }], link: "http://app/apps/a/scans/s" };

  it("says all clear when nothing needs attention", () => {
    const done = composeScanDone({ ...base, issues: [issue("low", "Tiny")], runs: [run("r1", "pass")] });
    expect(done.title).toBe("Scan #4 of Harbor: all clear");
    expect(done.lines).toEqual([]);
    expect(done.counts).toBe("1 flow found · 1 run");
  });

  it("counts broken runs that filed no issue with critical and high issues", () => {
    const done = composeScanDone({ ...base, issues: [issue("medium", "Slow"), issue("high", "Spinner")], runs: [run("r1", "fail"), run("r2", "pass")] });
    expect(done.title).toBe("Scan #4 of Harbor: 2 things need your attention");
    expect(done.lines).toEqual(["High: Spinner (Deposit USDC)", "Medium: Slow (Deposit USDC)", "Didn't finish: Deposit USDC · Reject"]);
  });

  it("names a failed scan with its error", () => {
    const done = composeScanDone({ ...base, failed: true, error: "The site did not load.", issues: [], runs: [] });
    expect(done.title).toBe("Scan #4 of Harbor failed");
    expect(done.lines).toEqual(["The site did not load."]);
  });
});

it("utcMinute formats HH:MM in UTC", () => {
  expect(utcMinute(new Date("2026-11-03T07:05:59Z"))).toBe("07:05");
});
