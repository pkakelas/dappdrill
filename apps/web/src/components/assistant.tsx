"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { agentMessagesAction, clearAgentAction, sendAgentMessageAction, type AgentMessage } from "@/actions/agent";
import { cx } from "@/components/ui";

const ON_TEST = ["Why did this fail?", "Fork it with a different amount", "Add unhappy paths and run them"];
const ON_LIST = ["Which tests are failing?", "Add a test for withdrawing everything", "Run every test"];

/** The assistant: a panel on every app page that knows the tests and can change and run them. ⌘K opens it. */
export function Assistant({ appId }: { appId: string }) {
  const { testId } = useParams<{ testId?: string }>();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, start] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const waiting = messages?.some((m) => m.status === "pending") ?? false;

  const load = useCallback(async () => setMessages(await agentMessagesAction(appId)), [appId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    input.current?.focus();
  }, [open, load]);

  // Poll while a reply is being written, then refresh the page underneath: the reply may have changed tests.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 700);
    return () => {
      clearInterval(t);
      router.refresh();
    };
  }, [waiting, load, router]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = (text: string) => {
    const clean = text.trim();
    if (!clean || waiting || sending) return;
    setError(undefined);
    setDraft("");
    setMessages((m) => [...(m ?? []), { id: "local-q", role: "user", text: clean, status: "done", links: [] }, { id: "local-a", role: "agent", text: "", status: "pending", links: [] }]);
    start(async () => {
      const r = await sendAgentMessageAction(appId, clean, { testId });
      if (r.error) setError(r.error);
      await load();
    });
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 flex cursor-pointer items-center gap-2.5 rounded-full bg-ink py-2.5 pr-3 pl-4 font-mono text-[12.5px] text-paper shadow-[0_6px_24px_-8px_rgb(0_0_0/0.45)] hover:bg-ink-2 max-sm:px-4"
      >
        Ask
        <kbd className="rounded-md bg-paper/15 px-1.5 py-0.5 font-mono text-[10.5px] max-sm:hidden">⌘K</kbd>
      </button>
    );

  const suggestions = testId ? ON_TEST : ON_LIST;
  return (
    <aside
      aria-label="Assistant"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-paper shadow-[-12px_0_40px_-24px_rgb(0_0_0/0.35)] sm:w-[420px]"
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 font-serif text-[19px] font-[420] tracking-[-0.01em]">Ask</h2>
          <p className="m-0 text-[12.5px] text-muted">{testId ? "About this test, or anything in the app." : "About your tests, or anything in the app."}</p>
        </div>
        {messages && messages.length > 0 && !waiting && (
          <button
            type="button"
            className="btn btn-xs"
            onClick={async () => {
              await clearAgentAction(appId);
              await load();
            }}
          >
            Clear
          </button>
        )}
        <button type="button" aria-label="Close" className="btn btn-icon" onClick={() => setOpen(false)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        {messages?.length === 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <p className="m-0 text-[14px] text-ink-3">It can read, write, fork and run tests, and look around the app in a browser.</p>
            <div className="flex flex-col items-start gap-1.5 pt-2">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip cursor-pointer text-left" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages?.map((m) => <Message key={m.id} message={m} onLink={() => setOpen(window.innerWidth >= 1280)} />)}
        <div ref={bottom} />
      </div>

      <form
        className="border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-card px-3 py-2 focus-within:border-ink">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            placeholder={testId ? "e.g. the same but sell half" : "e.g. add a test for claiming rewards"}
            className="max-h-40 min-h-[26px] flex-1 resize-none border-0 bg-transparent py-0.5 text-[14.5px] leading-snug outline-none placeholder:text-faint"
          />
          <button type="submit" aria-label="Send" disabled={!draft.trim() || waiting || sending} className="btn btn-primary btn-icon shrink-0 disabled:opacity-30">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 10V2M2.5 5.5L6 2l3.5 3.5" />
            </svg>
          </button>
        </div>
        {error && <p className="m-0 px-1 pt-2 text-[13px] text-bad">{error}</p>}
      </form>
    </aside>
  );
}

function Message({ message: m, onLink }: { message: AgentMessage; onLink: () => void }) {
  if (m.role === "user")
    return <p className="m-0 max-w-[85%] self-end rounded-2xl rounded-br-md bg-sub px-3.5 py-2 text-[14.5px] leading-snug whitespace-pre-wrap">{m.text}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {m.text ? (
        <p className={cx("m-0 text-[14.5px] leading-relaxed whitespace-pre-wrap", m.status === "failed" && "text-bad")}>{m.text}</p>
      ) : (
        <p className="m-0 flex items-center gap-2 text-[13px] text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
          Working on it
        </p>
      )}
      {m.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.links.map((l, i) => (
            <Link key={i} href={l.href} onClick={onLink} className="btn btn-xs no-underline">
              {l.label} →
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
