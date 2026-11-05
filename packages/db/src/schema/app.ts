import type {
  AppMap,
  AppSetup,
  Blocked,
  ChainConfig,
  EdgeCaseId,
  FixedResponse,
  Stalled,
  TestRunResult,
  TestRunStatus,
  TestStep,
  WalletProfileId,
} from "@dappdrill/core";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  wallets: WalletProfileId[];
  /** Empty = auto-detect. */
  chains: ChainConfig[];
  /** Notes for the analysis ("the swap page is under /trade"). */
  hints?: string;
  /** How to get funds for testing ("needs test USDC", "mint at 0x..."). Never a private key: this isn't encrypted. */
  funding?: string;
  allowMainnetLive?: boolean;
  /** localStorage set on the app's origin before it loads (a fork mode, a feature flag). */
  storage?: Record<string, string>;
  /** Requests answered with a fixed body (a version check, a backend that disagrees with the fork). */
  responses?: FixedResponse[];
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
    /** What the analysis learned: a summary and the main pages. */
    map: jsonb("map").$type<AppMap>(),
    /** Steps every test needs first (sign in, get test funds), and when they run. */
    setup: jsonb("setup").$type<AppSetup>(),
    /** Chains the analysis saw the app use (with the fork block), for runs when none are configured. */
    chains: jsonb("chains").$type<ChainConfig[]>().notNull().default([]),
    /** Daily run of every test, "HH:MM" UTC; null = off. */
    scheduleTime: text("schedule_time"),
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


// ---------------------------------------------------------------- analysis

export type JobStatus = "queued" | "running" | "done" | "failed" | "stopped";

/** The first look at an app: a couple of minutes of browsing that maps it and writes the first tests. */
export const analyses = pgTable(
  "analyses",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    /** Latest live-view frame (artifact path). */
    liveFrame: text("live_frame"),
    /** What it's doing, newest last. */
    log: jsonb("log").$type<{ at: string; text: string }[]>().notNull().default([]),
    blocked: jsonb("blocked").$type<Blocked>(),
    stalled: jsonb("stalled").$type<Stalled>(),
    costUsd: real("cost_usd").notNull().default(0),
    error: text("error"),
    stopRequested: boolean("stop_requested").notNull().default(false),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("analyses_app_idx").on(t.appId, t.createdAt)],
);

// ---------------------------------------------------------------- flows & tests

/** A thing users do (trade, deposit); groups its happy path with the tests forked or derived from it. */
export const flows = pgTable(
  "flows",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** One sentence: what the user wants to have done. Flows found by analysis have one even without a test. */
    goal: text("goal"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("flows_app_idx").on(t.appId)],
);

export const tests = pgTable(
  "tests",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    flowId: text("flow_id").notNull().references(() => flows.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    expected: text("expected").notNull(),
    startPath: text("start_path").notNull().default("/"),
    steps: jsonb("steps").$type<TestStep[]>().notNull(),
    /** Condition row: runs `baseId`'s steps under this condition. Name and expected come from CONDITIONS. */
    condition: text("condition").$type<EdgeCaseId>(),
    baseId: text("base_id").references((): AnyPgColumn => tests.id, { onDelete: "cascade" }),
    /** The test this one was forked from. */
    forkedFrom: text("forked_from"),
    /** Text that proved the expected result last time. */
    proof: text("proof"),
    /** Set while the worker writes the test (a fork, a request to the agent); the page shows it. */
    drafting: text("drafting"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("tests_flow_idx").on(t.flowId), index("tests_app_idx").on(t.appId)],
);

export type Trigger = "manual" | "analysis" | "schedule" | "agent";

/** One result: one execution of one test. Results started together share a batch id, which is what the Runs page calls a run. */
export const testRuns = pgTable(
  "test_runs",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    testId: text("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    trigger: text("trigger").$type<Trigger>().notNull().default("manual"),
    status: text("status").$type<TestRunStatus>().notNull().default("queued"),
    result: jsonb("result").$type<TestRunResult>(),
    liveFrame: text("live_frame"),
    stopRequested: boolean("stop_requested").notNull().default(false),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("test_runs_test_idx").on(t.testId, t.createdAt), index("test_runs_batch_idx").on(t.batchId)],
);

/** Dangerous signatures the team was told about, so later runs don't repeat the alert. */
export const signingAlerts = pgTable(
  "signing_alerts",
  {
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    /** What was signed, not where: see `signatureKey` in the worker. */
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.appId, t.key] })],
);

// ---------------------------------------------------------------- agent

export interface AgentLink {
  label: string;
  href: string;
}

/** The agent panel's conversation, per app. */
export const agentMessages = pgTable(
  "agent_messages",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    role: text("role").$type<"user" | "agent">().notNull(),
    text: text("text").notNull().default(""),
    /** Agent replies: pending while the worker answers. */
    status: text("status").$type<"pending" | "done" | "failed">().notNull().default("done"),
    /** The page the user was on: what "this test" means. */
    context: jsonb("context").$type<{ testId?: string; flowId?: string }>().notNull().default({}),
    /** What the agent changed, as links. */
    links: jsonb("links").$type<AgentLink[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("agent_messages_app_idx").on(t.appId, t.createdAt)],
);
