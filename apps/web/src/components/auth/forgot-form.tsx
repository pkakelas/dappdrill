"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, Notice } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { AuthCard } from "./auth-card";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true);
  }

  return (
    <AuthCard title="Reset your password" sub={sent ? undefined : "We'll email you a link to choose a new one."}>
      {sent ? (
        <Notice role="status">If that email has an account, a reset link is on its way.</Notice>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={pending}>
          <Field label="Email">
            <input name="email" type="email" required className="field" autoComplete="email" />
          </Field>
          <button className="btn btn-primary btn-lg w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <Link href="/login" className="btn-link w-fit text-muted">
        Back to log in
      </Link>
    </AuthCard>
  );
}
