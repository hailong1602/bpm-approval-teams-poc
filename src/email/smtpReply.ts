import nodemailer from "nodemailer";
import { config } from "../config";
import { fetchExchangeOAuthToken } from "./oauthToken";

/**
 * Sends the "Subject không đúng" auto-reply. Built fresh per call (not a
 * cached transporter) since oauth2 mode needs a just-fetched access token —
 * same reasoning as the IMAP client being recreated on reconnect.
 */
async function buildTransport() {
  const auth =
    config.mailbox.authMode === "oauth2"
      ? { type: "OAuth2" as const, user: config.mailbox.user, accessToken: await fetchExchangeOAuthToken() }
      : { user: config.mailbox.user, pass: config.mailbox.password };

  return nodemailer.createTransport({
    host: config.mailbox.smtpHost,
    port: config.mailbox.smtpPort,
    secure: false, // port 587 uses STARTTLS, not implicit TLS
    requireTLS: true,
    auth,
  });
}

export async function sendWrongSubjectReply(
  toAddress: string,
  originalSubject: string,
  originalMessageId?: string
): Promise<void> {
  try {
    const transport = await buildTransport();
    await transport.sendMail({
      from: config.mailbox.user,
      to: toAddress,
      subject: `Re: ${originalSubject || "(no subject)"}`,
      text: config.emailWrongSubjectReply,
      inReplyTo: originalMessageId,
      references: originalMessageId ? [originalMessageId] : undefined,
    });
    console.log(`[email] Đã tự động reply "Subject không đúng" tới ${toAddress}`);
  } catch (err) {
    console.error(`[email] Gửi reply tự động thất bại (tới ${toAddress}):`, err);
  }
}
