import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { config } from "../config";
import { taskStore } from "../bpm/store";
import { loadLastSeenUid, saveLastSeenUid } from "./state";
import { fetchExchangeOAuthToken } from "./oauthToken";
import { sendWrongSubjectReply } from "./smtpReply";

const EMAIL_DIR = join(__dirname, "..", "..", "data", "emails");

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetches everything since `lastUid`, and for each message that matches the
 * configured sender allowlist + exact subject, saves the raw .eml and creates
 * a task from it. Returns the highest UID seen, so the caller can persist it.
 */
interface Candidate {
  uid: number;
  subject: string;
  fromAddress: string;
  fromName: string;
  messageId?: string;
}

async function pollOnce(client: ImapFlow, lastUid: number): Promise<number> {
  const lock = await client.getMailboxLock("INBOX");
  let newLastUid = lastUid;
  try {
    // Fetch by sequence range "1:*" (unambiguous — always 1..messageCount),
    // NOT by UID range "lastUid+1:*". A UID range whose lower bound exceeds
    // every existing UID does not reliably come back empty on every server —
    // some resolve "*" to the highest UID and then normalize a now-inverted
    // range by swapping the bounds, silently re-returning already-seen mail.
    // Filtering by `message.uid > lastUid` in JS afterward has no such quirk.
    const candidates: Candidate[] = [];
    for await (const message of client.fetch("1:*", { envelope: true, uid: true })) {
      if (message.uid > newLastUid) newLastUid = message.uid;
      if (message.uid <= lastUid) continue;

      candidates.push({
        uid: message.uid,
        subject: (message.envelope?.subject || "").trim(),
        fromAddress: (message.envelope?.from?.[0]?.address || "").toLowerCase(),
        fromName: message.envelope?.from?.[0]?.name || message.envelope?.from?.[0]?.address || "",
        messageId: message.envelope?.messageId,
      });
    }

    for (const c of candidates) {
      const subjectMatches = c.subject === config.emailTaskSubject;
      const senderAllowed = config.emailAllowedSenders.includes(c.fromAddress);

      if (!subjectMatches || !senderAllowed) {
        console.log(
          `[email] Bỏ qua UID ${c.uid} — subject="${c.subject}" from=${c.fromAddress} ` +
            `(subjectMatches=${subjectMatches}, senderAllowed=${senderAllowed})`
        );
        // Only auto-reply to senders we already trust — replying to an
        // arbitrary/unknown sender just confirms this mailbox is alive and
        // being processed automatically, which isn't something to leak to
        // whoever happens to email it.
        if (senderAllowed && !subjectMatches) {
          sendWrongSubjectReply(c.fromAddress, c.subject, c.messageId).catch((err) =>
            console.error("[email] sendWrongSubjectReply threw:", err)
          );
        }
        continue;
      }

      // Explicit UID list (not a range) for the heavier fetch — same reason
      // as above, avoids any range-normalization ambiguity.
      for await (const full of client.fetch([c.uid], { source: true }, { uid: true })) {
        if (!full.source) continue;

        if (!existsSync(EMAIL_DIR)) mkdirSync(EMAIL_DIR, { recursive: true });
        const emlFilename = `${Date.now()}-${randomUUID().slice(0, 8)}.eml`;
        writeFileSync(join(EMAIL_DIR, emlFilename), full.source);

        const parsed = await simpleParser(full.source);
        const detail =
          parsed.text?.trim() ||
          (parsed.html ? stripHtml(parsed.html) : "") ||
          "(Email không có nội dung text)";

        const task = taskStore.create(
          c.subject,
          c.fromName,
          config.assigneeEmail,
          detail,
          `data/emails/${emlFilename}`
        );
        console.log(`[email] Tạo task ${task.id} từ email UID ${c.uid} (người gửi: ${c.fromAddress})`);
      }
    }
  } finally {
    lock.release();
  }
  return newLastUid;
}

/**
 * Builds a fresh ImapFlow client (and, for oauth2 mode, a fresh access
 * token — client-credentials tokens expire, typically after an hour, so
 * this is called on every (re)connect rather than once at startup).
 */
async function createClient(): Promise<ImapFlow> {
  const auth =
    config.mailbox.authMode === "oauth2"
      ? { user: config.mailbox.user, accessToken: await fetchExchangeOAuthToken() }
      : { user: config.mailbox.user, pass: config.mailbox.password };

  const client = new ImapFlow({
    host: config.mailbox.host,
    port: config.mailbox.port,
    secure: config.mailbox.secure,
    auth,
    logger: false,
  });

  // ImapFlow emits 'error' on the underlying socket (e.g. ECONNRESET after
  // the connection sits idle for a while) as a plain EventEmitter event. With
  // no listener, Node's default behavior is to throw and crash the whole
  // process — this is what actually happened (server died silently days ago
  // while the unrelated ngrok process kept running). loop()'s own
  // `!client.usable` check already reconnects on the next tick, so all this
  // needs to do is stop the crash.
  client.on("error", (err) => {
    console.error("[email] Lỗi kết nối IMAP (sẽ tự kết nối lại ở lần poll sau):", err);
  });

  return client;
}

export function startEmailListener(): void {
  if (!config.mailbox.user) {
    console.log("[email] MAILBOX_USER chưa cấu hình — bỏ qua tính năng tạo task từ email.");
    return;
  }

  let lastUid = loadLastSeenUid();
  let client: ImapFlow | null = null;

  async function loop() {
    try {
      if (!client || !client.usable) {
        client = await createClient();
        await client.connect();
        console.log(
          `[email] Đã kết nối IMAP (${config.mailbox.authMode}) tới ${config.mailbox.host} (${config.mailbox.user})`
        );
      }

      if (lastUid === undefined) {
        // First run ever: start watching from "now" — ignore whatever is
        // already sitting in the mailbox, only react to new arrivals.
        const status = await client.status("INBOX", { uidNext: true });
        lastUid = (status.uidNext || 1) - 1;
        saveLastSeenUid(lastUid);
        console.log(`[email] Bắt đầu theo dõi hộp thư từ UID ${lastUid + 1} trở đi.`);
      }

      const newLastUid = await pollOnce(client, lastUid);
      if (newLastUid !== lastUid) {
        lastUid = newLastUid;
        saveLastSeenUid(lastUid);
      }
    } catch (err) {
      console.error("[email] Lỗi khi kiểm tra hộp thư, sẽ thử lại ở lần sau:", err);
      // Force a fresh connection (and, in oauth2 mode, a fresh token) next time.
      client = null;
    } finally {
      setTimeout(loop, config.mailbox.pollIntervalMs);
    }
  }

  loop();
}
