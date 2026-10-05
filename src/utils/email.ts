import nodemailer from "nodemailer";

// A placeholder-safe default, same discipline as GOOGLE_CLIENT_ID and the
// VAPID keys the app starts and every other feature works with these
// unset; email sending just quietly no-ops (with a console warning) until
// real Gmail credentials are provided.
//
// GMAIL_USER must be a real Gmail address. GMAIL_APP_PASSWORD is NOT your
// normal Gmail password Gmail blocks plain-password SMTP login outright.
// You need an "App Password": Google Account -> Security -> 2-Step
// Verification (must be turned on) -> App passwords -> generate one for
// "Mail". It's a 16-character code; paste it in as-is (spaces are fine).
const GMAIL_USER = process.env.GMAIL_USER ?? "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD ?? "";
const IS_CONFIGURED = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);

const transporter = IS_CONFIGURED
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
  : null;

export function isEmailConfigured(): boolean {
  return IS_CONFIGURED;
}

/** Where email links should point reuses CORS_ORIGIN since that's already
 * the deployed frontend's real URL, with no separate env var to keep in sync. */
export function getFrontendUrl(): string {
  return process.env.CORS_ORIGIN ?? "https://kwegereza.org";
}

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/** Never throws a failed/unconfigured email should never break the
 * request that triggered it (approving a student, starting a class). */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<{ sent: boolean }> {
  if (!transporter) {
    console.warn(`[email] GMAIL_USER/GMAIL_APP_PASSWORD not set skipped "${subject}" to ${to}`);
    return { sent: false };
  }
  try {
    await transporter.sendMail({
      from: `"Kwegereza" <${GMAIL_USER}>`,
      to,
      subject,
      html,
      text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    });
    return { sent: true };
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, err);
    return { sent: false };
  }
}

/**
 * Sends to a whole list of addresses without blocking on all of them at
 * once Gmail's SMTP connection (and its ~500/day sending limit on a
 * regular, non-Workspace account) doesn't handle a burst of hundreds of
 * simultaneous sends gracefully. Small batches with a short pause between
 * them is friendlier to Gmail and much less likely to get the sending
 * account temporarily flagged/throttled.
 */
export async function sendEmailBatch(
  recipients: string[],
  build: (to: string) => SendEmailInput
): Promise<{ sent: number; skipped: number }> {
  if (!transporter) {
    console.warn(`[email] GMAIL_USER/GMAIL_APP_PASSWORD not set skipped batch of ${recipients.length}`);
    return { sent: 0, skipped: recipients.length };
  }

  const BATCH_SIZE = 10;
  const PAUSE_MS = 1000;
  let sent = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((to) => sendEmail(build(to))));
    sent += results.filter((r) => r.sent).length;
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
  }

  return { sent, skipped: recipients.length - sent };
}
