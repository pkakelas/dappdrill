import { cookies } from "next/headers";
import { switchOrgAction } from "@/actions/organization";
import { Header } from "@/components/shell/header";
import { hostFromUrl } from "@/lib/format";
import { currentOrg, orgApps } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, org, all } = await currentOrg();
  const apps = await orgApps(org.id);
  const shellApps = apps.map((a) => ({ id: a.id, name: a.name, host: hostFromUrl(a.url) }));
  const lastAppId = (await cookies()).get("dd_app")?.value;

  return (
    <>
      <Header
        apps={shellApps}
        lastAppId={lastAppId}
        user={{ name: user.name, email: user.email }}
        org={{ id: org.id, name: org.name }}
        orgs={all.map((m) => ({ id: m.org.id, name: m.org.name }))}
        switchOrg={switchOrgAction}
      />
      <main>{children}</main>
    </>
  );
}
