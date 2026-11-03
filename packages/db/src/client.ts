import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 10, idle_timeout: 60, onnotice: () => {} });
  return drizzle(client, { schema, casing: "snake_case" });
}

// Kept on globalThis so bundlers that load this module more than once (Next.js dev layers, HMR) share one pool.
const holder = globalThis as { __dappdrillDb?: Db };
/** Process-wide connection pool. */
export function db(): Db {
  holder.__dappdrillDb ??= createDb();
  return holder.__dappdrillDb;
}
