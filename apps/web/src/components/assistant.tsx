"use client";

import { ArrowUp, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { agentMessagesAction, clearAgentAction, sendAgentMessageAction, type AgentMessage } from "@/actions/agent";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";

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
      <Button type="button" onClick={() => setOpen(true)} className="fixed right-5 bottom-5 z-40 h-10 gap-2.5 rounded-full pr-3 pl-4 shadow-lg max-sm:px-4">
        Ask
        <kbd className="rounded bg-primary-foreground/15 px-1.5 py-0.5 text-xs max-sm:hidden">⌘K</kbd>
      </Button>
    );

  const suggestions = testId ? ON_TEST : ON_LIST;
  return (
    <aside aria-label="Assistant" className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-lg sm:w-[420px]">
      <header className="flex items-center gap-3 border-b px-5 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-base font-semibold">Ask</h2>
          <p className="text-sm text-muted-foreground">{testId ? "About this test, or anything in the app." : "About your tests, or anything in the app."}</p>
        </div>
        {messages && messages.length > 0 && !waiting && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={async () => {
              await clearAgentAction(appId);
              await load();
            }}
          >
            Clear
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
          <X aria-hidden="true" />
        </Button>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        {messages?.length === 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-sm text-muted-foreground">It can read, write, fork and run tests, and look around the app in a browser.</p>
            <div className="flex flex-col items-start gap-1.5 pt-2">
              {suggestions.map((s) => (
                <Button key={s} type="button" variant="outline" size="sm" className="h-auto rounded-full py-1.5 text-left font-normal whitespace-normal" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages?.map((m) => (
          <Message key={m.id} message={m} onLink={() => setOpen(window.innerWidth >= 1280)} />
        ))}
        <div ref={bottom} />
      </div>

      <form
        className="border-t px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background px-3 py-2 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
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
            className="max-h-40 min-h-8 flex-1 resize-none border-0 bg-transparent py-1.5 text-sm leading-snug outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon-sm" aria-label="Send" disabled={!draft.trim() || waiting || sending} className="rounded-full disabled:opacity-30">
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
        {error && <p className="px-1 pt-2 text-sm text-bad">{error}</p>}
      </form>
    </aside>
  );
}

function Message({ message: m, onLink }: { message: AgentMessage; onLink: () => void }) {
  if (m.role === "user") return <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap">{m.text}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {m.text ? (
        <p className={cx("text-sm leading-relaxed whitespace-pre-wrap", m.status === "failed" && "text-bad")}>{m.text}</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-live" />
          Working on it
        </p>
      )}
      {m.links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.links.map((l, i) => (
            <Button key={i} asChild variant="outline" size="xs">
              <Link href={l.href} onClick={onLink}>
                {l.label} →
              </Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
