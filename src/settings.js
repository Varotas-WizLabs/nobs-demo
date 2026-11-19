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
//
// voiceStyle: what the flag narrator reads aloud -- "casual" (default; a
// friend's short retelling, generated per run) or "normal" (the claim's
// summary). Applies without a reload.
//
// voiceEngine.<lang>: which voice reads, per language of the run.
//   "voiceEngine.ru": "piper:dmitri" (default; "system" on a phone, src/mobile.js), "piper:irina", "piper:denis",
//     "piper:ruslan" (generated in the browser), "silero" (the local sidecar;
//     offered only when it answers /voice/health) or "system" (the browser's
//     own voice). A value saved under the old single key "voiceEngine" is
//     taken over as the Russian choice.
//   "voiceEngine.he": "system" (the browser's he-IL voice; the default on the
//     public page) or a local engine "local:he:say" (Carmit), "local:he:pocket:<voice>"
//     -- offered only when GET /voice/engines lists it available. Unset, the
//     local app uses Carmit when available, else the system voice.
// Applies without a reload.
//
// commentator: the narrator's persona id (src/commentators.js; default
// "dushnila"). The dialog lists the personas the player loaded
// (setCommentators) with a «(пародия)» mark, and links to the management
// page (commentators.html). voiceStyle only concerns «душнила», so its field
// («Душнила зачитывает») shows only while «душнила» is chosen.

import { t } from "./i18n.js?v=af6df1c5e6";
import { BUILTINS, DEFAULT_COMMENTATOR, isParody, personaLabel } from "./commentators.js?v=af6df1c5e6";
import { baseLang, defaultHebrewEngine, localEngines } from "./voiceEngines.js?v=af6df1c5e6";
import { defaultRussianEngine, isMobileDevice } from "./mobile.js?v=af6df1c5e6";

const KEY = "nobs.settings";

export const DEFAULTS = Object.freeze({ seekLeadSec: 3, showPossibleTags: true, followPlayback: true, youtubeCaptions: false, showTagFilter: false, theme: "dark", voiceStyle: "casual", "voiceEngine.ru": null, "voiceEngine.he": null, voiceRewindSec: 1, showTimelineFlags: true, commentator: DEFAULT_COMMENTATOR });
export const VOICE_REWIND_MAX = 10;
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
  // Migration: the single pre-Hebrew "voiceEngine" key is the Russian choice.
  if (stored && typeof stored === "object" && stored.voiceEngine !== undefined) {
    if (stored["voiceEngine.ru"] === undefined) stored["voiceEngine.ru"] = stored.voiceEngine;
    delete stored.voiceEngine;
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

export const THEMES = ["dark", "light", "system"];

export const VOICE_STYLES = ["casual", "normal"];

export const VOICE_ENGINES = ["piper:dmitri", "piper:irina", "piper:denis", "piper:ruslan", "silero", "system"];

// Languages with a voice setting, in the dialog's default order.
export const VOICE_LANGS = ["ru", "he"];

/** The settings key of a language's voice ("voiceEngine.ru", "voiceEngine.he"). */
export function voiceEngineKey(lang = "ru") {
  return `voiceEngine.${baseLang(lang) === "he" ? "he" : "ru"}`;
}

// What GET /voice/engines answered (set by the player; {} when the sidecar is
// down or on the public page): the local engines the dialog offers.
let localVoices = {};
export function setLocalVoices(body) {
  localVoices = body && typeof body === "object" ? body : {};
}
/** Ids of the available local engines for `lang` ("local:he:say", ...). */
export function localVoiceIds(lang) {
  return localEngines(localVoices, lang).map((o) => o.id);
}

/** The Hebrew choices offered here: the system voice, then the available local engines. */
export function hebrewEngineOptions() {
  return ["system", ...localVoiceIds("he")];
}

/**
 * The chosen voice engine for a run language ("ru" by default):
 * Russian "piper:dmitri" unless changed; Hebrew the saved choice, else local
 * Carmit when available, else "system".
 */
export function voiceEngine(lang = "ru") {
  const base = baseLang(lang) === "he" ? "he" : "ru";
  const value = read()[voiceEngineKey(base)];
  if (base === "he") {
    if (value === "system" || (typeof value === "string" && value.startsWith("local:he:"))) return value;
    return defaultHebrewEngine(localVoiceIds("he"));
  }
  // Not chosen yet: Piper (dmitri) on a computer, the browser's own voice on
  // a phone (speaks at once; Piper's ~63 MB model is slow there).
  return VOICE_ENGINES.includes(value) ? value : defaultRussianEngine(isMobileDevice());
}

// Whether the local Silero voice answered /voice/health (set by the player);
// the dialog offers it only then.
let sileroAvailable = false;
export function setSileroAvailable(on) {
  sileroAvailable = Boolean(on);
}

// The personas the player loaded (GET /commentators); the built-ins until then.
let commentatorList = BUILTINS;
export function setCommentators(list) {
  commentatorList = Array.isArray(list) && list.length ? list : BUILTINS;
}
export function commentators() {
  return commentatorList;
}

/** The chosen commentator's id ("dushnila" unless changed). The player
 * falls back to «душнила» when the id is unknown or disabled. */
export function commentator() {
  const value = read().commentator;
  return typeof value === "string" && value ? value : DEFAULT_COMMENTATOR;
}

/** Link to the commentator management page. */
export const COMMENTATORS_PAGE = "commentators.html";

/** Link to the source reliability index page (web/sources.html). */
export const SOURCES_PAGE = "sources.html";

/** Link to the trust-signal connectors page (web/trust.html). */
export const TRUST_PAGE = "trust.html";

/** What the narrator reads: "casual" (default) or "normal". */
export function voiceStyle() {
  const value = read().voiceStyle;
  return VOICE_STYLES.includes(value) ? value : "casual";
}

/** The page theme setting: "dark" (default), "light" or "system". */
export function themeSetting() {
  const value = read().theme;
  return THEMES.includes(value) ? value : "dark";
}

/** The theme to draw now: "system" follows the OS light/dark preference. */
export function resolvedTheme(win = globalThis) {
  const theme = themeSetting();
  if (theme !== "system") return theme;
  return win.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let systemWatch = null;
/** Put the theme on <html data-theme> and follow OS changes while "system". */
export function applyTheme(doc = globalThis.document) {
  if (!doc?.documentElement) return;
  const win = doc.defaultView ?? globalThis;
  doc.documentElement.dataset.theme = resolvedTheme(win);
  if (!systemWatch && win.matchMedia) {
    systemWatch = win.matchMedia("(prefers-color-scheme: light)");
    systemWatch.addEventListener?.("change", () => {
      if (themeSetting() === "system") doc.documentElement.dataset.theme = resolvedTheme(win);
    });
  }
}

/** The "Подача" (presentation tag) filter row in the claim list (off by default). */
export function showTagFilter() {
  return read().showTagFilter === true;
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

/** Whether the flag markers are drawn on the video's timeline (setting "showTimelineFlags"). */
export function showTimelineFlags() {
  return read().showTimelineFlags !== false;
}

/** Seconds to step back when the video resumes after a narration (0..VOICE_REWIND_MAX, halves). */
export function clampRewind(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.voiceRewindSec;
  return Math.min(Math.max(Math.round(n * 2) / 2, 0), VOICE_REWIND_MAX);
}
export function voiceRewindSec() {
  return clampRewind(read().voiceRewindSec);
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

/** A Hebrew engine's label: "מערכת — ...", "Carmit (local)", "Pocket: Liat (local)". */
export function hebrewEngineLabel(id, lang = "en") {
  if (id === "system") return t("settings.voiceEngine.he.system", lang);
  const engine = String(id).replace(/^local:he:/, "");
  if (engine === "say") return t("settings.voiceEngine.he.say", lang);
  if (engine.startsWith("pocket:")) {
    const name = engine.slice("pocket:".length);
    return t("settings.voiceEngine.he.pocket", lang).replace("{name}", name.charAt(0).toUpperCase() + name.slice(1));
  }
  return engine;
}

function engineSelectField(doc, voiceLang, lang) {
  const base = voiceLang === "he" ? "he" : "ru";
  const key = voiceEngineKey(base);
  const field = doc.createElement("label");
  field.className = "nobs-settings-field";
  field.dataset.voiceLang = base;
  const label = doc.createElement("span");
  label.textContent = t(`settings.voiceEngine.${base}`, lang);
  const select = doc.createElement("select");
  select.name = key;
  select.className = "nobs-settings-select";
  const ids = base === "he" ? hebrewEngineOptions() : VOICE_ENGINES.filter((v) => v !== "silero" || sileroAvailable);
  for (const value of ids) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = base === "he" ? hebrewEngineLabel(value, lang) : t(`settings.voiceEngine.${value}`, lang);
    select.appendChild(option);
  }
  const chosen = voiceEngine(base);
  select.value = ids.includes(chosen) ? chosen : ids[0];
  select.addEventListener("change", () => setSetting(key, select.value));
  field.append(label, select);
  // A phone: Piper downloads ~63 MB once and speaks with a delay.
  if (base === "ru" && isMobileDevice()) {
    const note = doc.createElement("small");
    note.className = "nobs-settings-note";
    note.textContent = t("settings.voiceEngine.mobileNote", lang);
    field.append(note);
  }
  return field;
}

/**
 * The gear button that opens the settings dialog in the language `getLang()`
 * returns (the loaded run's). Used in the analyses panel and, on a shared
 * `?solo=1` page (no analyses panel), in the right panel's button bar.
 */
export function buildSettingsButton(doc, getLang = () => doc.body?.dataset.lang || "en") {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "nobs-side-toggle nobs-settings-button";
  button.setAttribute("aria-haspopup", "dialog");
  const label = () => {
    button.title = t("settings.title", getLang());
    button.setAttribute("aria-label", button.title);
  };
  label();
  button.appendChild(gearIcon(doc));
  button.addEventListener("click", () => {
    label();
    openSettingsDialog(doc, getLang());
  });
  return button;
}

/**
 * A shared `?solo=1` page has no analyses panel (and so no gear there): put
 * the gear into the right panel's button bar, after share / download when
 * they are there, else before the panel toggle. Idempotent: call again after
 * share / download were (re)built to keep the gear next to them.
 */
export function mountPanelSettings(bar, doc = bar.ownerDocument, getLang) {
  let gear = bar.querySelector(":scope > .nobs-settings-button");
  if (!gear) gear = buildSettingsButton(doc, getLang);
  const anchor = bar.querySelector(":scope > .nobs-share") ?? bar.querySelector(":scope > .nobs-export");
  if (anchor) anchor.after(gear);
  else {
    const toggle = [...bar.children].reverse().find((el) => el !== gear && el.classList.contains("nobs-side-toggle"));
    bar.insertBefore(gear, toggle ?? null);
  }
  return gear;
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

  // Flag markers on the timeline: shown or hidden.
  const flagsOnLine = doc.createElement("label");
  flagsOnLine.className = "nobs-settings-field nobs-settings-check";
  const flagsRow = doc.createElement("span");
  flagsRow.className = "nobs-settings-row";
  const flagsBox = doc.createElement("input");
  flagsBox.type = "checkbox";
  flagsBox.name = "showTimelineFlags";
  flagsBox.checked = showTimelineFlags();
  flagsBox.addEventListener("change", () => setSetting("showTimelineFlags", flagsBox.checked));
  const flagsLabel = doc.createElement("span");
  flagsLabel.textContent = t("settings.showTimelineFlags", lang);
  flagsRow.append(flagsBox, flagsLabel);
  flagsOnLine.append(flagsRow);

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

  const tagRow = doc.createElement("label");
  tagRow.className = "nobs-settings-field nobs-settings-check";
  const tagBox = doc.createElement("input");
  tagBox.type = "checkbox";
  tagBox.name = "showTagFilter";
  tagBox.checked = showTagFilter();
  const tagLabel = doc.createElement("span");
  tagLabel.textContent = t("settings.tagFilter", lang);
  const tagLine = doc.createElement("span");
  tagLine.className = "nobs-settings-row";
  tagLine.append(tagBox, tagLabel);
  tagRow.append(tagLine);
  tagBox.addEventListener("change", () => setSetting("showTagFilter", tagBox.checked));

  const themeField = doc.createElement("label");
  themeField.className = "nobs-settings-field";
  const themeLabel = doc.createElement("span");
  themeLabel.textContent = t("settings.theme", lang);
  const themeSelect = doc.createElement("select");
  themeSelect.name = "theme";
  themeSelect.className = "nobs-settings-select";
  for (const value of THEMES) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = t(`settings.theme.${value}`, lang);
    themeSelect.appendChild(option);
  }
  themeSelect.value = themeSetting();
  themeSelect.addEventListener("change", () => {
    setSetting("theme", themeSelect.value);
    applyTheme(doc);
  });
  themeField.append(themeLabel, themeSelect);

  const voiceField = doc.createElement("label");
  voiceField.className = "nobs-settings-field";
  const voiceLabel = doc.createElement("span");
  voiceLabel.textContent = t("settings.voiceStyle", lang);
  const voiceSelect = doc.createElement("select");
  voiceSelect.name = "voiceStyle";
  voiceSelect.className = "nobs-settings-select";
  for (const value of ["normal", "casual"]) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = t(`settings.voiceStyle.${value}`, lang);
    voiceSelect.appendChild(option);
  }
  voiceSelect.value = voiceStyle();
  voiceSelect.addEventListener("change", () => setSetting("voiceStyle", voiceSelect.value));
  voiceField.append(voiceLabel, voiceSelect);

  // The commentator (persona) and the link to the management page.
  const personaField = doc.createElement("div");
  personaField.className = "nobs-settings-field nobs-settings-persona";
  const personaPick = doc.createElement("label");
  personaPick.className = "nobs-settings-field";
  const personaLabelEl = doc.createElement("span");
  personaLabelEl.textContent = t("settings.commentator", lang);
  const personaSelect = doc.createElement("select");
  personaSelect.name = "commentator";
  personaSelect.className = "nobs-settings-select";
  const parodyMark = t("commentator.parody", lang);
  for (const profile of commentatorList) {
    if (profile.enabled === false) continue;
    const option = doc.createElement("option");
    option.value = profile.id;
    option.textContent = `${personaLabel(profile)}${profile.parody || isParody(profile) ? ` (${parodyMark})` : ""}`;
    personaSelect.appendChild(option);
  }
  const chosenPersona = commentator();
  personaSelect.value = [...personaSelect.options].some((o) => o.value === chosenPersona) ? chosenPersona : DEFAULT_COMMENTATOR;
  personaPick.append(personaLabelEl, personaSelect);
  // Managing commentators, sources, trust signals and the queue is the
  // operator's (the local admin page, «Админ» below), not the viewer's.
  personaField.append(personaPick);
  const showStyle = () => {
    voiceField.hidden = personaSelect.value !== DEFAULT_COMMENTATOR;
  };
  showStyle();
  personaSelect.addEventListener("change", () => {
    setSetting("commentator", personaSelect.value);
    showStyle();
  });

  // After the narration: resume this many seconds before the pause point.
  const rewindField = doc.createElement("label");
  rewindField.className = "nobs-settings-field";
  const rewindLabel = doc.createElement("span");
  rewindLabel.textContent = t("settings.voiceRewind", lang);
  const rewindRow = doc.createElement("span");
  rewindRow.className = "nobs-settings-row";
  const rewindInput = doc.createElement("input");
  rewindInput.type = "number";
  rewindInput.min = "0";
  rewindInput.max = String(VOICE_REWIND_MAX);
  rewindInput.step = "0.5";
  rewindInput.name = "voiceRewindSec";
  rewindInput.value = String(voiceRewindSec());
  const rewindUnit = doc.createElement("span");
  rewindUnit.textContent = t("settings.seconds", lang);
  rewindRow.append(rewindInput, rewindUnit);
  const rewindHint = doc.createElement("small");
  rewindHint.textContent = t("settings.voiceRewindHint", lang);
  rewindField.append(rewindLabel, rewindRow, rewindHint);
  rewindInput.addEventListener("input", () => {
    if (rewindInput.value !== "") setSetting("voiceRewindSec", clampRewind(rewindInput.value));
  });
  rewindInput.addEventListener("change", () => {
    const value = clampRewind(rewindInput.value);
    rewindInput.value = String(value);
    setSetting("voiceRewindSec", value);
  });

  // One voice select per language; the run's language first.
  const runVoice = baseLang(lang) === "he" ? "he" : "ru";
  const engineFields = [runVoice, ...VOICE_LANGS.filter((l) => l !== runVoice)].map((l) => engineSelectField(doc, l, lang));

  const testField = voiceTestField(doc, lang);

  const adminField = adminEntryField(doc);

  dialog.append(title, themeField, field, flagsOnLine, possible, follow, tagRow, cc, personaField, voiceField, rewindField, ...engineFields, ...(testField ? [testField] : []), ...(adminField ? [adminField] : []), close);
  doc.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return dialog;
}

// The operator's page: registered only by a local-app module that the public
// demo never ships, so this module holds no address of it. Without a
// registration the dialog shows no such link.
let adminEntry = null;
export function setAdminEntry(href, label) {
  adminEntry = typeof href === "string" && href ? { href, label: String(label || href) } : null;
}

function adminEntryField(doc) {
  if (!adminEntry || doc.documentElement?.dataset.demo === "1") return null;
  const box = doc.createElement("div");
  box.className = "nobs-settings-field nobs-settings-admin";
  const link = doc.createElement("a");
  link.className = "nobs-settings-link nobs-settings-admin-link";
  link.href = adminEntry.href;
  link.textContent = adminEntry.label;
  box.append(link);
  return box;
}

// «Проверить голос»: the player registers a tester (setVoiceTester); the
// dialog then shows the button. The tester runs inside the click (so the
// browser lets the speech play) and returns {lines, done}: status lines now
// and a promise of the lines once the test phrase ended or failed.
let voiceTester = null;
export function setVoiceTester(fn) {
  voiceTester = typeof fn === "function" ? fn : null;
}

function voiceTestField(doc, lang) {
  if (!voiceTester) return null;
  const box = doc.createElement("div");
  box.className = "nobs-settings-field nobs-voice-test";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "nobs-voice-test-button";
  button.textContent = t("settings.voiceTest", lang);
  const status = doc.createElement("pre");
  status.className = "nobs-voice-test-status";
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const render = (lines) => {
    status.textContent = (lines ?? []).join("\n");
    status.hidden = !status.textContent;
  };
  button.addEventListener("click", () => {
    let result;
    try {
      result = voiceTester();
    } catch (err) {
      render([String(err?.message ?? err)]);
      return;
    }
    render(result?.lines);
    Promise.resolve(result?.done)
      .then((lines) => {
        if (lines) render(lines);
      })
      .catch((err) => render([...(result?.lines ?? []), String(err?.message ?? err)]));
  });
  box.append(button, status);
  return box;
}

export const CODES_PAGE = "codes.html";

/**
 * The local server's public request queue settings (GET/PUT /queue/config),
 * shown on the admin page (no longer in the viewer's settings dialog):
 * «Интервал синхронизации очереди, сек» (10..600), on/off, and a link to
 * the invite codes page. Added only when the backend answers -- never in
 * the public demo (no backend; its shim refuses the path).
 */
export async function mountQueueSettings(dialog, before, lang = "en", fetchImpl = globalThis.fetch) {
  const doc = dialog.ownerDocument;
  if (doc.documentElement?.dataset.demo === "1" || typeof fetchImpl !== "function") return null;
  let config;
  try {
    const r = await fetchImpl("/queue/config");
    if (!r.ok) return null;
    config = await r.json();
  } catch {
    return null;
  }
  if (!config || typeof config.interval_sec !== "number") return null;
  const box = doc.createElement("div");
  box.className = "nobs-settings-field nobs-settings-queue";
  const head = doc.createElement("span");
  head.textContent = t("settings.queue", lang);
  box.appendChild(head);

  const intervalRow = doc.createElement("label");
  intervalRow.className = "nobs-settings-field";
  const intervalLabel = doc.createElement("span");
  intervalLabel.textContent = t("settings.queueInterval", lang);
  const input = doc.createElement("input");
  input.type = "number";
  input.min = "10";
  input.max = "600";
  input.step = "5";
  input.name = "queueIntervalSec";
  input.value = String(config.interval_sec);
  const hint = doc.createElement("small");
  hint.textContent = config.configured === false ? t("settings.queueOff", lang) : t("settings.queueHint", lang);
  intervalRow.append(intervalLabel, input, hint);

  const enabledRow = doc.createElement("label");
  enabledRow.className = "nobs-settings-field nobs-settings-check";
  const enabledLine = doc.createElement("span");
  enabledLine.className = "nobs-settings-row";
  const enabledBox = doc.createElement("input");
  enabledBox.type = "checkbox";
  enabledBox.name = "queueEnabled";
  enabledBox.checked = config.enabled !== false;
  const enabledLabel = doc.createElement("span");
  enabledLabel.textContent = t("settings.queueEnabled", lang);
  enabledLine.append(enabledBox, enabledLabel);
  enabledRow.append(enabledLine);

  const put = async (body) => {
    try {
      const r = await fetchImpl("/queue/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const next = await r.json();
        input.value = String(next.interval_sec);
        enabledBox.checked = next.enabled !== false;
      }
    } catch {
      // keep the field as typed; the next open shows the server's value
    }
  };
  input.addEventListener("change", () => {
    const value = Math.min(600, Math.max(10, Math.round(Number(input.value) || 30)));
    input.value = String(value);
    put({ interval_sec: value });
  });
  enabledBox.addEventListener("change", () => put({ enabled: enabledBox.checked }));

  const link = doc.createElement("a");
  link.className = "nobs-settings-link";
  link.href = CODES_PAGE;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = t("settings.manageCodes", lang);

  box.append(intervalRow, enabledRow, link);
  if (before?.parentNode === dialog) dialog.insertBefore(box, before);
  else dialog.appendChild(box);
  return box;
}
