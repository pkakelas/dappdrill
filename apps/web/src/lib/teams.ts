import "server-only";
import { db, encrypt, teamMembers, teams, testWallets } from "@dappdrill/db";
import { newId } from "@dappdrill/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** Every new user gets a personal team they own, with test accounts A and B. */
export async function provisionPersonalTeam(user: { id: string; name: string; email: string }): Promise<string> {
  const teamId = newId("team");
  const first = user.name.trim().split(/\s+/)[0] || user.email.split("@")[0];
  const a = generatePrivateKey();
  const b = generatePrivateKey();
  await db().transaction(async (tx) => {
    await tx.insert(teams).values({ id: teamId, name: `${first}'s team`, plan: "builder" });
    await tx.insert(teamMembers).values({ teamId, userId: user.id, role: "owner" });
    await tx.insert(testWallets).values({
      teamId,
      accountAKeyEnc: encrypt(a),
      accountAAddress: privateKeyToAccount(a).address,
      accountBKeyEnc: encrypt(b),
      accountBAddress: privateKeyToAccount(b).address,
    });
  });
  return teamId;
}
