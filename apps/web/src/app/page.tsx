import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentOrg, getSession, orgApps } from "@/lib/session";

/** Sends people to the app they looked at last (dd_app cookie), else the organization's first app, else /new. */
export default async function Home() {
  if (!(await getSession())) redirect("/login");
  const { org } = await currentOrg();
  const apps = await orgApps(org.id);
  const last = (await cookies()).get("dd_app")?.value;
  const app = apps.find((a) => a.id === last) ?? apps[0];
  redirect(app ? `/apps/${app.id}` : "/new");
}
