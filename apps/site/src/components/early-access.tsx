"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { COMPANY, CTA, EARLY_ACCESS_URL } from "@/site";

type State = { is: "idle" } | { is: "sending" } | { is: "done"; email: string } | { is: "failed"; why: string };

/** The email field at the end of the home page. Every "Get early access" button lands here (/#access). */
export function EarlyAccess() {
  const [state, setState] = useState<State>({ is: "idle" });
  const input = useRef<HTMLInputElement>(null);

  // Arriving from a "Get early access" button puts the cursor in the field.
  useEffect(() => {
    const focus = () => location.hash === "#access" && input.current?.focus({ preventScroll: true });
    focus();
    addEventListener("hashchange", focus);
    return () => removeEventListener("hashchange", focus);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    setState({ is: "sending" });
    try {
      const res = await fetch(EARLY_ACCESS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website: String(form.get("website") ?? "") }),
      });
      if (res.ok) return setState({ is: "done", email });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setState({ is: "failed", why: body?.error ?? "That didn’t go through." });
    } catch {
      setState({ is: "failed", why: "That didn’t go through." });
    }
  }

  if (state.is === "done") {
    return (
      <p role="status" className="mt-12 flex min-h-[68px] items-center text-[clamp(17px,1.6vw,21px)] text-white/80">
        You’re on the list. We’ll write to {state.email} when there’s room.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-12 w-full max-w-[620px]">
      <div className="flex h-[68px] items-center gap-3 rounded-full bg-white py-2 pr-2 pl-5 text-ink sm:pl-6">
        <svg viewBox="0 0 20 20" className="size-5 flex-none text-ink/40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
          <path d="m3 5.5 7 5.5 7-5.5" />
        </svg>
        <label htmlFor="access-email" className="sr-only">
          Your work email
        </label>
        <input
          ref={input}
          id="access-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourdapp.xyz"
          className="min-w-0 flex-1 bg-transparent font-mono text-[clamp(14px,1.6vw,19px)] outline-none placeholder:text-ink/35"
        />
        {/* Left empty by people; bots fill it in. */}
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <button
          type="submit"
          disabled={state.is === "sending"}
          className="btn h-[52px] flex-none bg-ink px-6 text-white hover:bg-ink/85 disabled:opacity-60 sm:px-7"
        >
          <span className="sm:hidden">Join</span>
          <span className="hidden sm:inline">{state.is === "sending" ? "Sending…" : CTA.label}</span>
        </button>
      </div>
      <p role="status" className="mt-4 min-h-[1.5em] text-[14.5px] text-white/50">
        {state.is === "failed" ? (
          <>
            {state.why} Try again, or write to{" "}
            <a href={`mailto:${COMPANY.email}`} className="text-white underline underline-offset-2">
              {COMPANY.email}
            </a>
            .
          </>
        ) : (
          "We let teams in a few at a time, and write to you when there’s room."
        )}
      </p>
    </form>
  );
}
