"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const newPassword = String(new FormData(e.currentTarget).get("password") ?? "");
    const res = await authClient.resetPassword({ newPassword, token });
    if (res.error) {
      setPending(false);
      setError(res.error.message ?? "That didn't work.");
      return;
    }
    window.location.assign("/login?reset=1");
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4 p-7">
      <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Choose a new password</h1>
      <label className="flex flex-col gap-1.5">
        <span className="label">New password</span>
        <input name="password" type="password" required minLength={8} className="field" autoComplete="new-password" />
      </label>
      {error && <p className="m-0 text-sm text-bad">{error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>
        Save password
      </button>
    </form>
  );
}
