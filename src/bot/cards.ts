import { CardFactory } from "botbuilder";
import { Attachment } from "botbuilder";
import { ApprovalTask } from "../bpm/store";

/** Card sent proactively when a new task arrives. Buttons use Action.Submit
 *  so a click comes back as a normal message activity with `.value` set —
 *  no Adaptive Card Universal Action / Invoke handling needed for this spike. */
export function buildApprovalCard(task: ApprovalTask): Attachment {
  return CardFactory.adaptiveCard({
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: "Yêu cầu phê duyệt mới",
        weight: "Bolder",
        size: "Medium",
        wrap: true,
      },
      {
        type: "TextBlock",
        text: task.title,
        wrap: true,
        spacing: "Small",
      },
      {
        type: "FactSet",
        facts: [
          { title: "Người đề nghị", value: task.requester },
          { title: "Mã task", value: task.id.slice(0, 8) },
          { title: "Thời gian", value: new Date(task.createdAt).toLocaleString("vi-VN") },
        ],
      },
    ],
    actions: [
      {
        type: "Action.Submit",
        title: "✅ Đồng ý",
        style: "positive",
        data: { action: "approve", taskId: task.id },
      },
      {
        type: "Action.Submit",
        title: "❌ Từ chối",
        style: "destructive",
        data: { action: "reject", taskId: task.id },
      },
      {
        type: "Action.Submit",
        title: "🚫 Huỷ",
        data: { action: "cancel", taskId: task.id },
      },
    ],
  });
}

/** Replaces the interactive card in place once a decision has been made,
 *  regardless of whether the decision was made on this card or on the BPM screen. */
export function buildResultCard(task: ApprovalTask): Attachment {
  const statusLabel: Record<string, string> = {
    APPROVED: "✅ Đã đồng ý",
    REJECTED: "❌ Đã từ chối",
    CANCELLED: "🚫 Đã huỷ",
    PENDING: "⏳ Đang chờ xử lý",
  };

  return CardFactory.adaptiveCard({
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        text: task.title,
        weight: "Bolder",
        size: "Medium",
        wrap: true,
      },
      {
        type: "TextBlock",
        text: statusLabel[task.status] || task.status,
        wrap: true,
        spacing: "Small",
        weight: "Bolder",
      },
      {
        type: "FactSet",
        facts: [
          { title: "Người đề nghị", value: task.requester },
          { title: "Mã task", value: task.id.slice(0, 8) },
          { title: "Xử lý bởi", value: task.decidedBy || "" },
          {
            title: "Qua kênh",
            value:
              task.decidedVia === "MS_TEAMS"
                ? "Microsoft Teams (chat)"
                : task.decidedVia === "MS_TEAMS_TAB"
                  ? "Microsoft Teams (My Tasks)"
                  : "Màn hình BPM",
          },
          { title: "Thời gian", value: task.decidedAt ? new Date(task.decidedAt).toLocaleString("vi-VN") : "" },
        ],
      },
    ],
  });
}
