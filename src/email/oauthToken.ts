import { config } from "../config";

/**
 * OAuth2 client-credentials grant against Entra ID, scoped for Exchange
 * Online's legacy IMAP/SMTP protocols. This is what replaces "username +
 * app password" for M365 mailboxes, since Basic Auth is disabled there. The
 * same token/scope works for both — what differs is which application
 * permission (IMAP.AccessAsApp vs SMTP.SendAsApp) the app registration was
 * granted, and which Exchange-side permission (FullAccess vs SendAs) the
 * service principal has on the target mailbox. See README.md.
 */
export async function fetchExchangeOAuthToken(): Promise<string> {
  const { oauthTenantId, oauthClientId, oauthClientSecret } = config.mailbox;
  if (!oauthTenantId || !oauthClientId || !oauthClientSecret) {
    throw new Error(
      "Thiếu oauthTenantId/oauthClientId/oauthClientSecret — cần MAILBOX_OAUTH_* hoặc " +
        "MicrosoftAppId/Password/TenantId trong .env khi MAILBOX_AUTH_MODE=oauth2."
    );
  }

  const url = `https://login.microsoftonline.com/${oauthTenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    grant_type: "client_credentials",
    // Fixed resource for Exchange Online IMAP/POP/SMTP OAuth — not a typo,
    // this is the exact scope Microsoft's docs specify for this flow.
    scope: "https://outlook.office365.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Không lấy được access token IMAP OAuth2: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Phản hồi token không có access_token.");
  return json.access_token;
}
