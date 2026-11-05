import type { Metadata } from "next";
import Link from "next/link";
import { createOrgAction } from "@/actions/organization";
import { ActionForm } from "@/components/action-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { memberships, requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Create an organization" };

/** Also where people land when they belong to no organization (they left or deleted their last one). */
export default async function NewOrganizationPage() {
  const user = await requireUser();
  const none = (await memberships(user.id)).length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create an organization</CardTitle>
        <CardDescription>
          {none
            ? "You're not in an organization right now. Create one, or open an invite link from a teammate."
            : "An organization has its own apps, tests, test wallets and people. You can invite teammates once it exists."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={createOrgAction}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={60} placeholder="Acme Labs" autoComplete="organization" autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Button type="submit">Create organization</Button>
            {none ? (
              <SignOutButton />
            ) : (
              <Button asChild variant="outline">
                <Link href="/">Cancel</Link>
              </Button>
            )}
          </div>
        </ActionForm>
        <p className="pt-4 text-sm text-muted-foreground">Signed in as {user.email}.</p>
      </CardContent>
    </Card>
  );
}
