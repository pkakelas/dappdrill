import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/auth/reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <div className="card flex flex-col gap-3 p-7">
        <h1 className="m-0 font-serif text-[32px] leading-tight font-[380] tracking-[-0.02em]">This reset link doesn't work</h1>
        <p className="m-0 text-sm text-muted">It may have expired. Ask for a new one.</p>
        <Link href="/forgot-password" className="btn btn-primary self-start">
          Send a new link
        </Link>
      </div>
    );
  }
  return <ResetForm token={token} />;
}
