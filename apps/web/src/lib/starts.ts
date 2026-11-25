import "server-only";
import { chainName, fundText } from "@dappdrill/core";
import { accountOf, type apps } from "@dappdrill/db";
import type { StartChoices } from "@/components/tests/starts-with";
import { CHAINS } from "./chains";

/**
 * What a test's form offers for what its account starts with, on an app whose tests each get a new account.
 * Nothing on a kept account, which holds what it holds.
 */
export function startChoices(app: typeof apps.$inferSelect): StartChoices | undefined {
  if (accountOf(app) !== "new") return undefined;
  const own = (app.settings.chains.length ? app.settings.chains : app.chains).filter((c) => !c.fallback);
  const chains = own.length ? own.map((c) => ({ id: c.id, name: c.name ?? chainName(c.id) })) : CHAINS.map((c) => ({ id: c.id, name: c.name }));
  return { chains, sends: (app.settings.fund ?? []).map(fundText).join(" and ") || "nothing" };
}
