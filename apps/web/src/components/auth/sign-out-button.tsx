"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton({ next = "/login", children = "Log out" }: { next?: string; children?: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        await authClient.signOut();
        window.location.assign(next);
      }}
    >
      {children}
    </Button>
  );
}
