import "server-only";
import { account, db, session, user, verification } from "@dappdrill/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { sendEmail } from "./email";
import { env } from "./env";
import { provisionPersonalTeam } from "./teams";

export const auth = betterAuth({
  baseURL: env.appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db(), { provider: "pg", schema: { user, session, account, verification } }),
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
    user: { create: { after: async (u) => void (await provisionPersonalTeam(u)) } },
  },
  plugins: [nextCookies()],
});
