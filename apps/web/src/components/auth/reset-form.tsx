"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const newPassword = String(new FormData(e.currentTarget).get("password") ?? "");
    const res = await authClient.resetPassword({ newPassword, token }).catch(() => ({ error: { message: "Couldn't save it. Check your connection and try again." } }));
    if (res.error) {
      setPending(false);
      setError(res.error.message ?? "That didn't work. Try again.");
      return;
    }
    window.location.assign("/login?reset=1");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <Button className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
