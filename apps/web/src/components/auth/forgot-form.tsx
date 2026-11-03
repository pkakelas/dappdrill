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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true);
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
            <Button className="w-full" disabled={pending}>
              Send reset link
            </Button>
          </form>
        )}
        <Link href="/login" className="text-muted-foreground hover:underline">
          Back to log in
        </Link>
      </CardContent>
    </Card>
  );
}
