"use client";

import { useState } from "react";
import { Field, FormMessage } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { AuthCard } from "./auth-card";

export function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState<string>();
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
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={pending}>
        <Field label="New password" hint="At least 8 characters.">
          <input name="password" type="password" required minLength={8} className="field" autoComplete="new-password" aria-invalid={error ? true : undefined} />
        </Field>
        <FormMessage state={{ error }} />
        <button className="btn btn-primary btn-lg w-full" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </button>
      </form>
    </AuthCard>
  );
}
