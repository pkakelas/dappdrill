import type {
  AppMap,
  AppSetup,
  Blocked,
  BugTriage,
  ChainConfig,
  DrillTarget,
  EdgeCaseId,
  ExploreState,
  FixedResponse,
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
import { organization, user } from "./auth.js";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------- organization resources

/**
 * Test wallets are per organization: accounts A and B (keys encrypted) and a
 * disposable inbox for email-code logins.
 */
export const testWallets = pgTable("test_wallets", {
  organizationId: text("organization_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
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
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"slack" | "telegram" | "email" | "github">().notNull(),
    /** Non-secret settings (channel name, chat id, recipients, repo). */
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    /** Encrypted secret (webhook URL, bot token). */
    secretEnc: text("secret_enc"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_org_kind").on(t.organizationId, t.kind)],
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
  /** ERC-20 balances the test wallet starts with on forks; the first look picks them from what the app reads. */
  tokens?: DrillTarget["tokens"];
}

export const apps = pgTable(
  "apps",
  {
    id: id(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
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
  (t) => [index("apps_org_idx").on(t.organizationId)],
);

export const domains = pgTable(
  "domains",
  {
    id: id(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    token: text("token").notNull(),
    method: text("method").$type<"file" | "dns">(),
    verifiedAt: ts("verified_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("domains_org_host").on(t.organizationId, t.host)],
);

// ---------------------------------------------------------------- exploring

export type JobStatus = "queued" | "running" | "done" | "failed" | "stopped";

/** One pass over an app: what was mapped and suggested, what explorers tried, and the tests and bugs that came of it. */
export const explorations = pgTable(
  "explorations",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    /** The most minutes explorers get; a pass ends sooner when nothing new turns up. */
    budgetMinutes: integer("budget_minutes").notNull().default(15),
    /** Everything the app page draws of the pass. */
    state: jsonb("state").$type<ExploreState>(),
    /** Where each bug stands, by bug id: dismissed by a person, or fixed. Apart from state, which the worker overwrites. */
    triage: jsonb("triage").$type<Record<string, BugTriage>>().notNull().default({}),
    blocked: jsonb("blocked").$type<Blocked>(),
    costUsd: real("cost_usd").notNull().default(0),
    error: text("error"),
    stopRequested: boolean("stop_requested").notNull().default(false),
    /** Who started the pass: they hear by email when it ends. */
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("explorations_app_idx").on(t.appId, t.createdAt)],
);

// ---------------------------------------------------------------- tests

/**
 * A test: a goal, an expected result and steps. With no steps it is something users do that
 * nobody wrote yet (see `notWritten`). A condition row runs its base's steps under a condition.
 */
export const tests = pgTable(
  "tests",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    expected: text("expected").notNull(),
    startPath: text("start_path").notNull().default("/"),
    steps: jsonb("steps").$type<TestStep[]>().notNull(),
    /** On a live chain: steps that undo what the test left on the account, run after the result is judged. */
    after: jsonb("after").$type<TestStep[]>(),
    /** Condition row: runs `baseId`'s steps under this condition. Name and expected come from CONDITIONS. */
    condition: text("condition").$type<EdgeCaseId>(),
    baseId: text("base_id").references((): AnyPgColumn => tests.id, { onDelete: "cascade" }),
    /** The test this one was forked from. */
    forkedFrom: text("forked_from"),
    /** The bug this test was written from. The bug is marked fixed when the test passes. */
    bugId: text("bug_id"),
    /** Text that proved the expected result last time. */
    proof: text("proof"),
    /** Set while the worker writes the test (a fork, a request to the agent); the page shows it. */
    drafting: text("drafting"),
    /** A draft: it hasn't passed yet, and this says why. Cleared by its first pass. Drafts don't count towards a flow's status. */
    draftNote: text("draft_note"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("tests_app_idx").on(t.appId)],
);

export type Trigger = "manual" | "analysis" | "explore" | "schedule" | "agent";

/** One result: one execution of one test. Results started together share a batch id, which is what the Runs page calls a run. */
export const testRuns = pgTable(
  "test_runs",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    testId: text("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
    batchId: text("batch_id").notNull(),
    trigger: text("trigger").$type<Trigger>().notNull().default("manual"),
    /** The URL the test ran against when it wasn't the app's own (a preview deploy, a staging build). Null: the app's URL. */
    url: text("url"),
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

/** Dangerous signatures the organization was told about, so later runs don't repeat the alert. */
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
    context: jsonb("context").$type<{ testId?: string }>().notNull().default({}),
    /** What the agent changed, as links. */
    links: jsonb("links").$type<AgentLink[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("agent_messages_app_idx").on(t.appId, t.createdAt)],
);
