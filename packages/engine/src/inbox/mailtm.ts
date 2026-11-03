/**
 * Disposable inboxes on mail.tm for email-code logins (embedded wallets such
 * as Privy). Polls politely; mail.tm allows about 8 requests per second.
 */
import type { Inbox } from "../types.js";

const API = "https://api.mail.tm";
const POLL_MS = 3_000;

export interface InboxCredentials {
  address: string;
  password: string;
}

interface Message {
  id: string;
  subject: string;
  intro: string;
  createdAt: string;
  text?: string;
  html?: string[];
}

/** mail.tm answers with a plain array or a Hydra collection depending on the Accept header. */
type Collection<T> = T[] | { "hydra:member": T[] };

function members<T>(c: Collection<T>): T[] {
  return Array.isArray(c) ? c : (c["hydra:member"] ?? []);
}

export async function createInboxAccount(fetchFn: typeof fetch = fetch): Promise<InboxCredentials> {
  const domains = members(await request<Collection<{ domain: string; isActive: boolean }>>(fetchFn, "/domains"));
  const domain = domains.find((d) => d.isActive)?.domain ?? domains[0]?.domain;
  if (!domain) throw new Error("mail.tm has no domains available");
  const address = `dd-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}@${domain}`;
  const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await request(fetchFn, "/accounts", { method: "POST", body: { address, password } });
  return { address, password };
}

export async function openInbox(creds: InboxCredentials, fetchFn: typeof fetch = fetch): Promise<Inbox> {
  const { token } = await request<{ token: string }>(fetchFn, "/token", { method: "POST", body: creds });
  const auth = { authorization: `Bearer ${token}` };

  const list = () => request<Collection<Message>>(fetchFn, "/messages", { headers: auth }).then(members);
  const read = (id: string) => request<Message>(fetchFn, `/messages/${id}`, { headers: auth });

  return {
    address: creds.address,
    async latestCode({ sinceMs, timeoutMs }) {
      const deadline = Date.now() + timeoutMs;
      const tried = new Set<string>();
      while (true) {
        const fresh = (await list())
          .filter((m) => Date.parse(m.createdAt) >= sinceMs && !tried.has(m.id))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        for (const m of fresh) {
          tried.add(m.id);
          const full = await read(m.id);
          const code = extractCode(`${full.subject}\n${full.text ?? ""}\n${(full.html ?? []).join("\n")}`);
          if (code) return code;
        }
        if (Date.now() + POLL_MS > deadline) throw new Error(`No login code arrived at ${creds.address} within ${Math.round(timeoutMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
  };
}

/** A 4–8 digit code (preferring one near the word "code"), else a magic link. */
export function extractCode(text: string): string | undefined {
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    // "12 34 56" / "123-456" → "123456"
    .replace(/\b\d{2,4}(?:[ -]\d{2,4})+\b/g, (m) => {
      const joined = m.replace(/[ -]/g, "");
      return joined.length >= 4 && joined.length <= 8 ? joined : m;
    });
  const near = /\b(?:code|otp|pin|passcode)\b[^\d]{0,40}?(\d{4,8})\b/i.exec(plain) ?? /\b(\d{4,8})\b[^\d]{0,40}?\b(?:code|otp|pin)\b/i.exec(plain);
  if (near) return near[1];
  const any = /\b(\d{6})\b/.exec(plain) ?? /\b(\d{4,8})\b/.exec(plain);
  if (any) return any[1];
  const link = /https?:\/\/[^\s"'<>]+(?:verify|magic|login|auth|confirm|token)[^\s"'<>]*/i.exec(text);
  return link?.[0];
}

async function request<T = unknown>(
  fetchFn: typeof fetch,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(`${API}${path}`, {
      method: opts.method ?? "GET",
      headers: { accept: "application/json", "content-type": "application/json", ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`mail.tm ${opts.method ?? "GET"} ${path} failed: ${res.status} ${await res.text().catch(() => "")}`.trim());
    return (await res.json()) as T;
  }
}
