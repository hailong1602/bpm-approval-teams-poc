import { ConversationReference, TurnContext } from "botbuilder";
import { adapter } from "./adapter";
import { conversationStore } from "./conversationStore";
import { cardActivityStore } from "./cardActivityStore";
import { config } from "../config";
import { ApprovalTask } from "../bpm/store";
import { buildApprovalCard, buildResultCard } from "./cards";

export async function sendApprovalCard(task: ApprovalTask): Promise<void> {
  const reference = conversationStore.get(task.assigneeEmail);
  if (!reference) {
    console.warn(
      `[bot] No stored Teams conversation for ${task.assigneeEmail}. ` +
        `The assignee must open a 1:1 chat with the bot at least once before ` +
        `proactive messages can be delivered.`
    );
    return;
  }

  await adapter.continueConversationAsync(
    config.microsoftAppId,
    reference as ConversationReference,
    async (context: TurnContext) => {
      const response = await context.sendActivity({ attachments: [buildApprovalCard(task)] });
      if (response?.id) {
        cardActivityStore.save(task.id, { activityId: response.id, reference });
      }
    }
  );
}

/**
 * Called when a decision is made anywhere OTHER than the chat card itself —
 * the mock BPM screen, or the "My Tasks" tab — so the chat card (if one was
 * sent) stops showing live buttons and reflects the same outcome. A decision
 * made *in* the chat card already updates itself inline (activityHandler.ts)
 * and must not also go through this path, or it'd be updated twice.
 */
export async function syncCardWithLatestStatus(task: ApprovalTask): Promise<void> {
  const sent = cardActivityStore.get(task.id);
  if (!sent) {
    console.warn(`[bot] No sent card recorded for task ${task.id} — nothing to sync in Teams.`);
    return;
  }

  await adapter.continueConversationAsync(
    config.microsoftAppId,
    sent.reference as ConversationReference,
    async (context: TurnContext) => {
      await context.updateActivity({
        type: "message",
        id: sent.activityId,
        attachments: [buildResultCard(task)],
      } as any);
      console.log(`[bot] Đã đồng bộ lại card Teams cho task ${task.id} (decidedVia=${task.decidedVia})`);
    }
  );
}
