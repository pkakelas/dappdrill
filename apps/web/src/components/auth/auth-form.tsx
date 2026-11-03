"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode, google, next, notice }: { mode: "login" | "signup"; google: boolean; next: string; notice?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";
  const otherHref = `${signup ? "/login" : "/signup"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    const res = signup
      ? await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "").trim() || email.split("@")[0]! })
      : await authClient.signIn.email({ email, password });
    if (res.error) {
      setPending(false);
      setError(res.error.message ?? "That didn't work. Try again.");
      return;
    }
    window.location.assign(next);
  }

  return (
    <div className="card flex flex-col gap-6 p-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-serif text-[32px] leading-tight font-[380] tracking-[-0.02em]">{signup ? "Create your account" : "Log in"}</h1>
        <p className="m-0 text-sm text-muted">{signup ? "Your first scan is free." : "Welcome back."}</p>
      </div>
      {notice && <p className="m-0 rounded-lg bg-sub px-3 py-2.5 text-sm text-ink-2">{notice}</p>}
      {google && (
        <>
          <button
            type="button"
            className="btn w-full"
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
          >
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-divide" />
            or
            <span className="h-px flex-1 bg-divide" />
          </div>
        </>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {signup && (
          <label className="flex flex-col gap-1.5">
            <span className="label">Name</span>
            <input name="name" className="field" autoComplete="name" />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="label">Email</span>
          <input name="email" type="email" required className="field" autoComplete="email" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between">
            <span className="label">Password</span>
            {!signup && (
              <Link href="/forgot-password" className="text-[13px] text-muted">
                Forgot it?
              </Link>
            )}
          </span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            className="field"
            autoComplete={signup ? "new-password" : "current-password"}
          />
        </label>
        {error && (
          <p role="alert" className="m-0 text-sm text-bad">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? "One moment…" : signup ? "Create account" : "Log in"}
        </button>
      </form>
      <p className="m-0 text-center text-sm text-muted">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={otherHref} className="font-medium text-ink">
          {signup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
