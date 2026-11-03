import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return drizzle(client, { schema, casing: "snake_case" });
}

let shared: Db | undefined;
/** Process-wide connection pool. */
export function db(): Db {
  shared ??= createDb();
  return shared;
}
