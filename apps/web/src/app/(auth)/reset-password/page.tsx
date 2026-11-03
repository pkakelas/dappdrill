import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetForm } from "@/components/auth/reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <AuthCard title="This reset link doesn't work" sub="It may have expired. Ask for a new one.">
        <Link href="/forgot-password" className="btn btn-primary self-start">
          Send a new link
        </Link>
      </AuthCard>
    );
  }
  return <ResetForm token={token} />;
}
