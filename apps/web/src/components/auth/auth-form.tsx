"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, FormMessage, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { AuthCard } from "./auth-card";

export function AuthForm({ mode, google, next, notice }: { mode: "login" | "signup"; google: boolean; next: string; notice?: string }) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";
  const otherHref = `${signup ? "/login" : "/signup"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(undefined);
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
    <AuthCard title={signup ? "Create your account" : "Log in"} sub={signup ? "Your first scan is free." : "Welcome back."}>
      {notice && <Notice role="status">{notice}</Notice>}
      {google && (
        <>
          <button type="button" className="btn w-full" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}>
            Continue with Google
          </button>
          <div className="flex items-center gap-3 font-mono text-2xs tracking-[0.1em] text-muted uppercase">
            <span className="h-px flex-1 bg-divide" />
            or
            <span className="h-px flex-1 bg-divide" />
          </div>
        </>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={pending}>
        {signup && (
          <Field label="Name">
            <input name="name" className="field" autoComplete="name" />
          </Field>
        )}
        <Field label="Email">
          <input name="email" type="email" required className="field" autoComplete="email" />
        </Field>
        <Field
          label="Password"
          hint={signup ? "At least 8 characters." : undefined}
          aside={
            !signup && (
              <Link href="/forgot-password" className="text-meta text-muted">
                Forgot it?
              </Link>
            )
          }
        >
          <input name="password" type="password" required minLength={8} className="field" autoComplete={signup ? "new-password" : "current-password"} aria-invalid={error ? true : undefined} />
        </Field>
        <FormMessage state={{ error }} />
        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={pending} aria-busy={pending || undefined}>
          {pending ? "One moment…" : signup ? "Create account" : "Log in"}
        </button>
      </form>
      <p className="m-0 text-center text-body text-muted">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={otherHref} className="font-medium text-ink">
          {signup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </AuthCard>
  );
}
