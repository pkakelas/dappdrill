import "server-only";
import { createTransport } from "nodemailer";

let transport: ReturnType<typeof createTransport> | undefined;

/** Sends through SMTP_URL; without it the email is printed to the server console. */
export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<void> {
  const url = process.env.SMTP_URL;
  if (!url) {
    console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    return;
  }
  transport ??= createTransport(url);
  await transport.sendMail({ from: process.env.EMAIL_FROM ?? "DappDrill <alerts@dappdrill.com>", ...msg });
}
