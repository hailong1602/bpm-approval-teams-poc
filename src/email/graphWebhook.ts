import type { Request, Response as ExpressResponse } from "express";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { config } from "../config";
import { taskStore } from "../bpm/store";

const EMAIL_DIR = join(__dirname, "..", "..", "data", "emails");
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Well under the 7-day (10,080 min) max for a "message" resource subscription
// — short enough that missing one renewal cycle isn't catastrophic, long
// enough that we're not re-subscribing constantly.
const SUBSCRIPTION_LIFETIME_MS = 2 * 24 * 60 * 60 * 1000;
const RENEW_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

let currentSubscriptionId: string | null = null;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchGraphToken(): Promise<string> {
  const { oauthTenantId, oauthClientId, oauthClientSecret } = config.mailbox;
  if (!oauthTenantId || !oauthClientId || !oauthClientSecret) {
    throw new Error(
      "Thiếu oauthTenantId/oauthClientId/oauthClientSecret cho Graph — cần MicrosoftAppId/Password/TenantId (hoặc MAILBOX_OAUTH_*) trong .env."
    );
  }
  const url = `https://login.microsoftonline.com/${oauthTenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Không lấy được Graph access token: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Phản hồi token Graph không có access_token.");
  return json.access_token;
}

async function graphFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
}

/**
 * Creates the subscription on first run, renews it (extends expirationDateTime)
 * on subsequent calls. If a renewal is rejected (e.g. the subscription already
 * expired), falls back to creating a fresh one.
 */
export async function createOrRenewSubscription(): Promise<void> {
  const token = await fetchGraphToken();
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString();

  if (currentSubscriptionId) {
    const renewRes = await graphFetch(`/subscriptions/${currentSubscriptionId}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expirationDateTime }),
    });
    if (renewRes.ok) {
      console.log(`[graph] Đã gia hạn subscription ${currentSubscriptionId} tới ${expirationDateTime}`);
      return;
    }
    console.warn(`[graph] Gia hạn thất bại (HTTP ${renewRes.status}) — tạo subscription mới.`);
    currentSubscriptionId = null;
  }

  const createRes = await graphFetch("/subscriptions", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: config.graphNotificationUrl,
      resource: `/users/${config.mailbox.user}/mailFolders('inbox')/messages`,
      expirationDateTime,
      clientState: config.graphClientState,
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Tạo Graph subscription thất bại: ${createRes.status} ${await createRes.text()}`);
  }
  const sub = (await createRes.json()) as { id: string };
  currentSubscriptionId = sub.id;
  console.log(
    `[graph] Đã tạo subscription ${sub.id} — theo dõi hộp thư ${config.mailbox.user}, hết hạn ${expirationDateTime}`
  );
}

export function startGraphWebhook(): void {
  if (!config.mailbox.user || !config.graphNotificationUrl) {
    console.log(
      "[graph] MAILBOX_USER hoặc GRAPH_NOTIFICATION_URL chưa cấu hình — bỏ qua Graph webhook."
    );
    return;
  }

  createOrRenewSubscription().catch((err) => console.error("[graph] Lỗi tạo subscription ban đầu:", err));
  setInterval(() => {
    createOrRenewSubscription().catch((err) => console.error("[graph] Lỗi gia hạn subscription:", err));
  }, RENEW_CHECK_INTERVAL_MS);
}

/**
 * Handles the one-time handshake Graph performs right when a subscription is
 * created: it POSTs ?validationToken=... to notificationUrl and expects that
 * exact token echoed back as plain text within 10 seconds. Returns true if
 * this request WAS a validation request (caller should stop, already responded).
 */
export function handleValidation(req: Request, res: ExpressResponse): boolean {
  const token = req.query.validationToken;
  if (typeof token === "string") {
    res.status(200).set("Content-Type", "text/plain").send(token);
    return true;
  }
  return false;
}

interface GraphNotification {
  clientState?: string;
  resourceData?: { id?: string };
}

/**
 * Handles real change notifications. Per Graph's contract, must ACK within 3
 * seconds with a 2xx or risk retries/throttling — so this responds first and
 * does the actual (slower) message fetch + task creation afterward.
 */
export async function handleNotification(req: Request, res: ExpressResponse): Promise<void> {
  res.status(202).send();

  const notifications = (req.body?.value || []) as GraphNotification[];
  for (const note of notifications) {
    if (note.clientState !== config.graphClientState) {
      console.warn("[graph] clientState không khớp — bỏ qua (có thể không phải Graph thật gửi tới).");
      continue;
    }
    const messageId = note.resourceData?.id;
    if (!messageId) continue;

    processMessage(messageId).catch((err) => console.error(`[graph] Lỗi xử lý message ${messageId}:`, err));
  }
}

async function processMessage(messageId: string): Promise<void> {
  const token = await fetchGraphToken();
  const userPath = `/users/${config.mailbox.user}`;

  const msgRes = await graphFetch(`${userPath}/messages/${messageId}?$select=subject,from,body`, token);
  if (!msgRes.ok) {
    console.error(`[graph] Không lấy được message ${messageId}: HTTP ${msgRes.status}`);
    return;
  }
  const msg = (await msgRes.json()) as {
    subject?: string;
    from?: { emailAddress?: { address?: string; name?: string } };
    body?: { content?: string; contentType?: string };
  };

  const subject = (msg.subject || "").trim();
  const fromAddress = (msg.from?.emailAddress?.address || "").toLowerCase();
  const fromName = msg.from?.emailAddress?.name || fromAddress;

  const subjectMatches = subject === config.emailTaskSubject;
  const senderAllowed = config.emailAllowedSenders.includes(fromAddress);

  if (!subjectMatches || !senderAllowed) {
    console.log(
      `[graph] Bỏ qua message ${messageId} — subject="${subject}" from=${fromAddress} ` +
        `(subjectMatches=${subjectMatches}, senderAllowed=${senderAllowed})`
    );
    return;
  }

  // Raw MIME via $value — same reason as the IMAP path: keeps attachments
  // embedded in one self-contained .eml instead of downloading them separately.
  const rawRes = await graphFetch(`${userPath}/messages/${messageId}/$value`, token);
  if (!rawRes.ok) {
    console.error(`[graph] Không tải được nội dung gốc message ${messageId}: HTTP ${rawRes.status}`);
    return;
  }
  const raw = Buffer.from(await rawRes.arrayBuffer());

  if (!existsSync(EMAIL_DIR)) mkdirSync(EMAIL_DIR, { recursive: true });
  const emlFilename = `${Date.now()}-${randomUUID().slice(0, 8)}.eml`;
  writeFileSync(join(EMAIL_DIR, emlFilename), raw);

  const detail =
    (msg.body?.contentType === "text" ? msg.body.content : stripHtml(msg.body?.content || ""))?.trim() ||
    "(Email không có nội dung text)";

  const task = taskStore.create(subject, fromName, config.assigneeEmail, detail, `data/emails/${emlFilename}`);
  console.log(`[graph] Tạo task ${task.id} từ email (Graph webhook) — message ${messageId}, người gửi: ${fromAddress}`);
}
