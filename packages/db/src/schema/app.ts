import type {
  Blocked,
  ChainConfig,
  DrillEvent,
  EdgeCaseId,
  Flow,
  FlowRun,
  Issue,
  IssueCategory,
  RunStatus,
  ScanStage,
  Severity,
  SigningReview,
  Verdict,
  WalletProfileId,
} from "@dappdrill/core";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------- teams

export type Plan = "free" | "builder";

/** Every user gets a personal team on sign-up; apps, wallets and integrations belong to teams. */
export const teams = pgTable("teams", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").$type<Plan>().notNull().default("builder"),
  createdAt: createdAt(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "member">().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("team_members_pk").on(t.teamId, t.userId)],
);

export const invites = pgTable("invites", {
  id: id(),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

/**
 * Test wallets are per team: accounts A and B (keys encrypted), an optional
 * funded live-mode key, and a disposable inbox for email-code logins.
 */
export const testWallets = pgTable("test_wallets", {
  teamId: text("team_id").primaryKey().references(() => teams.id, { onDelete: "cascade" }),
  accountAKeyEnc: text("account_a_key_enc").notNull(),
  accountAAddress: text("account_a_address").notNull(),
  accountBKeyEnc: text("account_b_key_enc").notNull(),
  accountBAddress: text("account_b_address").notNull(),
  inboxAddress: text("inbox_address"),
  inboxPasswordEnc: text("inbox_password_enc"),
  createdAt: createdAt(),
});

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"slack" | "telegram" | "email" | "github">().notNull(),
    /** Non-secret settings (channel name, chat id, recipients, repo). */
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    /** Encrypted secret (webhook URL, bot token). */
    secretEnc: text("secret_enc"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_team_kind").on(t.teamId, t.kind)],
);

// ---------------------------------------------------------------- apps

export interface AppSettings {
  edgeCases: EdgeCaseId[];
  wallets: WalletProfileId[];
  /** Empty = auto-detect. */
  chains: ChainConfig[];
  /** Extra notes for the explorer. */
  hints?: string;
  allowMainnetLive?: boolean;
  maxFlows?: number;
}

export const apps = pgTable(
  "apps",
  {
    id: id(),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** Hostname, used for domain verification. */
    host: text("host").notNull(),
    settings: jsonb("settings").$type<AppSettings>().notNull(),
    /** Funded testnet key for live mode (encrypted). */
    liveKeyEnc: text("live_key_enc"),
    liveKeyAddress: text("live_key_address"),
    /** JSON of headers sent only to the app's own site, e.g. its bot-protection bypass (encrypted). */
    accessHeadersEnc: text("access_headers_enc"),
    /** Their names, shown in settings (values are never shown again). */
    accessHeaderNames: jsonb("access_header_names").$type<string[]>().notNull().default([]),
    /** Daily replay schedule, "HH:MM" UTC; null = off. */
    scheduleTime: text("schedule_time"),
    /** Public read-only report links. */
    shareToken: text("share_token").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("apps_team_idx").on(t.teamId)],
);

export const domains = pgTable(
  "domains",
  {
    id: id(),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    token: text("token").notNull(),
    method: text("method").$type<"file" | "dns">(),
    verifiedAt: ts("verified_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("domains_team_host").on(t.teamId, t.host)],
);

/** Per-app tokens for the CLI / GitHub Action to report results. */
export const apiTokens = pgTable("api_tokens", {
  id: id(),
  appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** sha256 of the token; the token itself is shown once. */
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- scans

export type JobStatus = "queued" | "running" | "done" | "failed" | "stopped";
export type Trigger = "manual" | "schedule" | "ci";

export const scans = pgTable(
  "scans",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    /** Per-app sequence shown as "Scan #31". */
    number: integer("number").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    trigger: text("trigger").$type<Trigger>().notNull().default("manual"),
    triggeredBy: text("triggered_by").references(() => user.id, { onDelete: "set null" }),
    /** Snapshot of settings used. */
    settings: jsonb("settings").$type<AppSettings>().notNull(),
    chains: jsonb("chains").$type<ChainConfig[]>().notNull().default([]),
    stages: jsonb("stages")
      .$type<Partial<Record<ScanStage, { status: "running" | "done"; progress: number }>>>()
      .notNull()
      .default({}),
    walletAddress: text("wallet_address"),
    /** Latest live-view frame (artifact path). */
    liveFrame: text("live_frame"),
    pages: jsonb("pages").$type<{ url: string; title?: string }[]>().notNull().default([]),
    costUsd: real("cost_usd").notNull().default(0),
    /** Set when a bot check stopped the exploration. */
    blocked: jsonb("blocked").$type<Blocked>(),
    error: text("error"),
    stopRequested: boolean("stop_requested").notNull().default(false),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("scans_app_idx").on(t.appId, t.createdAt)],
);

/** "What it's doing" log and every other streamed event. */
export const scanEvents = pgTable(
  "scan_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    scanId: text("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
    event: jsonb("event").$type<DrillEvent>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("scan_events_scan_idx").on(t.scanId, t.id)],
);

// ---------------------------------------------------------------- flows

export const flows = pgTable(
  "flows",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<Flow>().notNull(),
    /** Scan that discovered it, if any. */
    scanId: text("scan_id").references(() => scans.id, { onDelete: "set null" }),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("flows_app_idx").on(t.appId)],
);

export const variations = pgTable("variations", {
  id: id(),
  flowId: text("flow_id").notNull().references(() => flows.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  inputs: jsonb("inputs").$type<Record<string, string>>().notNull().default({}),
  wallet: text("wallet").$type<WalletProfileId>(),
  chainId: integer("chain_id"),
  account: text("account").$type<"A" | "B">(),
  createdAt: createdAt(),
});

/** Agent-proposed fixes to a flow that broke; a person accepts or dismisses them. */
export const repairs = pgTable("repairs", {
  id: id(),
  flowId: text("flow_id").notNull().references(() => flows.id, { onDelete: "cascade" }),
  runId: text("run_id"),
  explanation: text("explanation").notNull(),
  proposed: jsonb("proposed").$type<Flow>().notNull(),
  status: text("status").$type<"open" | "accepted" | "dismissed">().notNull().default("open"),
  createdAt: createdAt(),
});

/** A request to change a flow, in plain English or from a recording, processed by the worker. */
export const flowChanges = pgTable("flow_changes", {
  id: id(),
  appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  /** Null when the change creates a new flow. */
  flowId: text("flow_id").references(() => flows.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"describe" | "record">().notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  proposed: jsonb("proposed").$type<Flow>(),
  explanation: text("explanation"),
  error: text("error"),
  /** What the person did with the proposal; null while it waits for them. */
  resolution: text("resolution").$type<"accepted" | "dismissed">(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- runs & results

/** A batch of flow runs: one replay request, a scheduled run-all, a CI run, or a scan's matrix. */
export const runBatches = pgTable(
  "run_batches",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    scanId: text("scan_id").references(() => scans.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<Trigger>().notNull().default("manual"),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    /** What was asked for: flow ids, edge cases, variation. */
    request: jsonb("request")
      .$type<{ flowIds: string[]; edgeCases: EdgeCaseId[]; variationId?: string; commit?: string; branch?: string }>()
      .notNull(),
    error: text("error"),
    /** Set by the web "Stop" button; the worker polls it between runs. */
    stopRequested: boolean("stop_requested").notNull().default(false),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("run_batches_app_idx").on(t.appId, t.createdAt)],
);

export const runs = pgTable(
  "runs",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    batchId: text("batch_id").references(() => runBatches.id, { onDelete: "cascade" }),
    scanId: text("scan_id").references(() => scans.id, { onDelete: "cascade" }),
    flowId: text("flow_id").references(() => flows.id, { onDelete: "set null" }),
    edgeCase: text("edge_case").$type<EdgeCaseId>().notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    result: jsonb("result").$type<FlowRun>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("runs_flow_idx").on(t.flowId, t.createdAt), index("runs_batch_idx").on(t.batchId)],
);

export const issues = pgTable(
  "issues",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    scanId: text("scan_id").references(() => scans.id, { onDelete: "cascade" }),
    batchId: text("batch_id").references(() => runBatches.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    flowId: text("flow_id").references(() => flows.id, { onDelete: "set null" }),
    fingerprint: text("fingerprint").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    category: text("category").$type<IssueCategory>().notNull(),
    title: text("title").notNull(),
    data: jsonb("data").$type<Issue>().notNull(),
    /** open; ignored = "This is expected". */
    status: text("status").$type<"open" | "ignored" | "fixed">().notNull().default("open"),
    githubIssueUrl: text("github_issue_url"),
    createdAt: createdAt(),
  },
  (t) => [index("issues_app_idx").on(t.appId, t.createdAt), index("issues_fp_idx").on(t.appId, t.fingerprint)],
);

export const signingReviews = pgTable(
  "signing_reviews",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    scanId: text("scan_id").references(() => scans.id, { onDelete: "cascade" }),
    batchId: text("batch_id").references(() => runBatches.id, { onDelete: "cascade" }),
    flowId: text("flow_id").references(() => flows.id, { onDelete: "set null" }),
    fingerprint: text("fingerprint").notNull(),
    verdict: text("verdict").$type<Verdict>().notNull(),
    data: jsonb("data").$type<SigningReview>().notNull(),
    /** "Accept as new baseline" */
    isBaseline: boolean("is_baseline").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("signing_app_idx").on(t.appId, t.createdAt),
    index("signing_fp_idx").on(t.appId, t.fingerprint),
    uniqueIndex("signing_one_baseline").on(t.appId, t.fingerprint).where(sql`${t.isBaseline}`),
  ],
);
