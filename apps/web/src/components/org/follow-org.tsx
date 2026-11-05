"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { followOrgAction } from "@/actions/organization";

/** Makes the organization of the app on screen the current one, so the header and switcher match it. */
export function FollowOrg({ orgId }: { orgId: string }) {
  const router = useRouter();
  useEffect(() => {
    void followOrgAction(orgId).then(() => router.refresh());
  }, [orgId, router]);
  return null;
}
