import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(__dirname, "..", "..", "data");
const FILE = join(DATA_DIR, "email-listener-state.json");

/**
 * Remembers the last IMAP UID processed, so restarting the server doesn't
 * re-scan the whole mailbox from the beginning (and doesn't skip mail that
 * arrived while the server was down).
 */
export function loadLastSeenUid(): number | undefined {
  if (!existsSync(FILE)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf-8"));
    return typeof raw.lastSeenUid === "number" ? raw.lastSeenUid : undefined;
  } catch {
    return undefined;
  }
}

export function saveLastSeenUid(uid: number): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({ lastSeenUid: uid }, null, 2));
}
