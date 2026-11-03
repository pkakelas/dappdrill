import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentTeam, getSession, teamApps } from "@/lib/session";

/** Sends people to the app they looked at last (dd_app cookie), else the team's first app, else /new. */
export default async function Home() {
  if (!(await getSession())) redirect("/login");
  const { team } = await currentTeam();
  const apps = await teamApps(team.id);
  const last = (await cookies()).get("dd_app")?.value;
  const app = apps.find((a) => a.id === last) ?? apps[0];
  redirect(app ? `/apps/${app.id}` : "/new");
}
