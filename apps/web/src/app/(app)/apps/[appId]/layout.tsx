import { Assistant } from "@/components/assistant";
import { requireApp } from "@/lib/session";

export default async function AppPagesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  await requireApp(appId);
  return (
    <>
      {children}
      <Assistant appId={appId} />
    </>
  );
}
