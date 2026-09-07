import * as dotenv from "dotenv";

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3978", 10),
  assigneeEmail: process.env.ASSIGNEE_EMAIL || "approver@cmctssg.space",
  microsoftAppId: process.env.MicrosoftAppId || "",
  microsoftAppPassword: process.env.MicrosoftAppPassword || "",
  // Empty (anonymous) until an App Id is configured, so the BPM mock screen/API
  // can be smoke-tested before an Azure Bot registration exists. Set this to
  // "SingleTenant" in .env once MicrosoftAppId/Password/TenantId are filled in.
  microsoftAppType: process.env.MicrosoftAppId ? process.env.MicrosoftAppType || "SingleTenant" : "",
  microsoftAppTenantId: process.env.MicrosoftAppTenantId || "",

  // --- Email-to-task intake (optional — listener only starts if MAILBOX_USER is set) ---
  mailbox: {
    host: process.env.MAILBOX_HOST || "",
    port: parseInt(process.env.MAILBOX_PORT || "993", 10),
    secure: (process.env.MAILBOX_SECURE ?? "true") === "true",
    user: process.env.MAILBOX_USER || "",
    pollIntervalMs: parseInt(process.env.MAILBOX_POLL_INTERVAL_MS || "10000", 10),

    // "basic"  = plain username/password (App Password) — works for Gmail.
    // "oauth2" = OAuth2 client-credentials (XOAUTH2) — required for Exchange
    //            Online/M365, which has Basic Auth for IMAP disabled.
    authMode: (process.env.MAILBOX_AUTH_MODE || "basic") as "basic" | "oauth2",
    password: process.env.MAILBOX_PASSWORD || "",

    // OAuth2 mode: defaults to reusing the Bot's own App Registration
    // (MicrosoftAppId/Password/TenantId) so there's nothing extra to
    // register if that app is also granted IMAP.AccessAsApp — override with
    // MAILBOX_OAUTH_* if you'd rather use a separate app registration.
    oauthTenantId: process.env.MAILBOX_OAUTH_TENANT_ID || process.env.MicrosoftAppTenantId || "",
    oauthClientId: process.env.MAILBOX_OAUTH_CLIENT_ID || process.env.MicrosoftAppId || "",
    oauthClientSecret: process.env.MAILBOX_OAUTH_CLIENT_SECRET || process.env.MicrosoftAppPassword || "",

    // Outbound (auto-reply). Separate host/port from IMAP — Exchange Online
    // uses a different endpoint for submission than for IMAP. Same
    // authMode/oauth credentials as above are reused (Exchange needs the
    // *additional* SMTP.SendAsApp permission + Add-RecipientPermission
    // SendAs grant — see README; Gmail's existing App Password just works
    // for SMTP too, no extra setup).
    smtpHost: process.env.MAILBOX_SMTP_HOST || "",
    smtpPort: parseInt(process.env.MAILBOX_SMTP_PORT || "587", 10),
  },
  emailTaskSubject: process.env.EMAIL_TASK_SUBJECT || "Tạo task mới cho mockBPM",
  emailAllowedSenders: (process.env.EMAIL_ALLOWED_SENDERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  emailWrongSubjectReply: "Subject không đúng, hãy kiểm tra lại",

  // "imap"  = poll the mailbox every MAILBOX_POLL_INTERVAL_MS (src/email/imapListener.ts).
  // "graph" = Microsoft Graph webhook — Microsoft pushes a notification the
  //           moment new mail arrives instead of us polling (src/email/graphWebhook.ts).
  //           M365-only; reuses the same MicrosoftAppId/Password/TenantId, but
  //           needs the Graph "Mail.Read" application permission instead of
  //           the legacy Exchange IMAP.AccessAsApp — see README.
  emailIntakeMode: (process.env.EMAIL_INTAKE_MODE || "imap") as "imap" | "graph",
  // Full public URL Microsoft Graph will POST notifications to — must be the
  // current ngrok/tunnel domain + "/graph/notifications". Changes whenever
  // the tunnel restarts, same caveat as the Bot's messaging endpoint.
  graphNotificationUrl: process.env.GRAPH_NOTIFICATION_URL || "",
  // Shared secret Graph echoes back on every notification so we can tell a
  // genuine Graph callback from a forged POST to this public endpoint.
  graphClientState: process.env.GRAPH_CLIENT_STATE || "approve-on-msteam-graph-demo",

  // --- Power Automate integration ---
  // Shared secret required (via the `x-api-key` header) on the two endpoints
  // Power Automate flows call from outside (POST /bpm/tasks and
  // POST /bpm/tasks/:id/actions), since those are now reachable over the
  // public tunnel instead of only from in-process code. Empty = check
  // disabled (same open behavior as before), same on/off-by-empty-value
  // convention as mailbox.user / graphNotificationUrl above.
  bpmApiKey: process.env.BPM_API_KEY || "",
  // HTTP trigger URL of the Power Automate flow that posts the Teams
  // Adaptive Card and waits for a decision ("Flow B" — see
  // docs/power-automate-flows.md). Power Automate generates this URL only
  // after the flow is saved once, so it's filled in after that flow exists.
  // Empty = no flow wired up yet, task:created is a no-op (see server.ts).
  powerAutomateTaskCreatedUrl: process.env.POWER_AUTOMATE_TASK_CREATED_URL || "",
};
