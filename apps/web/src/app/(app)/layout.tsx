import { cookies } from "next/headers";
import { switchTeam } from "@/actions/team";
import { Header } from "@/components/shell/header";
import { env } from "@/lib/env";
import { hostFromUrl } from "@/lib/format";
import { PLANS, scansUsedThisMonth } from "@/lib/plan";
import { currentTeam, teamApps } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, team, all } = await currentTeam();
  const apps = await teamApps(team.id);
  const plan = PLANS[team.plan];
  const shellApps = await Promise.all(
    apps.map(async (a) => ({ id: a.id, name: a.name, host: hostFromUrl(a.url), scansUsed: await scansUsedThisMonth(a.id), scansLimit: plan.scansPerMonth })),
  );
  const lastAppId = (await cookies()).get("dd_app")?.value;

  return (
    <>
      <Header
        apps={shellApps}
        lastAppId={lastAppId}
        user={{ name: user.name, email: user.email }}
        team={{ id: team.id, name: team.name }}
        teams={all.map((m) => ({ id: m.team.id, name: m.team.name }))}
        planName={plan.name}
        devQuota={env.dev}
        switchTeam={switchTeam}
      />
      <main>{children}</main>
    </>
  );
}
