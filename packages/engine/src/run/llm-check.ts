/**
 * A check that a model answers: one claim, decided from the page and the wallet as they are now.
 * The model that answers never saw the actions being done, so it can't take a doer's word for it.
 */
import { z } from "zod";
import type { LlmCheck, WalletRequest } from "@dappdrill/core";
import { formatSnapshot, takeSnapshot } from "../agent/snapshot.js";
import { decodeWalletRequest } from "../agent/wallet-decode.js";
import { saidAndGone } from "./page.js";
import { numbered, sentHash, signRequests, type Running, type Went } from "./running.js";
import { SAID } from "../agent/said.js";

const Answer = z.object({
  answer: z.enum(["yes", "no", "cant-tell"]),
  why: z.string().describe(`The exact text or the wallet request that shows it, or what is missing. ${SAID}`),
});

const SYSTEM = `You answer one claim about a web app at one moment of an end-to-end test. You get the claim, the page as text and as a screenshot, what the page showed during the latest action and has taken away since, and what the wallet was asked to sign since the test began. You also get the lines of the test up to this point: they say what was attempted, not that it worked. Decide the claim from the page and the wallet alone.

- yes: the page or the wallet plainly shows it. Name the exact text or the request that shows it.
- no: the page or the wallet plainly shows otherwise. Name what shows that.
- cant-tell: neither. A claim about something this page doesn't show, or about an earlier moment nothing here records, is cant-tell, not no. Don't guess.

What the page showed and took away is for a claim about a notice or a message: it was shown, even though it is gone. A claim about what the page shows or holds now is settled by the page now, not by something it showed for a moment.
A value within 1% of the one claimed is the same value: apps round and truncate (0.0099 for 0.01).
Whether a transaction was mined is settled by what the wallet sent, not by the page.`;

/** A live account keeps what earlier runs left, so an old entry that happens to match proves nothing. */
const LIVE = `
The account is on a live chain and keeps what earlier runs left: orders, positions, balances, history. Only what this run did counts: the newest entry, with the exact amount or price the lines name. An older entry with the same value, or a total that merely includes it, doesn't show the claim.`;

export async function checkByModel(run: Running, index: number): Promise<Went> {
  const { env, session } = run;
  const check = run.steps[index] as LlmCheck;
  // The whole page: what shows it is often below the fold.
  const png = await session.page.screenshot({ type: "png", fullPage: true });
  const signs = signRequests(run);
  const gone = await saidAndGone(session, run.acted);
  const llm = env.fastLlm();
  const live = env.chains.configs().some((c) => c.mode === "live");
  const { answer, why } = await llm.structured({
    system: live ? SYSTEM + LIVE : SYSTEM,
    prompt: [
      `Claim: ${check.claim}`,
      "",
      `Test: ${run.name}`,
      "Lines up to here:",
      ...run.steps.slice(0, index).map(numbered),
      "",
      "What the wallet was asked to sign:",
      ...(signs.length ? await Promise.all(signs.map((r) => signLine(run, r))) : ["- nothing"]),
      "",
      "Shown during the latest action and gone since:",
      ...(gone.length ? gone.map((g) => `- ${g}`) : ["- nothing"]),
      "",
      "The page now:",
      formatSnapshot(await takeSnapshot(session.page, { maxChars: 12_000, wholeLists: true })),
    ].join("\n"),
    images: [{ data: png.toString("base64"), mediaType: "image/png" }],
    schema: Answer,
    name: "answer",
  });
  return { status: answer === "yes" ? "pass" : answer === "no" ? "fail" : "unsure", by: "llm", model: llm.model, note: why };
}

/** A request with how it ended: approved or rejected, and for a transaction what the chain made of it. */
async function signLine(run: Running, r: WalletRequest): Promise<string> {
  const hash = sentHash(r);
  const receipt = hash ? await run.session.chains.client(r.chainId).getTransactionReceipt({ hash }).catch(() => undefined) : undefined;
  const chain = !hash ? undefined : !receipt ? "not mined yet" : receipt.status === "success" ? "mined" : "reverted on the chain";
  return `- ${decodeWalletRequest(r).summary} (${[r.outcome, chain].filter(Boolean).join(", ")})`;
}
