import { ConversationReference } from "botbuilder";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(__dirname, "..", "..", "data");
const FILE = join(DATA_DIR, "conversation-references.json");

/**
 * Maps assignee email -> conversation reference captured when the user
 * installs/messages the bot in Teams. This is what lets the server send a
 * *proactive* message later (i.e. not in response to a user message), which
 * is what "task đến -> tin nhắn xuất hiện trên Teams" requires.
 *
 * This spike only ever has one assignee, but it's keyed by email so the
 * pattern extends to real BPM users without a redesign.
 */
class ConversationStore {
  private byEmail = new Map<string, Partial<ConversationReference>>();

  constructor() {
    if (existsSync(FILE)) {
      try {
        const raw = JSON.parse(readFileSync(FILE, "utf-8"));
        for (const [email, ref] of Object.entries(raw)) {
          this.byEmail.set(email, ref as Partial<ConversationReference>);
        }
      } catch {
        // corrupt/empty file, start fresh
      }
    }
  }

  save(email: string, reference: Partial<ConversationReference>) {
    this.byEmail.set(email.toLowerCase(), reference);
    this.persist();
  }

  get(email: string): Partial<ConversationReference> | undefined {
    return this.byEmail.get(email.toLowerCase());
  }

  private persist() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(this.byEmail.entries());
    writeFileSync(FILE, JSON.stringify(obj, null, 2));
  }
}

export const conversationStore = new ConversationStore();
