import { redirect } from "next/navigation";

/** The old address of the organization's settings. */
export default function AccountPage() {
  redirect("/organization");
}
