// web/src/railFilters.js
//
// Flag filters on the collapsed right panel (the narrow rail): one coloured
// circle per verdict present in the run. Several can be selected at once,
// like the chips in the open list (they share one selection). A selected
// circle is filled with its colour; an unselected one shows only a coloured
// outline over a muted fill. No selection means "all flags", and then every
// circle shows as selected: clicking one hides that verdict (the others stay
// selected); deselecting the last one, or reselecting all, goes back to "all".
//
// Top to bottom: green, not checked, not supported, (being checked, failed),
// yellow, red -- the most serious flag sits at the bottom.
//
// `filters` (src/uiConfig.js, the admin's «Фильтры находок»): a verdict the
// owner turned off gets no circle; its claims are unaffected. "All selected"
// is then judged over the circles shown, and a hidden verdict is never kept
// in the selection.

import { t } from "./i18n.js?v=a1c8a76876";
import { allowedFlags, filterShown } from "./uiConfig.js?v=a1c8a76876";

export const RAIL_ORDER = ["green", "white", "insufficient", "pending", "failed", "yellow", "red"];

/**
 * Build the rail filters. `counts` maps verdict -> number of claims;
 * `onChange(flags)` gets the new selection (array, empty = all).
 * Returns { root, update(selected) }.
 */
export function buildRailFilters(doc, { counts = {}, selected = [], lang = "en", filters = null, onChange = () => {} } = {}) {
  const root = doc.createElement("div");
  root.className = "nobs-rail-filters";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", t("rail.filters", lang));
  let current = new Set(allowedFlags(filters, selected));
  const buttons = [];
  for (const flag of RAIL_ORDER) {
    if (!counts[flag] || !filterShown(filters, flag)) continue;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "nobs-rail-flag";
    button.dataset.verdict = flag;
    // The count, shown inside the circle on a touch screen (no hover title there).
    button.dataset.count = String(counts[flag]);
    const label = `${t(`verdict.${flag}`, lang)}: ${counts[flag]}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      const present = buttons.map((b) => b.dataset.verdict);
      // "All" (empty) is shown as every circle selected: start from that.
      const next = current.size ? new Set(current) : new Set(present);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      const all = next.size === 0 || present.every((f) => next.has(f));
      current = all ? new Set() : next;
      render();
      onChange([...current]);
    });
    buttons.push(button);
    root.appendChild(button);
  }
  function render() {
    for (const b of buttons) b.setAttribute("aria-pressed", String(current.size === 0 || current.has(b.dataset.verdict)));
  }
  render();
  return {
    root,
    update(next) {
      current = new Set(allowedFlags(filters, next));
      render();
    },
  };
}
