// web/src/uiLang.js
//
// The interface language: Russian or English. The visitor's choice wins
// (chosen on the account page, kept in localStorage); a ?lang=ru|en
// link sets it too. Without a choice the browser's languages decide:
// Russian for ru / uk / be / kk, English otherwise.
//
// Content stays in its own language: claims, arguments and explanations are
// written in the video's language; only the labels around them follow this.

import { UI_LANGUAGES, setInterfaceLanguage, t } from "./i18n.js?v=cd9defe92d";

export const LANG_KEY = "nobs.lang";
const RUSSIAN_READERS = ["ru", "uk", "be", "kk"];

function base(tag) {
  return String(tag ?? "").split(/[-_]/)[0].toLowerCase();
}

/** The interface language for this visitor: "ru" or "en". */
export function detectUiLang({ search = "", storage = null, languages = [] } = {}) {
  const q = new URLSearchParams(search).get("lang");
  if (UI_LANGUAGES.includes(q)) return q;
  try {
    const saved = storage?.getItem(LANG_KEY);
    if (UI_LANGUAGES.includes(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  for (const tag of languages) {
    const b = base(tag);
    if (RUSSIAN_READERS.includes(b)) return "ru";
    if (b === "en") return "en";
  }
  return "en";
}

/** Remember the choice (best effort). */
export function saveUiLang(storage, lang) {
  try {
    storage?.setItem(LANG_KEY, lang);
  } catch {
    /* storage blocked: the choice lasts for this page */
  }
}

/** Detect, remember a ?lang= choice, and make every label use it. */
export function initUiLang({
  loc = globalThis.location,
  storage = globalThis.localStorage,
  nav = globalThis.navigator,
  doc = globalThis.document,
} = {}) {
  let store = null;
  try {
    store = storage ?? null;
  } catch {
    store = null;
  }
  const lang = detectUiLang({
    search: loc?.search ?? "",
    storage: store,
    languages: nav?.languages?.length ? nav.languages : [nav?.language].filter(Boolean),
  });
  if (UI_LANGUAGES.includes(new URLSearchParams(loc?.search ?? "").get("lang"))) saveUiLang(store, lang);
  setInterfaceLanguage(lang);
  if (doc?.documentElement) doc.documentElement.lang = lang;
  return lang;
}

/** Fill every [data-i18n] element of the page in the interface language. */
export function translatePage(doc, lang) {
  for (const el of doc.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n, lang);
  for (const el of doc.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle, lang);
}

/** Reload without a ?lang= that would override the new choice. */
export function reloadWithout(loc = globalThis.location) {
  const url = new URL(loc.href);
  if (url.searchParams.has("lang")) {
    url.searchParams.delete("lang");
    loc.replace(url.toString());
  } else {
    loc.reload();
  }
}
