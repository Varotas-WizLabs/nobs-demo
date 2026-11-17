// web/src/library.js
//
// The player page's library sidebar: every successfully completed analysis
// (GET /runs), newest first, each a link that switches the player to it.
// Built with DOM APIs and textContent only -- titles come from YouTube and
// are never parsed as HTML.
//
// The sidebar is collapsible and starts collapsed (a narrow rail with a
// toggle). The state lives on the root's data-collapsed, so it survives the
// periodic re-render.

import { formatCost, formatDuration } from "./runStats.js?v=206d8c0082";
import { isCollapsed, libraryIcon, makePanelToggle, setCollapsed } from "./sidePanel.js?v=206d8c0082";
import { buildSettingsButton } from "./settings.js?v=206d8c0082";

const FLAG_ORDER = ["green", "yellow", "red", "white"];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderItem(doc, run, currentRunId) {
  const runId = Number(run.run_id);
  const link = doc.createElement("a");
  link.className = "nobs-library-item";
  link.href = `player.html?run_id=${runId}`;
  link.dataset.runId = String(runId);
  if (runId === Number(currentRunId)) {
    link.setAttribute("aria-current", "page");
  }

  if (YOUTUBE_ID.test(run.video_id ?? "")) {
    const thumb = doc.createElement("img");
    thumb.className = "nobs-library-thumb";
    thumb.src = `https://i.ytimg.com/vi/${run.video_id}/mqdefault.jpg`;
    thumb.alt = "";
    thumb.loading = "lazy";
    link.appendChild(thumb);
  }

  const body = doc.createElement("div");
  body.className = "nobs-library-body";

  const title = doc.createElement("div");
  title.className = "nobs-library-title";
  title.textContent = run.title || run.video_id || `Analysis #${runId}`;
  body.appendChild(title);

  const meta = doc.createElement("div");
  meta.className = "nobs-library-meta";
  const when = formatWhen(run.created_at);
  const took = formatDuration(run.stats?.duration_sec);
  const cost = formatCost(run.stats?.cost_usd);
  meta.textContent = [`#${runId}`, when, `${run.claim_count ?? 0} claims`, took, cost].filter(Boolean).join(" · ");
  body.appendChild(meta);

  const flags = doc.createElement("div");
  flags.className = "nobs-library-flags";
  for (const flag of FLAG_ORDER) {
    const count = run.flags?.[flag] ?? 0;
    if (!count) continue;
    const chip = doc.createElement("span");
    chip.className = `nobs-library-flag nobs-library-flag-${flag}`;
    chip.textContent = String(count);
    chip.title = `${count} ${flag}`;
    flags.appendChild(chip);
  }
  body.appendChild(flags);

  link.appendChild(body);
  return link;
}

export function isLibraryCollapsed(root) {
  return isCollapsed(root);
}

export function setLibraryCollapsed(root, collapsed) {
  setCollapsed(root, collapsed);
  if (!collapsed) root.querySelector("[aria-current='page']")?.scrollIntoView?.({ block: "nearest" });
}

/**
 * Replace `root`'s contents with the library list.
 *
 * @param {HTMLElement} root
 * @param {object[]} runs  GET /runs `runs` entries
 * @param {number|string|null} currentRunId  highlighted with aria-current
 */
export function renderLibrary(root, runs, currentRunId) {
  const doc = root.ownerDocument;
  const heading = doc.createElement("div");
  heading.className = "nobs-library-heading";
  const toggle = makePanelToggle(root, {
    contentId: "nobs-library-list",
    makeIcon: libraryIcon,
    showLabel: "Show analyses",
    hideLabel: "Hide analyses",
  });
  toggle.classList.add("nobs-library-toggle");
  toggle.addEventListener("click", () => {
    if (!isCollapsed(root)) root.querySelector("[aria-current='page']")?.scrollIntoView?.({ block: "nearest" });
  });
  const label = doc.createElement("span");
  label.className = "nobs-library-label";
  label.textContent = "Analyses";
  const newLink = doc.createElement("a");
  newLink.href = "index.html";
  newLink.className = "nobs-library-new";
  newLink.textContent = "+ New";
  // Settings (gear): a dialog in the loaded run's language.
  const settings = buildSettingsButton(doc, () => doc.body?.dataset.lang || "en");
  // The public demo has no local submit page; its index is the invite-only
  // request page (request.html, src/publicRequest.js) instead.
  const demo = doc.documentElement?.dataset.demo === "1";
  let requestLink = null;
  if (demo) {
    requestLink = doc.createElement("a");
    requestLink.href = "index.html";
    requestLink.className = "nobs-library-request";
    requestLink.textContent = "+ Разобрать видео";
    requestLink.title = "Разобрать новое видео (по коду приглашения)";
  }
  heading.append(...[toggle, label, demo ? requestLink : newLink, settings].filter(Boolean));

  const list = doc.createElement("nav");
  list.className = "nobs-library-list";
  list.id = "nobs-library-list";
  list.setAttribute("aria-label", "Completed analyses");
  if (!runs || runs.length === 0) {
    const empty = doc.createElement("p");
    empty.className = "nobs-library-empty";
    empty.textContent = "No completed analyses yet.";
    list.appendChild(empty);
  } else {
    for (const run of runs) {
      list.appendChild(renderItem(doc, run, currentRunId));
    }
  }

  root.replaceChildren(heading, list);
  setCollapsed(root, isCollapsed(root));
}

/**
 * Load the library now and refresh it every `refreshIntervalMs`, so a run
 * that finishes (here or in another tab) shows up without a reload.
 * Returns a stop function.
 */
export function startLibrary({ root, fetchImpl, currentRunId, refreshIntervalMs = 15000 }) {
  let lastJson = null;
  let stopped = false;

  async function refresh() {
    try {
      const response = await fetchImpl("/runs");
      if (!response.ok || stopped) return;
      const body = await response.json();
      const json = JSON.stringify(body.runs ?? []);
      if (json === lastJson) return; // unchanged: keep the DOM (and scroll) as is
      lastJson = json;
      renderLibrary(root, body.runs ?? [], currentRunId);
    } catch {
      // The library is a convenience: a failed refresh keeps the last list.
    }
  }

  refresh();
  const intervalId = setInterval(refresh, refreshIntervalMs);
  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}
