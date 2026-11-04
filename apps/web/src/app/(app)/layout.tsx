import { cookies } from "next/headers";
import { switchTeam } from "@/actions/team";
import { Header } from "@/components/shell/header";
import { hostFromUrl } from "@/lib/format";
import { currentTeam, teamApps } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, team, all } = await currentTeam();
  const apps = await teamApps(team.id);
  const shellApps = apps.map((a) => ({ id: a.id, name: a.name, host: hostFromUrl(a.url) }));
  const lastAppId = (await cookies()).get("dd_app")?.value;

  return (
    <>
      <Header
        apps={shellApps}
        lastAppId={lastAppId}
        user={{ name: user.name, email: user.email }}
        team={{ id: team.id, name: team.name }}
        teams={all.map((m) => ({ id: m.team.id, name: m.team.name }))}
        switchTeam={switchTeam}
      />
      <main>{children}</main>
    </>
  );
}
