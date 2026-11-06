"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    // Whether the email has an account is never said. Only a request that didn't get through is.
    try {
      const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
      if (res.error && (res.error.status === 429 || res.error.status >= 500)) throw new Error();
      setSent(true);
    } catch {
      setError("Couldn't send the link. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sent ? (
          <p>If that email has an account, a reset link is on its way.</p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            {error && (
              <p role="alert" className="text-sm text-bad">
                {error}
              </p>
            )}
            <Button className="w-full" disabled={pending}>
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <Link href="/login" className="w-fit text-muted-foreground hover:underline">
          Back to log in
        </Link>
      </CardContent>
    </Card>
  );
}
