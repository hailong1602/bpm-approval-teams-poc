import express from "express";
import path from "path";
import { config } from "./config";
import { bpmRouter } from "./bpm/routes";
import { taskStore } from "./bpm/store";

// Last-resort safety net: an uncaught error anywhere otherwise kills the
// whole process silently — and unlike a crash on a normal web request,
// nothing here re-serves the port, so ngrok/anything pointed at it just
// goes quiet with no obvious signal why. Logging and staying alive is the
// right tradeoff for a demo server.
process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException (process staying alive):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[server] unhandledRejection (process staying alive):", err);
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// --- Mock BPM: web screen + REST API ---
app.use("/bpm", bpmRouter);

// Teams notification and email intake are now handled by Power Automate
// (see docs/power-automate-flows.md) instead of the Bot Framework/IMAP code
// that used to live here — that code is left untouched in src/bot and
// src/email for reference, just no longer wired up.
//
// Every time a task is created — regardless of source (BPM screen form,
// `npm run trigger`, or Power Automate's own email-intake flow) — notify
// the Power Automate flow that posts the Teams Adaptive Card and waits for
// a decision ("Flow B"). This preserves the original design's decoupling of
// "how a task was created" from "how it gets announced on Teams".
taskStore.events.on("task:created", (task) => {
  if (!config.powerAutomateTaskCreatedUrl) return;
  fetch(config.powerAutomateTaskCreatedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  }).catch((err) => console.error("[power-automate] failed to notify task:created", err));
});

// No task:updated listener: unlike the old Bot Framework card, Power
// Automate's "Post adaptive card and wait for a response" can't be updated
// from outside while it's waiting, so there's nothing to push a re-sync to.
// If a decision is made elsewhere (BPM screen / My Tasks tab) before the
// Teams card is answered, Flow B's callback to POST /bpm/tasks/:id/actions
// simply gets a 409 from applyAction() and stops — data stays correct, the
// card just may look stale until someone acts on it. See
// docs/power-automate-flows.md for the full tradeoff.

app.listen(config.port, () => {
  console.log(`Mock BPM screen:      http://localhost:${config.port}/`);
  console.log(`BPM API (for Power Automate too): http://localhost:${config.port}/bpm/tasks`);
});
