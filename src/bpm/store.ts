import { randomUUID } from "crypto";
import { EventEmitter } from "events";

export type TaskStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type TaskAction = "approve" | "reject" | "cancel";
// BPM_SCREEN    = mock BPM web screen.
// MS_TEAMS      = the Adaptive Card in the bot chat — activityHandler.ts
//                 updates that same card inline, in the same turn, so the
//                 proactive-sync listener in server.ts must NOT also fire for it.
// MS_TEAMS_TAB  = the "My Tasks" personal tab — a plain REST call with no
//                 card of its own to self-update, so it DOES need the
//                 proactive-sync listener to push the change back into chat.
export type DecisionSource = "BPM_SCREEN" | "MS_TEAMS" | "MS_TEAMS_TAB";

export interface ApprovalTask {
  id: string;
  title: string;
  /** Long-form reference content (multi-line) — shown in the detail view, kept out of the compact chat card/list row. */
  detail?: string;
  /** Path (relative to project root) of the original .eml file, when this task was created from an incoming email. */
  emailFile?: string;
  requester: string;
  assigneeEmail: string;
  status: TaskStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decidedVia?: DecisionSource;
  history: Array<{ at: string; event: string }>;
}

const ACTION_TO_STATUS: Record<TaskAction, TaskStatus> = {
  approve: "APPROVED",
  reject: "REJECTED",
  cancel: "CANCELLED",
};

class TaskStore {
  private tasks = new Map<string, ApprovalTask>();
  readonly events = new EventEmitter();

  create(
    title: string,
    requester: string,
    assigneeEmail: string,
    detail?: string,
    emailFile?: string
  ): ApprovalTask {
    const task: ApprovalTask = {
      id: randomUUID(),
      title,
      detail,
      emailFile,
      requester,
      assigneeEmail,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      history: [
        {
          at: new Date().toISOString(),
          event:
            "Task created, assigned to " +
            assigneeEmail +
            (emailFile ? " (từ email)" : ""),
        },
      ],
    };
    this.tasks.set(task.id, task);
    this.events.emit("task:created", task);
    return task;
  }

  list(): ApprovalTask[] {
    return [...this.tasks.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  get(id: string): ApprovalTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Applies a decision. This is the single code path used whether the click
   * originated from the real BPM screen or from the MS Teams Adaptive Card,
   * so both surfaces stay consistent.
   */
  applyAction(
    id: string,
    action: TaskAction,
    decidedBy: string,
    decidedVia: DecisionSource
  ): { ok: true; task: ApprovalTask } | { ok: false; reason: string } {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, reason: "Task not found" };
    if (task.status !== "PENDING") {
      return { ok: false, reason: `Task already ${task.status.toLowerCase()}` };
    }

    task.status = ACTION_TO_STATUS[action];
    task.decidedAt = new Date().toISOString();
    task.decidedBy = decidedBy;
    task.decidedVia = decidedVia;
    task.history.push({
      at: task.decidedAt,
      event: `${task.status} by ${decidedBy} via ${decidedVia}`,
    });

    this.events.emit("task:updated", task);
    return { ok: true, task };
  }
}

export const taskStore = new TaskStore();
