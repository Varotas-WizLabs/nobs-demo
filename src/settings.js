// web/src/settings.js
//
// Viewer settings for the player page, kept in this browser (localStorage;
// a blocked or empty storage just means the defaults). The settings dialog
// opens from the gear button in the analyses panel.
//
// seekLeadSec: jumping to a finding (a timeline marker, a row in the claim
// list, a tag's timecode) starts playback this many seconds earlier, so the
// lead-in to the phrase is heard.
//
// showPossibleTags: show the "possible" presentation tags (the automatic
// check was not sure: kept by a minority of votes or below the bar) as pale
// chips and marks. Off hides them everywhere -- popup chips, the claim list
// and its filters, the timeline and the export -- without a reload
// (`onSettingsChange` tells the page to redraw).

import { t } from "./i18n.js";

const KEY = "nobs.settings";

export const DEFAULTS = Object.freeze({ seekLeadSec: 3, showPossibleTags: true, followPlayback: true, youtubeCaptions: false });
export const SEEK_LEAD_MAX = 30;

let cache = null;

function read() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") ?? {};
  } catch {
    stored = {};
  }
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

export function getSettings() {
  return { ...read() };
}

const listeners = new Set();

/** Call `fn(settings, name)` after every change; returns an unsubscribe function. */
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSetting(name, value) {
  const changed = read()[name] !== value;
  cache = { ...read(), [name]: value };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked: the setting still holds for this page.
  }
  if (!changed) return;
  for (const fn of [...listeners]) {
    try {
      fn(getSettings(), name);
    } catch (err) {
      console.error("settings listener failed", err);
    }
  }
}

/** YouTube's own captions over the video (off by default). */
export function youtubeCaptions() {
  return read().youtubeCaptions === true;
}

/** The claim list scrolls along with playback, keeping the current claim in view. */
export function followPlayback() {
  return read().followPlayback !== false;
}

/** Whether "possible" (pale) tags are shown; on unless switched off. */
export function showPossibleTags() {
  return read().showPossibleTags !== false;
}

/** Test hook: forget the cached settings. */
export function resetSettingsCache() {
  cache = null;
}

export function clampLead(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.seekLeadSec;
  return Math.min(Math.max(Math.round(n), 0), SEEK_LEAD_MAX);
}

/** Where playback starts for a finding at `sec`: the lead earlier, not before 0. */
export function seekTarget(sec) {
  const lead = clampLead(read().seekLeadSec);
  return Math.max(0, Number(sec) - lead);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A gear icon. */
export function gearIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const gear = doc.createElementNS(SVG_NS, "path");
  gear.setAttribute(
    "d",
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
  );
  const hub = doc.createElementNS(SVG_NS, "circle");
  hub.setAttribute("cx", "12");
  hub.setAttribute("cy", "12");
  hub.setAttribute("r", "3");
  svg.append(gear, hub);
  return svg;
}

/**
 * Open the settings dialog (a modal <dialog>). `lang` picks the labels.
 * Changes apply at once; Escape or "Close" closes it.
 */
export function openSettingsDialog(doc, lang = "en") {
  doc.querySelector(".nobs-settings")?.remove();
  const dialog = doc.createElement("dialog");
  dialog.className = "nobs-settings";
  dialog.setAttribute("aria-labelledby", "nobs-settings-title");

  const title = doc.createElement("h2");
  title.id = "nobs-settings-title";
  title.textContent = t("settings.title", lang);

  const field = doc.createElement("label");
  field.className = "nobs-settings-field";
  const label = doc.createElement("span");
  label.textContent = t("settings.seekLead", lang);
  const row = doc.createElement("span");
  row.className = "nobs-settings-row";
  const input = doc.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = String(SEEK_LEAD_MAX);
  input.step = "1";
  input.name = "seekLeadSec";
  input.value = String(clampLead(getSettings().seekLeadSec));
  const unit = doc.createElement("span");
  unit.textContent = t("settings.seconds", lang);
  row.append(input, unit);
  const hint = doc.createElement("small");
  hint.textContent = t("settings.seekLeadHint", lang);
  field.append(label, row, hint);
  input.addEventListener("input", () => {
    if (input.value !== "") setSetting("seekLeadSec", clampLead(input.value));
  });
  input.addEventListener("change", () => {
    const value = clampLead(input.value);
    input.value = String(value);
    setSetting("seekLeadSec", value);
  });

  const close = doc.createElement("button");
  close.type = "button";
  close.className = "nobs-settings-close";
  close.textContent = t("close", lang);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  // A click on the backdrop (outside the box) closes it too.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  const possible = doc.createElement("label");
  possible.className = "nobs-settings-field nobs-settings-check";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.name = "showPossibleTags";
  box.checked = showPossibleTags();
  const boxLabel = doc.createElement("span");
  boxLabel.textContent = t("settings.showPossible", lang);
  const boxRow = doc.createElement("span");
  boxRow.className = "nobs-settings-row";
  boxRow.append(box, boxLabel);
  const boxHint = doc.createElement("small");
  boxHint.textContent = t("settings.showPossibleHint", lang);
  possible.append(boxRow, boxHint);
  box.addEventListener("change", () => setSetting("showPossibleTags", box.checked));

  const follow = doc.createElement("label");
  follow.className = "nobs-settings-field nobs-settings-check";
  const followBox = doc.createElement("input");
  followBox.type = "checkbox";
  followBox.name = "followPlayback";
  followBox.checked = followPlayback();
  const followLabel = doc.createElement("span");
  followLabel.textContent = t("settings.follow", lang);
  const followRow = doc.createElement("span");
  followRow.className = "nobs-settings-row";
  followRow.append(followBox, followLabel);
  const followHint = doc.createElement("small");
  followHint.textContent = t("settings.followHint", lang);
  follow.append(followRow, followHint);
  followBox.addEventListener("change", () => setSetting("followPlayback", followBox.checked));

  const cc = doc.createElement("label");
  cc.className = "nobs-settings-field nobs-settings-check";
  const ccBox = doc.createElement("input");
  ccBox.type = "checkbox";
  ccBox.name = "youtubeCaptions";
  ccBox.checked = youtubeCaptions();
  const ccLabel = doc.createElement("span");
  ccLabel.textContent = t("settings.captions", lang);
  const ccRow = doc.createElement("span");
  ccRow.className = "nobs-settings-row";
  ccRow.append(ccBox, ccLabel);
  cc.append(ccRow);
  ccBox.addEventListener("change", () => setSetting("youtubeCaptions", ccBox.checked));

  dialog.append(title, field, possible, follow, cc, close);
  doc.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return dialog;
}
