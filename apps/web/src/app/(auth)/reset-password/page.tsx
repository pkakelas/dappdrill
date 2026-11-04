import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/auth/reset-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">This reset link doesn&apos;t work</CardTitle>
          <CardDescription>It may have expired. Ask for a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/forgot-password">Send a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <ResetForm token={token} />;
}
