import { FileSignature, MessageSquareText, Send } from "lucide-react";
import { Fragment } from "react";
import { cx } from "@/components/ui";

/**
 * What the wallet was asked to sign, as the engine writes it into a note (decodeWalletRequest's summary in
 * packages/engine/src/agent/wallet-decode.ts):
 *   eth_signTypedData_v4 Permit (USD Coin): {"owner":"0x…","value":"5000000",…}
 *   eth_sendTransaction to 0x2222…2222: approve(0x1111…1111, 12500000) value=0
 *   personal_sign: "Sign in to Example"
 */
type Asked = { kind: "typed"; primary: string; domain?: string; fields: [string, string][]; cut: boolean } | { kind: "tx"; to: string; call: string; args: string[]; value?: string } | { kind: "message"; text: string };

const START = /\b(eth_signTypedData(?:_v[34])?|eth_sendTransaction|eth_signTransaction|personal_sign|eth_sign)\b/g;

/** Where a bracketed run that opens at `from` closes, minding quoted strings; the text's end when it was cut short. */
function closing(s: string, from: number, open: string, close: string): number {
  let depth = 0;
  let quoted = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return s.length;
}

/** Splits at commas not inside brackets. */
function topLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if ("([{".includes(s[i]!)) depth++;
    else if (")]}".includes(s[i]!)) depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (s.slice(start).trim()) parts.push(s.slice(start).trim());
  return parts;
}

/** The request that starts at `at`, and where it ends; undefined when the text there isn't one. */
function readAt(s: string, at: number, method: string): { asked: Asked; end: number } | undefined {
  const rest = s.slice(at + method.length);
  const base = at + method.length;
  if (method.startsWith("eth_signTypedData")) {
    const head = /^ (\S+)(?: \(([^)]*)\))?: /.exec(rest);
    if (!head || rest[head[0].length] !== "{") return undefined;
    const open = base + head[0].length;
    const end = closing(s, open, "{", "}");
    const body = s.slice(open, end);
    // Every "key": value in the message, nested ones included, in order. A summary cut at 200 characters loses its last ones.
    const fields: [string, string][] = [];
    for (const m of body.matchAll(/"([^"\\]+)":\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g)) fields.push([m[1]!, m[2]!.startsWith('"') ? m[2]!.slice(1, -1) : m[2]!]);
    return { asked: { kind: "typed", primary: head[1]!, domain: head[2], fields, cut: body.endsWith("…") || !body.endsWith("}") }, end };
  }
  if (method === "eth_sendTransaction" || method === "eth_signTransaction") {
    const head = /^ to (\S+): /.exec(rest);
    if (!head) return undefined;
    const from = base + head[0].length;
    const paren = s.indexOf("(", from);
    const word = /^[\w$]+/.exec(s.slice(from))?.[0];
    let end: number;
    let call: string;
    let args: string[] = [];
    if (word && paren === from + word.length) {
      end = closing(s, paren, "(", ")");
      call = word;
      args = topLevel(s.slice(paren + 1, end - 1));
    } else {
      // "plain transfer" or "calldata 0x… and n bytes of arguments, not decoded"
      end = s.slice(from).search(/ value=|[;.](?:\s|$)|$/) + from;
      call = s.slice(from, end);
    }
    const value = /^ value=(\d+)/.exec(s.slice(end));
    if (value) end += value[0].length;
    return { asked: { kind: "tx", to: head[1]!, call, args, value: value?.[1] }, end };
  }
  const msg = /^: "/.exec(rest);
  if (!msg) return undefined;
  const from = base + msg[0].length;
  // The message runs to the last quote before the note goes on to another request or ends.
  const next = s.slice(from).search(/";\s|"\.?\s*$/);
  const end = next < 0 ? s.length : from + next + 1;
  return { asked: { kind: "message", text: s.slice(from, next < 0 ? s.length : end - 1) }, end };
}

type Part = { text: string } | { asked: Asked };

/** A note as its words and the wallet requests in it. */
export function splitSigned(note: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of note.matchAll(START)) {
    if (m.index! < last) continue;
    const read = readAt(note, m.index!, m[1]!);
    if (!read) continue;
    const before = note.slice(last, m.index).replace(/[\s;]+$/, "");
    if (before) parts.push({ text: before });
    parts.push({ asked: read.asked });
    last = read.end;
  }
  const after = note.slice(last).replace(/^[\s;.]+/, "");
  if (after) parts.push({ text: after });
  return parts;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TIME_KEY = /deadline|expir|valid(after|before|until)|sigdeadline|timestamp/i;

/** An address shortened (whole on hover), a time as a date, the rest as it is. */
function Value({ name, value }: { name?: string; value: string }) {
  if (ADDRESS.test(value))
    return (
      <span title={value} className="font-mono">
        {value.slice(0, 6)}…{value.slice(-4)}
      </span>
    );
  if (name && TIME_KEY.test(name) && /^\d{9,10}$/.test(value)) {
    const date = new Date(Number(value) * 1000);
    return <span title={value}>{date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>;
  }
  // A uint160 or uint256 near its top is how an approval says "no limit".
  if (/^\d{45,}$/.test(value)) return <span title={value}>Unlimited</span>;
  return <span className="font-mono [overflow-wrap:anywhere]">{value}</span>;
}

/** One request the wallet was asked: what kind, what it is, and what is in it. */
export function SignedCard({ asked, className }: { asked: Asked; className?: string }) {
  const Icon = asked.kind === "tx" ? Send : asked.kind === "message" ? MessageSquareText : FileSignature;
  const kind = asked.kind === "tx" ? "Transaction" : asked.kind === "message" ? "Message" : "Signature";
  const title = asked.kind === "typed" ? asked.primary : asked.kind === "tx" ? asked.call : undefined;
  const rows: [string, string][] =
    asked.kind === "typed" ? asked.fields : asked.kind === "tx" ? [...asked.args.map((a, i): [string, string] => [`${i + 1}`, a]), ...(asked.value && asked.value !== "0" ? [["value (wei)", asked.value] as [string, string]] : [])] : [];
  return (
    <span className={cx("flex flex-col overflow-hidden rounded-lg border bg-background text-sm text-foreground", className)}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/40 px-3 py-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">{kind}</span>
        {title && <span className="font-medium">{title}</span>}
        {asked.kind === "typed" && asked.domain && <span className="text-muted-foreground">· {asked.domain}</span>}
        {asked.kind === "tx" && (
          <span className="text-muted-foreground">
            · to <Value value={asked.to} />
          </span>
        )}
      </span>
      {asked.kind === "message" ? (
        <span className="px-3 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{asked.text}</span>
      ) : (
        rows.length > 0 && (
          <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 py-2">
            {rows.map(([k, v], i) => (
              <Fragment key={i}>
                <span className="text-muted-foreground">{asked.kind === "tx" ? `Argument ${k}` : k}</span>
                <Value name={k} value={v} />
              </Fragment>
            ))}
            {asked.kind === "typed" && asked.cut && <span className="col-span-2 text-xs text-muted-foreground">More fields not shown.</span>}
          </span>
        )
      )}
    </span>
  );
}

/** A request in a few words, for a note on one line. */
function named(a: Asked): string {
  if (a.kind === "typed") return `a ${a.primary}${a.domain ? ` (${a.domain})` : ""} signature`;
  if (a.kind === "tx") return /^\w+$/.test(a.call) ? `a ${a.call} transaction` : "a transaction";
  return "a message";
}

/** The note with each wallet request in it named in a few words instead of written out. */
export function shortSigned(note: string): string {
  return splitSigned(note)
    .map((p) => ("text" in p ? p.text : named(p.asked)))
    .join(" ")
    .replace(/\s+([.,;])/g, "$1");
}

/** A note with each wallet request in it drawn as a card, and its words around them as they are. Spans all through, so it fits in a line of text. */
export function Evidence({ text, className, textClassName }: { text: string; className?: string; textClassName?: string }) {
  const parts = splitSigned(text);
  if (parts.length === 1 && "text" in parts[0]!) return <span className={cx(className, textClassName)}>{text}</span>;
  return (
    <span className={cx("flex flex-col gap-2", className)}>
      {parts.map((p, i) =>
        "text" in p ? (
          <span key={i} className={textClassName}>
            {p.text}
          </span>
        ) : (
          <SignedCard key={i} asked={p.asked} className="max-w-xl" />
        ),
      )}
    </span>
  );
}
