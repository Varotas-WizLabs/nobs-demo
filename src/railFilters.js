// web/src/railFilters.js
//
// Flag filters on the collapsed right panel (the narrow rail): one coloured
// circle per verdict present in the run. Several can be selected at once,
// like the chips in the open list (they share one selection). A selected
// circle is filled with its colour; an unselected one shows only a coloured
// outline over a muted fill. No selection means "all flags".

import { t } from "./i18n.js?v=af6df1c5e6";

export const RAIL_ORDER = ["green", "yellow", "red", "insufficient", "white", "pending", "failed"];

/**
 * Build the rail filters. `counts` maps verdict -> number of claims;
 * `onChange(flags)` gets the new selection (array, empty = all).
 * Returns { root, update(selected) }.
 */
export function buildRailFilters(doc, { counts = {}, selected = [], lang = "en", onChange = () => {} } = {}) {
  const root = doc.createElement("div");
  root.className = "nobs-rail-filters";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", t("rail.filters", lang));
  let current = new Set(selected);
  const buttons = [];
  for (const flag of RAIL_ORDER) {
    if (!counts[flag]) continue;
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
      if (current.has(flag)) current.delete(flag);
      else current.add(flag);
      render();
      onChange([...current]);
    });
    buttons.push(button);
    root.appendChild(button);
  }
  function render() {
    for (const b of buttons) b.setAttribute("aria-pressed", String(current.has(b.dataset.verdict)));
  }
  render();
  return {
    root,
    update(next) {
      current = new Set(next ?? []);
      render();
    },
  };
}
