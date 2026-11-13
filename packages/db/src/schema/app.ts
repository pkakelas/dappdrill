import type { Action, ChainConfig, Check, DrillTarget, Fault, FixedResponse, MakeState, Outcome, RunValue, SuiteSettings, TestResult, WalletProfileId } from "@dappdrill/core";
import {
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
  /** How to get funds for testing ("needs test USDC", "mint at 0x..."). Never a private key: this isn't encrypted. */
  funding?: string;
  allowMainnetLive?: boolean;
  /** localStorage set on the app's origin before it loads (a fork mode, a feature flag). */
  storage?: Record<string, string>;
  /** Requests answered with a fixed body (a version check, a backend that disagrees with the fork). */
  responses?: FixedResponse[];
  /** ERC-20 balances the test wallet starts with on forks; the look picks them from what the app reads. */
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
    /** What the app's tests share: the setup done once before them, the notes about the app, and what may be signed. */
    suite: jsonb("suite").$type<SuiteSettings>().notNull().default({ notes: [], signing: "allowed" }),
    /** Chains the look saw the app use (with the fork block), for runs when none are configured. */
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

// ---------------------------------------------------------------- making tests

export type JobStatus = "queued" | "running" | "done" | "failed" | "stopped";

/** Tests being made for an app: a look for goals and a test for each, or one test from a goal somebody typed. */
export const makes = pgTable(
  "makes",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    /** The goal to make one test from. Null: look over the app and make a test for each goal found. */
    goal: text("goal"),
    /** How many of the look's goals get a test. */
    count: integer("count").notNull().default(10),
    /** Everything the app page draws of it. */
    state: jsonb("state").$type<MakeState>().notNull().default({ stage: "looking", goals: [] }),
    costUsd: real("cost_usd").notNull().default(0),
    error: text("error"),
    stopRequested: boolean("stop_requested").notNull().default(false),
    /** Who started it: they hear by email when it ends. */
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("makes_app_idx").on(t.appId, t.createdAt)],
);

// ---------------------------------------------------------------- tests

/** A test: a goal and a flat list of actions and checks (`Test` in core, whose id is this row's). */
export const tests = pgTable(
  "tests",
  {
    id: id(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    startPath: text("start_path").notNull().default("/"),
    /** Numbers picked afresh on every run, written {{name}} in the lines. */
    values: jsonb("values").$type<Record<string, RunValue>>().notNull().default({}),
    steps: jsonb("steps").$type<(Action | Check)[]>().notNull(),
    /** Done when the test stopped early, to take back what it left on an account that isn't reset. */
    cleanup: jsonb("cleanup").$type<Action[]>().notNull().default([]),
    /** The faults of the app this test was kept for: it fails until they are fixed. */
    faults: jsonb("faults").$type<Fault[]>().notNull().default([]),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("tests_app_idx").on(t.appId)],
);

/** "make": the run that proved a test when it was made. */
export type Trigger = "manual" | "make" | "schedule";
export type RunStatus = "queued" | "running" | "stopped" | Outcome;

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
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    /** While it runs: the lines done so far. */
    result: jsonb("result").$type<TestResult>(),
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

// ---------------------------------------------------------------- marketing site

/** Who asked for early access on the marketing site. One row per email. */
export const earlyAccess = pgTable("early_access", {
  email: text("email").primaryKey(),
  createdAt: createdAt(),
});
