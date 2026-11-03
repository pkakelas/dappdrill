import { z } from "zod";
import { ChainConfig, EdgeCaseId, Flow, WalletProfileId, type FlowRun, type Issue, type SigningReview } from "@dappdrill/core";
import { UsageError } from "./files.js";

/** The parts of the app's settings the CLI uses. */
const PulledApp = z.object({
  url: z.string(),
  settings: z
    .object({
      edgeCases: z.array(EdgeCaseId).optional(),
      wallets: z.array(WalletProfileId).optional(),
      chains: z.array(ChainConfig).optional(),
    })
    .passthrough()
    .default({}),
});
const PullResponse = z.object({ app: PulledApp, flows: z.array(Flow) });
export type PullResponse = z.infer<typeof PullResponse>;

export interface CiReport {
  commit?: string;
  branch?: string;
  runs: FlowRun[];
  issues: Issue[];
  signingReviews: SigningReview[];
}

/** Client for the web app's CI API (Bearer per-app token). */
export class CiApi {
  private readonly base: string;
  constructor(
    appUrl: string,
    private readonly token: string,
  ) {
    this.base = appUrl.replace(/\/+$/, "");
  }

  static fromEnv(appUrl: string, tokenEnv: string): CiApi {
    const token = process.env[tokenEnv];
    if (!token) throw new UsageError(`Set ${tokenEnv} to the app's API token (or pass --token-env).`);
    return new CiApi(appUrl, token);
  }

  async pullFlows(): Promise<PullResponse> {
    const body = await this.request("GET", "/api/ci/flows");
    const parsed = PullResponse.safeParse(body);
    if (!parsed.success) throw new Error(`Unexpected response from ${this.base}/api/ci/flows: ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  }

  async pushFlows(flows: Flow[]): Promise<unknown> {
    return this.request("PUT", "/api/ci/flows", { flows });
  }

  async report(report: CiReport): Promise<unknown> {
    return this.request("POST", "/api/ci/report", report);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }
}

/** Commit and branch from GitHub Actions (or other CI) env vars. */
export function ciContext(env = process.env): { commit?: string; branch?: string } {
  return {
    commit: env.DAPPDRILL_COMMIT ?? env.GITHUB_SHA,
    branch: env.DAPPDRILL_BRANCH ?? (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME),
  };
}
