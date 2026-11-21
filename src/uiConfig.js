// web/src/uiConfig.js
//
// Which finding filters the player offers (admin group «Фильтры находок»,
// served read-only by GET /ui-config; the public demo bakes the same file).
// Hiding a category removes only its filter control -- the rail circle or
// the list chip -- never its claims. Anything missing, unreadable or slow
// counts as shown, so a failure changes nothing.
//
// Also the site-wide brand gradient on catalogue thumbnails (admin «Вид
// сайта», `thumbOverlay`): on unless the config says an explicit `false`;
// put on <html data-thumb-overlay="on|off"> for styles.css .nobs-thumb-fx.

export const FILTER_CATEGORIES = ["green", "yellow", "red", "insufficient", "white", "pending", "failed", "refs", "screen", "tags"];

/** Every category shown. */
export function allFiltersShown() {
  return Object.fromEntries(FILTER_CATEGORIES.map((c) => [c, true]));
}

/** {category: shown} from a /ui-config body: only an explicit `false` hides. */
export function normalizeFilters(body) {
  const given = body && typeof body === "object" ? body.filters : null;
  const out = allFiltersShown();
  if (given && typeof given === "object") for (const c of FILTER_CATEGORIES) if (given[c] === false) out[c] = false;
  return out;
}

/** Is this category's filter control offered? (No config: yes.) */
export function filterShown(filters, category) {
  return !filters || filters[category] !== false;
}

/** `flags` without the categories whose control is hidden. */
export function allowedFlags(filters, flags) {
  return [...(flags ?? [])].filter((f) => filterShown(filters, f));
}

/** Is the brand gradient laid over thumbnails? Only an explicit `false` turns it off. */
export function thumbOverlayOn(body) {
  return !(body && typeof body === "object" && body.thumbOverlay === false);
}

/** {filters, thumbOverlay} from a /ui-config body (null, junk: the defaults). */
export function normalizeUiConfig(body) {
  return { filters: normalizeFilters(body), thumbOverlay: thumbOverlayOn(body) };
}

/** GET /ui-config as {filters, thumbOverlay}, falling back to the defaults
 * (error, bad body, or slower than `timeoutMs`). */
export async function loadUiConfig(fetchImpl = globalThis.fetch, timeoutMs = 1500) {
  try {
    const body = await Promise.race([
      fetchImpl("/ui-config").then((r) => (r.ok ? r.json() : null)),
      new Promise((done) => setTimeout(() => done(null), timeoutMs)),
    ]);
    return normalizeUiConfig(body);
  } catch {
    return normalizeUiConfig(null);
  }
}

/** GET /ui-config, falling back to everything shown (error, bad body, or slower than `timeoutMs`). */
export async function fetchUiConfig(fetchImpl = globalThis.fetch, timeoutMs = 1500) {
  return (await loadUiConfig(fetchImpl, timeoutMs)).filters;
}

/** Put the thumbnail gradient switch on <html data-thumb-overlay>. */
export function applyThumbOverlay(doc, on) {
  doc?.documentElement?.setAttribute("data-thumb-overlay", on === false ? "off" : "on");
}

/** Fetch /ui-config and apply its thumbnail switch; resolves to the whole config. */
export async function initThumbOverlay(doc = globalThis.document, fetchImpl = globalThis.fetch, timeoutMs = 1500) {
  const cfg = await loadUiConfig(fetchImpl, timeoutMs);
  applyThumbOverlay(doc, cfg.thumbOverlay);
  return cfg;
}
