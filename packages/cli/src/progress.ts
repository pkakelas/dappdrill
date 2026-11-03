import { SCAN_STAGE_LABEL, VERDICT_LABEL, edgeCaseInfo, type DrillEvent, type DrillEventSink, type Flow } from "@dappdrill/core";

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
/** Only problems get colour. */
const red = (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s: string) => (useColour ? `\x1b[2m${s}\x1b[0m` : s);

const RUN_WORD = { pass: "OK", issue: "Review", fail: "Broken", error: "Error", skipped: "Skipped" } as const;

/** Prints engine events as readable progress lines. Frames and wallet chatter are left out. */
export function consoleSink(known: Flow[] = [], write: (line: string) => void = (l) => console.log(l)): DrillEventSink {
  const flows = new Map(known.map((f) => [f.id, f]));
  const name = (id?: string) => (id ? (flows.get(id)?.name ?? id) : "");
  const started = new Set<string>();
  return (event: DrillEvent) => {
    switch (event.type) {
      case "stage":
        if (event.status === "running" && !started.has(event.stage)) {
          started.add(event.stage);
          write(`\n${SCAN_STAGE_LABEL[event.stage]}`);
        }
        break;
      case "log":
        write(event.level === "info" ? dim(`  ${event.message}`) : red(`  ${event.level}: ${event.message}`));
        break;
      case "chains":
        write(`  chains: ${event.chains.map((c) => `${c.name ?? c.id} (${c.mode}${c.forkBlock ? ` @ ${c.forkBlock}` : ""})`).join(", ")}`);
        break;
      case "page":
        write(`  page   ${event.url}${event.title ? dim(`  ${event.title}`) : ""}`);
        break;
      case "flow":
        flows.set(event.flow.id, event.flow);
        write(`  flow   ${event.flow.name} (${event.flow.steps.length} steps)`);
        break;
      case "run": {
        const word = RUN_WORD[event.run.status];
        const line = `  ${word.padEnd(7)} ${name(event.run.flowId)} · ${edgeCaseInfo(event.run.edgeCase).label}${event.run.reason ? dim(`  ${event.run.reason}`) : ""}`;
        write(event.run.status === "fail" || event.run.status === "error" ? red(line) : line);
        break;
      }
      case "issue": {
        const line = `  ${event.issue.severity.padEnd(8)} ${event.issue.title}`;
        write(event.issue.severity === "critical" || event.issue.severity === "high" ? red(line) : line);
        break;
      }
      case "signing-review": {
        const line = `  signing ${VERDICT_LABEL[event.review.verdict]}: ${event.review.title}`;
        write(event.review.verdict === "dangerous" ? red(line) : line);
        break;
      }
      case "frame":
      case "flow-status":
      case "wallet-request":
      case "cost":
        break;
    }
  };
}
