"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

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
    <div className="card flex flex-col gap-5 p-7">
      <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Reset your password</h1>
      {sent ? (
        <p className="m-0 text-sm text-ink-2">If that email has an account, a reset link is on its way.</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="label">Email</span>
            <input name="email" type="email" required className="field" autoComplete="email" />
          </label>
          <button className="btn btn-primary w-full" disabled={pending}>
            Send reset link
          </button>
        </form>
      )}
      <Link href="/login" className="text-sm text-muted">
        Back to log in
      </Link>
    </div>
  );
}
