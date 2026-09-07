import { TeamsActivityHandler, TurnContext } from "botbuilder";
import { config } from "../config";
import { conversationStore } from "./conversationStore";
import { taskStore, TaskAction } from "../bpm/store";
import { buildResultCard } from "./cards";

const VALID_ACTIONS: TaskAction[] = ["approve", "reject", "cancel"];

export class ApprovalBot extends TeamsActivityHandler {
  constructor() {
    super();

    // Fires when the user installs the app / a 1:1 chat with the bot is created.
    // This is how we capture the conversation reference needed for *proactive*
    // messaging later — without it the server has no address to push a card to.
    this.onMembersAdded(async (context, next) => {
      const membersAdded = context.activity.membersAdded || [];
      const botId = context.activity.recipient.id;
      for (const member of membersAdded) {
        if (member.id === botId) continue; // ignore the bot itself being added
        this.captureConversationReference(context);
        await context.sendActivity(
          "Xin chào! Bot phê duyệt đã sẵn sàng. Khi có yêu cầu mới cần bạn duyệt, " +
            "thông báo kèm nút Đồng ý / Từ chối / Huỷ sẽ xuất hiện ngay tại đây."
        );
      }
      await next();
    });

    this.onMessage(async (context, next) => {
      // Keep the reference fresh on every interaction (handles the case where
      // the bot server restarted after members-added already fired once).
      this.captureConversationReference(context);

      const value = context.activity.value as { action?: string; taskId?: string } | undefined;
      if (value?.action && value?.taskId) {
        await this.handleCardAction(context, value.action, value.taskId);
      } else if (context.activity.text) {
        await context.sendActivity("Bot đã ghi nhận bạn. Sẽ gửi thông báo phê duyệt khi có yêu cầu mới tới.");
      }

      await next();
    });
  }

  private captureConversationReference(context: TurnContext) {
    const reference = TurnContext.getConversationReference(context.activity);
    // Spike scope: single hard-coded assignee. In production this would be
    // resolved from the authenticated Teams user (AAD object id / UPN) rather
    // than a static config value.
    conversationStore.save(config.assigneeEmail, reference);
  }

  private async handleCardAction(context: TurnContext, action: string, taskId: string) {
    if (!VALID_ACTIONS.includes(action as TaskAction)) {
      await context.sendActivity(`Hành động không hợp lệ: ${action}`);
      return;
    }

    const actor = context.activity.from?.name || config.assigneeEmail;

    // This is the callback into "BPM": the same action endpoint the mock BPM
    // screen calls, so a click here applies the exact same business logic.
    const result = taskStore.applyAction(taskId, action as TaskAction, actor, "MS_TEAMS");

    if (!result.ok) {
      await context.sendActivity(`Không thể xử lý: ${result.reason}`);
      return;
    }

    // Edit the original card in place (replyToId = id of the message that
    // carried the buttons) so it stops looking actionable and shows the outcome.
    const updated = {
      type: "message",
      id: context.activity.replyToId,
      attachments: [buildResultCard(result.task)],
    };
    await context.updateActivity(updated as any);
  }
}
