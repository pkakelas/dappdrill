import { Assistant } from "@/components/assistant";
import { FollowOrg } from "@/components/org/follow-org";
import { currentOrg, requireApp } from "@/lib/session";

export default async function AppPagesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const { app } = await requireApp(appId);
  const { org } = await currentOrg();
  return (
    <>
      {/* A link (an alert, a teammate's message) can open an app in another of the user's organizations. */}
      {app.organizationId !== org.id && <FollowOrg orgId={app.organizationId} />}
      {children}
      <Assistant appId={appId} />
    </>
  );
}
