import { ConversationReference } from "botbuilder";

interface SentCard {
  activityId: string;
  reference: Partial<ConversationReference>;
}

/**
 * Remembers which Teams activity carries which task's Adaptive Card, so a
 * decision made on the *BPM screen* can still edit that same Teams message
 * (proactively, outside any turn). Without this, the Teams card would keep
 * showing stale buttons after a BPM-side decision.
 */
class CardActivityStore {
  private byTaskId = new Map<string, SentCard>();

  save(taskId: string, sent: SentCard) {
    this.byTaskId.set(taskId, sent);
  }

  get(taskId: string): SentCard | undefined {
    return this.byTaskId.get(taskId);
  }
}

export const cardActivityStore = new CardActivityStore();
