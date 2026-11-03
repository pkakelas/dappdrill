import nodemailer from "nodemailer";
import { alertText, slackPayload, type Alert } from "./compose.js";
import { logger } from "../log.js";

const log = logger("notify");

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Slack incoming webhook; the secret is the webhook URL. */
export function sendSlack(webhookUrl: string, alert: Alert): Promise<void> {
  return post(webhookUrl, slackPayload(alert));
}

/** Telegram bot; the secret is the bot token. TELEGRAM_API_URL overrides the API host (tests). */
export function sendTelegram(botToken: string, chatId: string, alert: Alert): Promise<void> {
  const base = process.env.TELEGRAM_API_URL ?? "https://api.telegram.org";
  return post(`${base}/bot${botToken}/sendMessage`, { chat_id: chatId, text: alertText(alert), disable_web_page_preview: true });
}

/** Email over SMTP_URL; without it the message is logged instead. */
export async function sendEmail(to: string[], alert: Alert, body: string): Promise<void> {
  const text = `${alertText(alert)}\n\n${body}`;
  if (!process.env.SMTP_URL) {
    log.info(`SMTP_URL not set; email to ${to.join(", ")} would say:\n${text}`);
    return;
  }
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.EMAIL_FROM ?? "DappDrill <alerts@dappdrill.com>", to, subject: alert.title, text });
}
