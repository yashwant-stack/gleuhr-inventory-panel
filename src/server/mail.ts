import "server-only";
// Email through SMTP (decided 24 Nov 2026): SMTP_HOST, SMTP_PORT (465 = SSL, else STARTTLS), SMTP_USER, SMTP_PASS,
// SMTP_FROM. Nothing is sent, and the caller is told what is missing, until all are set in Vercel.
import nodemailer from "nodemailer";

export interface Mail {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
}

export function smtpMissing(env: Record<string, string | undefined> = process.env): string[] {
  return ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"].filter((k) => !env[k]?.trim());
}

export async function sendMail(m: Mail, env: Record<string, string | undefined> = process.env): Promise<void> {
  const missing = smtpMissing(env);
  if (missing.length) throw new Error(`Email is not set up: ${missing.join(", ")} missing in Vercel`);
  const port = Number(env.SMTP_PORT) || 587;
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST!.trim(),
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER!.trim(), pass: env.SMTP_PASS! },
  });
  await t.sendMail({ from: env.SMTP_FROM!.trim(), to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject, html: m.html, text: m.text });
}

/** The panel's address for links in emails. */
export function panelUrl(env: Record<string, string | undefined> = process.env): string {
  const u = env.ALERT_PANEL_URL?.trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return u.replace(/\/+$/, "");
}
