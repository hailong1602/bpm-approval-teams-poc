import { Router, Request, Response, NextFunction } from "express";
import { existsSync } from "fs";
import { join } from "path";
import { taskStore, TaskAction, DecisionSource } from "./store";
import { config } from "../config";

const PROJECT_ROOT = join(__dirname, "..", "..");

const VALID_ACTIONS: TaskAction[] = ["approve", "reject", "cancel"];
const VALID_SOURCES: DecisionSource[] = ["BPM_SCREEN", "MS_TEAMS", "MS_TEAMS_TAB"];

export const bpmRouter = Router();

// Only the two endpoints below are reachable from outside this process now
// that Power Automate calls them over the public tunnel (see
// docs/power-automate-flows.md) — everything else (GET routes, the .eml
// download) stays open. Empty config.bpmApiKey = check disabled, matching
// the same on/off-by-empty-value convention used elsewhere in config.ts.
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!config.bpmApiKey) return next();
  if (req.header("x-api-key") !== config.bpmApiKey) {
    return res.status(401).json({ error: "Invalid or missing x-api-key" });
  }
  next();
}

// Simulates "task đến" — a real BPM would call this (or an internal event)
// when a workflow step is routed to a user.
bpmRouter.post("/tasks", requireApiKey, (req, res) => {
  const title = (req.body?.title as string) || "Yêu cầu phê duyệt";
  const requester = (req.body?.requester as string) || "Hệ thống BPM";
  const assigneeEmail = (req.body?.assigneeEmail as string) || config.assigneeEmail;
  const detail = req.body?.detail as string | undefined;

  const task = taskStore.create(title, requester, assigneeEmail, detail);
  res.status(201).json(task);
});

bpmRouter.get("/tasks", (req, res) => {
  const assignee = req.query.assignee as string | undefined;
  const tasks = taskStore.list();
  if (!assignee) return res.json(tasks);
  res.json(tasks.filter((t) => t.assigneeEmail.toLowerCase() === assignee.toLowerCase()));
});

bpmRouter.get("/tasks/:id", (req, res) => {
  const task = taskStore.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

// Serves the original .eml this task was created from (if any), so opening it
// from the browser downloads a self-contained email file — attachments stay
// embedded inside it (native mail apps render them), nothing is extracted
// or re-hosted separately on this server.
bpmRouter.get("/tasks/:id/email", (req, res) => {
  const task = taskStore.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!task.emailFile) return res.status(404).json({ error: "Task has no source email" });

  const filePath = join(PROJECT_ROOT, task.emailFile);
  if (!existsSync(filePath)) return res.status(404).json({ error: "Email file missing on disk" });

  // HTTP header VALUES must be Latin-1/ASCII — Vietnamese diacritics (kept by
  // \p{L}) throw ERR_INVALID_CHAR if passed to setHeader() directly. Give an
  // ASCII-only fallback filename plus an RFC 5987 filename* for browsers that
  // render the accented version.
  const rawName = task.title || "email";
  const utf8Name = rawName.replace(/[^\p{L}\p{N}\- ]/gu, "").slice(0, 60) || "email";
  const asciiName =
    rawName
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .normalize("NFD")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/[^\w\- ]/g, "")
      .trim()
      .slice(0, 60) || "email";

  res.setHeader("Content-Type", "message/rfc822");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}.eml"; filename*=UTF-8''${encodeURIComponent(utf8Name)}.eml`
  );
  res.sendFile(filePath);
});

// This is the single action endpoint. It is called from three places:
//  - the mock BPM screen (source=BPM_SCREEN), simulating the user clicking in the real BPM UI
//  - the Teams chat Adaptive Card (source=MS_TEAMS), via activityHandler.ts
//  - the "My Tasks" personal tab (source=MS_TEAMS_TAB), a plain REST call from the tab's own UI
bpmRouter.post("/tasks/:id/actions", requireApiKey, (req, res) => {
  const { action, actor, source } = req.body || {};
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of ${VALID_ACTIONS.join(", ")}` });
  }
  if (!VALID_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of ${VALID_SOURCES.join(", ")}` });
  }

  const result = taskStore.applyAction(req.params.id, action, actor || "unknown", source);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json(result.task);
});
