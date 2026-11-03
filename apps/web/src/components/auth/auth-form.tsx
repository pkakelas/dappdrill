"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{signup ? "Create your account" : "Log in"}</CardTitle>
        <CardDescription>{signup ? "Your first scan is free." : "Welcome back."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {notice && <p className="rounded-md bg-muted px-3 py-2">{notice}</p>}
        {google && (
          <>
            <Button type="button" variant="outline" className="w-full" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}>
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {signup && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">Password</Label>
              {!signup && (
                <Link href="/forgot-password" className="text-xs text-muted-foreground hover:underline">
                  Forgot it?
                </Link>
              )}
            </div>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete={signup ? "new-password" : "current-password"} />
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "One moment…" : signup ? "Create account" : "Log in"}
          </Button>
        </form>
        <p className="text-center text-muted-foreground">
          {signup ? "Already have an account? " : "New here? "}
          <Link href={otherHref} className="font-medium text-foreground underline-offset-4 hover:underline">
            {signup ? "Log in" : "Create an account"}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
