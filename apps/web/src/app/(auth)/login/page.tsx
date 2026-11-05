import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthHowItWorks } from "@/components/how-it-works";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  if (await getSession()) redirect(safeNext(next));
  return (
    <>
      <AuthForm mode="login" google={env.googleEnabled} next={safeNext(next)} notice={reset ? "Password changed. Log in with the new one." : undefined} />
      <AuthHowItWorks />
    </>
  );
}
