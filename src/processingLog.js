// web/src/processingLog.js
//
// The "Processing log" panel under the player: polls GET /runs/{id}/events
// incrementally (?after=<last event id>) plus GET /runs/{id}/status, and
// shows every pipeline event with its time, stage and level, under a status
// line ("Processing — <stage>" / "Complete — N claims" / "Failed: <reason>").
//
// It depends on nothing but fetch and the DOM -- never on the YouTube
// player -- so it works while the video is still loading, or if it never
// loads. All server-provided text is inserted with textContent.

import { progressLine } from "./progress.js?v=3c4521b780";
import { formatUsage } from "./runStats.js?v=3c4521b780";

const STAGE_LABELS = {
  run: "starting",
  captions: "fetching captions",
  topics: "segmenting topics",
  claims: "extracting claims",
  dedupe: "removing duplicate claims",
  relations: "checking claims against each other",
  verify: "verifying claims",
  save: "saving results",
};

const TERMINAL = new Set(["complete", "failed"]);

function pad(n) {
  return String(n).padStart(2, "0");
}

function clockTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatAge(ms) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m${pad(seconds)}s` : `${seconds}s`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getJson(fetchImpl, url) {
  return Promise.resolve()
    .then(() => fetchImpl(url))
    .then((r) => {
      if (!r || !r.ok) throw new Error(`GET ${url} returned ${r ? r.status : "nothing"}`);
      return r.json();
    });
}

// Builds the panel inside `root` and starts polling. Returns { stop }.
// `stallAfterMs`: with no new event for this long while the run is active,
// the status line says so (a stuck run is visible, not silent).
// A streaming run in progress shows how far the analysis got instead of the
// stage: «Проанализировано 7:40 / 41:20 · 23 утверждения · 5 проверяются»,
// in `lang` (a string, or a function asked on every render: the run's
// language becomes known only once its claims load).
export function startProcessingLog({ runId, fetchImpl, pollIntervalMs, root, stallAfterMs = 60000, lang = "en" }) {
  const panel = el("details", "nobs-log");
  panel.open = true;
  panel.dataset.state = "pending";
  const summary = el("summary", "nobs-log-summary");
  // The usage line (time, cost, models) stays visible with the panel closed.
  summary.append(
    el("span", "nobs-log-title", "Processing log"),
    el("span", "nobs-log-status", "Processing — connecting…"),
    el("span", "nobs-log-usage", ""),
  );
  const list = el("ol", "nobs-log-list");
  list.setAttribute("aria-live", "polite");
  panel.append(summary, list);
  root.appendChild(panel);
  const statusLine = summary.querySelector(".nobs-log-status");
  const usageLine = summary.querySelector(".nobs-log-usage");

  let lastId = 0;
  let lastStage = null;
  let lastEventAt = Date.now();
  let status = null; // last /status body
  let stopped = false;
  let timeoutId = null;
  // The panel's auto open/closed state; once the user toggles it, it is theirs.
  let autoOpen = true;
  let userToggled = false;

  panel.addEventListener("toggle", () => {
    if (panel.open !== autoOpen) userToggled = true;
  });

  function setOpen(open) {
    autoOpen = open;
    if (!userToggled) panel.open = open;
  }

  function appendEvents(events) {
    if (!events.length) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    for (const e of events) {
      if (typeof e.id !== "number" || e.id <= lastId) continue;
      lastId = e.id;
      lastStage = e.stage;
      const row = el("li", "nobs-log-row");
      row.dataset.level = e.level;
      const time = el("time", "nobs-log-time", clockTime(e.ts));
      time.setAttribute("datetime", String(e.ts));
      row.append(time, el("span", "nobs-log-stage", String(e.stage)), el("span", "nobs-log-message", String(e.message)));
      list.appendChild(row);
    }
    lastEventAt = Date.now();
    if (nearBottom || list.scrollTop === 0) list.scrollTop = list.scrollHeight;
  }

  function render() {
    const state = status ? status.status : null;
    usageLine.textContent = formatUsage(status && status.stats);
    if (state === "complete") {
      const n = typeof status.claim_count === "number" ? status.claim_count : "?";
      statusLine.textContent = `Complete — ${n} claim${n === 1 ? "" : "s"}`;
      panel.dataset.state = "complete";
      setOpen(false);
      return;
    }
    if (state === "failed") {
      statusLine.textContent = `Failed: ${status.error || "unknown error"}`;
      panel.dataset.state = "failed";
      setOpen(true);
      return;
    }
    panel.dataset.state = state || "pending";
    let label;
    if (lastStage) label = STAGE_LABELS[lastStage] || lastStage;
    else label = state === "running" ? "starting" : "queued";
    let text = `Processing — ${label}`;
    const live = progressLine(status, (typeof lang === "function" ? lang() : lang) || "en");
    if (live) text = live;
    const idle = Date.now() - lastEventAt;
    if (idle >= stallAfterMs) text += ` (no new activity for ${formatAge(idle)})`;
    statusLine.textContent = text;
  }

  function schedule() {
    if (stopped) return;
    timeoutId = setTimeout(tick, pollIntervalMs);
  }

  function tick() {
    timeoutId = null;
    let terminal = false;
    let eventsOk = false;
    // Status first, then events: once a terminal status is seen, the events
    // fetched after it include the run's closing event.
    getJson(fetchImpl, `/runs/${runId}/status`)
      .then((body) => {
        if (body && typeof body.status === "string") {
          status = body;
          terminal = TERMINAL.has(body.status);
        }
      })
      .catch((err) => console.warn("Run status poll failed; retrying", err))
      .then(() => getJson(fetchImpl, `/runs/${runId}/events?after=${lastId}`))
      .then((body) => {
        if (stopped) return;
        appendEvents(Array.isArray(body && body.events) ? body.events : []);
        eventsOk = true;
      })
      .catch((err) => console.warn("Processing log poll failed; retrying", err))
      .finally(() => {
        if (stopped) return;
        render();
        if (terminal && eventsOk) {
          stopped = true;
          return;
        }
        schedule();
      });
  }

  tick();

  return {
    stop() {
      stopped = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}
