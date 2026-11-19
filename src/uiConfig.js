// web/src/uiConfig.js
//
// Which finding filters the player offers (admin group «Фильтры находок»,
// served read-only by GET /ui-config; the public demo bakes the same file).
// Hiding a category removes only its filter control -- the rail circle or
// the list chip -- never its claims. Anything missing, unreadable or slow
// counts as shown, so a failure changes nothing.

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

/** GET /ui-config, falling back to everything shown (error, bad body, or slower than `timeoutMs`). */
export async function fetchUiConfig(fetchImpl = globalThis.fetch, timeoutMs = 1500) {
  try {
    const body = await Promise.race([
      fetchImpl("/ui-config").then((r) => (r.ok ? r.json() : null)),
      new Promise((done) => setTimeout(() => done(null), timeoutMs)),
    ]);
    return normalizeFilters(body);
  } catch {
    return allFiltersShown();
  }
}
