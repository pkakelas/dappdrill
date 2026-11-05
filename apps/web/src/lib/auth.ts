import "server-only";
import { account, db, invitation, member, organization, session, user, verification } from "@dappdrill/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization as organizations } from "better-auth/plugins/organization";
import { sendEmail } from "./email";
import { env } from "./env";
import { INVITE_DAYS, personalOrgName, provisionOrganization, stopOrganizationJobs } from "./organizations";

export const auth = betterAuth({
  baseURL: env.appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db(), { provider: "pg", schema: { user, session, account, verification, organization, member, invitation } }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your DappDrill password",
        text: `Someone asked to reset the password for ${user.email}.\n\nSet a new one here: ${url}\n\nIf it wasn't you, ignore this email.`,
      });
    },
  },
  socialProviders: env.googleEnabled
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } }
    : {},
  databaseHooks: {
    // Everyone starts with an organization of their own, invited or not.
    user: { create: { after: async (u) => void (await provisionOrganization(u.id, personalOrgName(u))) } },
  },
  plugins: [
    // Members, invites and roles (owner, admin, member). Its routes under /api/auth/organization are
    // open to anyone signed in, so anything that must always happen lives in the hooks here, not in
    // our server actions.
    organizations({
      // Organizations are only made by provisionOrganization, which also creates the test wallets.
      allowUserToCreateOrganization: false,
      invitationExpiresIn: INVITE_DAYS * 24 * 60 * 60,
      // Inviting the same email again replaces the old invite (new link, new role).
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async ({ id, email, organization, inviter }) => {
        const who = inviter.user.name || inviter.user.email;
        await sendEmail({
          to: email,
          subject: `${who} invited you to ${organization.name} on DappDrill`,
          text: `${who} invited you to join ${organization.name} on DappDrill.\n\nAccept the invite: ${env.appUrl}/invite/${id}\n\nThe link works for ${INVITE_DAYS} days, for ${email} only.\n`,
        });
      },
      organizationHooks: {
        beforeDeleteOrganization: async ({ organization }) => stopOrganizationJobs(organization.id),
      },
    }),
    nextCookies(),
  ],
});
