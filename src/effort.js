// web/src/effort.js
//
// Effort modes (spec docs/superpowers/specs/2026-11-18-effort-modes-design.md):
// Light (YouTube captions, fastest and cheapest) and Deep (speech
// recognition, frames, deep fact-check; it starts like Light and the deep
// result replaces it for later views).
//
//   buildEffortPicker   the two-option selector of the submit / request pages
//   loadEffort/saveEffort  the visitor's last choice (localStorage, may be blocked)
//   buildEffortBadge    «Light» / «Deep» / «Deep готовится…» in the library and the player
//   redirectTarget      a superseded run opened from an old link -> the served run
//   watchUpgrade        the player: polls /runs/{id}/served while a deep pass runs,
//                       then shows a small «deeper version ready» notice (never swaps claims)
// Built with DOM APIs and textContent only.

import { labelLanguage } from "./i18n.js?v=c1233d3052";

export const EFFORTS = ["light", "deep"];
export const UPGRADE_POLL_MS = 30000;
const KEY = "nobs.effort";

const STRINGS = {
  ru: {
    legend: "Режим разбора",
    "light.title": "Light — быстро и дёшево",
    "light.hint": "Субтитры YouTube и обычная проверка; первые отметки через 10–20 секунд.",
    "deep.title": "Deep — максимальное качество",
    "deep.hint": "Распознавание речи, кадры, глубокая проверка и второе мнение. Стартует как Light, затем глубокая версия подменяет её для следующих просмотров.",
    "badge.light": "Light",
    "badge.deep": "Deep",
    "badge.upgrading": "Deep готовится…",
    "badge.lightTitle": "Быстрый разбор по субтитрам YouTube",
    "badge.deepTitle": "Глубокий разбор: распознавание речи, кадры, глубокая проверка",
    "badge.upgradingTitle": "Глубокая версия этого разбора готовится; текущий разбор не изменится",
    "notice.ready": "Готова глубокая версия разбора",
    "notice.open": "Открыть",
  },
  en: {
    legend: "Analysis mode",
    "light.title": "Light — fast and cheap",
    "light.hint": "YouTube captions and the standard check; first marks in 10–20 seconds.",
    "deep.title": "Deep — maximum quality",
    "deep.hint": "Speech recognition, frames, deep fact-check and a second opinion. Starts like Light; the deep version then replaces it for later views.",
    "badge.light": "Light",
    "badge.deep": "Deep",
    "badge.upgrading": "Deep in progress…",
    "badge.lightTitle": "Quick analysis from YouTube captions",
    "badge.deepTitle": "Deep analysis: speech recognition, frames, deep fact-check",
    "badge.upgradingTitle": "A deep version of this analysis is being prepared; what you see now will not change",
    "notice.ready": "A deeper version of this analysis is ready",
    "notice.open": "Open",
  },
};

export function effortText(key, lang = "ru") {
  lang = labelLanguage(lang);
  return (STRINGS[lang] ?? STRINGS.ru)[key] ?? STRINGS.ru[key] ?? key;
}

export function normalizeEffort(value) {
  return value === "deep" ? "deep" : "light";
}

export function loadEffort(storage = globalThis.localStorage) {
  try {
    return normalizeEffort(storage?.getItem(KEY));
  } catch {
    return "light";
  }
}

export function saveEffort(value, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, normalizeEffort(value));
  } catch {
    // blocked storage: the choice is not remembered
  }
}

/**
 * The two-option selector (radio group). Returns {root, value(), set(v)}.
 * `onChange(effort)` on a change; `name` keeps two pickers on a page apart.
 */
export function buildEffortPicker(doc, { lang = "ru", value = "light", onChange = null, name = "nobs-effort" } = {}) {
  const root = doc.createElement("fieldset");
  root.className = "nobs-effort";
  const legend = doc.createElement("legend");
  legend.textContent = effortText("legend", lang);
  root.appendChild(legend);
  const inputs = {};
  for (const effort of EFFORTS) {
    const label = doc.createElement("label");
    label.className = `nobs-effort-option nobs-effort-${effort}`;
    const input = doc.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = effort;
    input.checked = normalizeEffort(value) === effort;
    input.addEventListener("change", () => {
      if (input.checked) onChange?.(effort);
    });
    inputs[effort] = input;
    const text = doc.createElement("span");
    text.className = "nobs-effort-text";
    const title = doc.createElement("strong");
    title.textContent = effortText(`${effort}.title`, lang);
    const hint = doc.createElement("small");
    hint.textContent = effortText(`${effort}.hint`, lang);
    text.append(title, hint);
    label.append(input, text);
    root.appendChild(label);
  }
  return {
    root,
    value: () => (inputs.deep.checked ? "deep" : "light"),
    set: (v) => {
      inputs[normalizeEffort(v)].checked = true;
    },
  };
}

/** «Light» / «Deep» / «Deep готовится…» (upgrading: a deep pass of this video is under way). */
export function buildEffortBadge(doc, effort, { upgrading = false, lang = "ru" } = {}) {
  const badge = doc.createElement("span");
  const kind = upgrading ? "upgrading" : normalizeEffort(effort);
  badge.className = `nobs-effort-badge nobs-effort-badge-${kind}`;
  badge.dataset.effort = kind;
  badge.textContent = effortText(`badge.${kind}`, lang);
  badge.title = effortText(`badge.${kind}Title`, lang);
  return badge;
}

/** Whether the upgrade state means a deep pass is still coming. */
export function upgradeInProgress(served) {
  const state = served?.upgrade?.state;
  return state === "pending" || state === "running";
}

/**
 * The run to open instead of `runId` on page load: the video's served run
 * when it is a deep run other than this one (an old link to the light
 * quick start), unless the link says `exact=1`. Null: stay.
 */
export function redirectTarget(info, runId, search = "") {
  if (new URLSearchParams(search).get("exact") === "1") return null;
  const served = info?.served;
  const target = Number(served?.run_id);
  if (!served || !Number.isFinite(target) || target === Number(runId)) return null;
  if (served.effort !== "deep") return null;
  // Only a run the deep one superseded (the server says 'ready'): a run
  // started after it -- a fresh analysis just launched -- is never left.
  if (served.upgrade?.state !== "ready") return null;
  return target;
}

/** The player URL of `runId`, keeping the page's other parameters (solo, lang…). */
export function runUrl(search, runId) {
  const params = new URLSearchParams(search);
  params.set("run_id", String(runId));
  params.delete("exact");
  return `player.html?${params.toString()}`;
}

/**
 * The player's badge and «deeper version ready» notice for the shown run.
 * `info`: {effort, served} (GET /runs/{id} carries both). While a deep pass
 * is pending/running the badge says so and /runs/{id}/served is polled; once
 * a deep run is served, a small notice offers to reload into it. The claims
 * on screen are never swapped. Returns {stop(), state()}.
 */
export function watchUpgrade({
  doc = globalThis.document,
  root,
  runId,
  info,
  lang = "ru",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  schedule = (fn, ms) => setTimeout(fn, ms),
  navigate = (href) => globalThis.location.assign(href),
  search = globalThis.location?.search ?? "",
  pollMs = UPGRADE_POLL_MS,
} = {}) {
  let current = info;
  let stopped = false;
  let notice = null;

  const render = () => {
    root.replaceChildren();
    if (!current) return;
    root.appendChild(buildEffortBadge(doc, current.effort, { upgrading: upgradeInProgress(current.served), lang }));
    const served = current.served;
    if (served?.upgrade?.state === "ready" && Number(served.run_id) !== Number(runId)) {
      notice = doc.createElement("span");
      notice.className = "nobs-effort-notice";
      notice.setAttribute("role", "status");
      const text = doc.createElement("span");
      text.textContent = effortText("notice.ready", lang);
      const open = doc.createElement("button");
      open.type = "button";
      open.className = "nobs-effort-open";
      open.textContent = effortText("notice.open", lang);
      open.addEventListener("click", () => navigate(runUrl(search, served.run_id)));
      notice.append(text, " ", open);
      root.appendChild(notice);
    }
  };

  const poll = async () => {
    if (stopped || !upgradeInProgress(current?.served)) return;
    try {
      const r = await fetchImpl(`/runs/${Number(runId)}/served`, { cache: "no-store" });
      if (r.ok) {
        const body = await r.json();
        if (body && body.served) current = body;
      }
    } catch {
      // offline or the demo (no endpoint): keep what we have
    }
    if (stopped) return;
    render();
    if (upgradeInProgress(current?.served)) schedule(poll, pollMs);
  };

  render();
  if (upgradeInProgress(current?.served)) schedule(poll, pollMs);
  return {
    stop: () => {
      stopped = true;
    },
    state: () => current,
  };
}
