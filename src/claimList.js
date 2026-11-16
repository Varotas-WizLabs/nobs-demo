// web/src/claimList.js
//
// The list of the loaded run's claims under the player (outside the
// fullscreen element, so it shows only when not fullscreen). Each row is
// flag colour, timecode, what was said (a quote also shows who is quoted)
// and the plain-language summary;
// clicking it seeks the video to the claim's start and plays. Filter chips
// narrow the list by flag; a second row narrows it by presentation tag
// (combined with the flag filter: both must match). A row shows at most one
// tag chip ("+N" for the rest). The claim playing now is highlighted.
// "Possible" tags (tier) are pale with a «возможно:» prefix, count in the
// tag filters and match them; with "Show possible tags" off they are left
// out of the rows and the filters (the page redraws the list).
// Built with DOM APIs and textContent only.

import { formatTimecode } from "./claimSync.js";
import { claimVerdictLabel, isQuote, verdictKey } from "./popup.js";
import { t } from "./i18n.js";
import { claimHasTag, claimTags, isPossible, tagFilterOptions, tagLabel, tagTooltip } from "./tags.js";

// Filter chips by verdict: the white flag splits into "not supported"
// (checked, too little evidence) and "not checked" (opinion, prediction).
const FLAG_ORDER = ["green", "yellow", "red", "insufficient", "white"];

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Render the list into `root`. Returns { highlight(timeSec) } to mark the
 * claim(s) playing at that time.
 *
 * @param {HTMLElement} root
 * @param {object} run  a complete run from GET /runs/{id}
 * @param {{onSelect: (claim: object) => void,
 *   onFilterChange?: (state: {claims: object[], flag: string, tag: string}) => void}} options
 *   onFilterChange gets the claims the filters leave visible (so the
 *   timeline can show only their markers) after every filter change.
 */
export function renderClaimList(root, run, { onSelect, onFilterChange, followPlayback: followPlaybackSetting }) {
  const doc = root.ownerDocument;
  const lang = run.caption_language ?? "en";
  const claims = [...(run.claims ?? [])].sort((a, b) => a.start_sec - b.start_sec);
  let filter = "all";
  let tagFilter = "all";

  const section = el(doc, "section", "nobs-claims");
  section.lang = lang;
  const header = el(doc, "div", "nobs-claims-header");
  header.appendChild(el(doc, "h2", "nobs-claims-title", t("list.title", lang)));

  const chips = el(doc, "div", "nobs-claims-filters");
  const counts = Object.fromEntries(FLAG_ORDER.map((f) => [f, claims.filter((c) => verdictKey(c) === f).length]));
  const chipFor = (value, label, count) => {
    const chip = el(doc, "button", "nobs-claims-chip");
    // A verdict chip starts with its flag's coloured dot ("All" has none).
    if (value !== "all") {
      const dot = el(doc, "span", "nobs-chip-dot");
      dot.dataset.verdict = value;
      dot.setAttribute("aria-hidden", "true");
      chip.appendChild(dot);
    }
    chip.appendChild(doc.createTextNode(`${label} ${count}`));
    chip.type = "button";
    chip.dataset.filter = value;
    chip.setAttribute("aria-pressed", String(value === filter));
    chip.addEventListener("click", () => {
      // Clicking the selected chip again clears the filter.
      filter = value === filter && value !== "all" ? "all" : value;
      for (const c of chips.children) c.setAttribute("aria-pressed", String(c.dataset.filter === filter));
      applyFilter();
    });
    return chip;
  };
  chips.appendChild(chipFor("all", t("list.all", lang), claims.length));
  for (const flag of FLAG_ORDER) {
    if (counts[flag]) chips.appendChild(chipFor(flag, t(`verdict.${flag}`, lang), counts[flag]));
  }
  header.appendChild(chips);

  // Tag filter row: only tags present in this video; with a disclaimer.
  const tagOptions = tagFilterOptions(run);
  const tagChips = el(doc, "div", "nobs-claims-filters nobs-tag-filters");
  if (tagOptions.length) {
    tagChips.setAttribute("aria-label", t("tags.filter", lang));
    const tagChipFor = (value, label, count, title) => {
      const chip = el(doc, "button", "nobs-claims-chip nobs-tag-filter", `${label} ${count}`);
      chip.type = "button";
      chip.dataset.tagFilter = value;
      if (title) chip.title = title;
      chip.setAttribute("aria-pressed", String(value === tagFilter));
      chip.addEventListener("click", () => {
        tagFilter = value === tagFilter && value !== "all" ? "all" : value;
        for (const c of tagChips.children) c.setAttribute("aria-pressed", String(c.dataset.tagFilter === tagFilter));
        applyFilter();
      });
      return chip;
    };
    tagChips.appendChild(el(doc, "span", "nobs-tag-filter-label", `${t("tags.filter", lang)}:`));
    tagChips.appendChild(tagChipFor("all", t("list.all", lang), claims.length));
    for (const option of tagOptions) {
      const title = option.possible ? `${option.possible} ${t("tags.possibleCount", lang)}` : "";
      const chip = tagChipFor(option.tag_id, option.name, option.count, title);
      if (option.possible === option.count) chip.dataset.tier = "possible";
      tagChips.appendChild(chip);
    }
    header.appendChild(tagChips);
    header.appendChild(el(doc, "p", "tag-disclaimer nobs-claims-disclaimer", t("tags.disclaimer", lang)));
  }
  if (run.tags_status === "running") {
    header.appendChild(el(doc, "p", "nobs-tags-running", t("tags.running", lang)));
  }

  const list = el(doc, "ol", "nobs-claims-list");
  const rows = claims.map((claim) => {
    const item = el(doc, "li", "nobs-claims-item");
    item.dataset.flag = claim.flag;
    item.dataset.claimId = String(claim.id);
    const button = el(doc, "button", "nobs-claims-row");
    button.type = "button";
    const quote = isQuote(claim);
    const author = quote ? String(claim.quote.author ?? "").trim() : "";
    const quoteLabel = quote ? ` ${t("quote.label", lang)}${author ? ` (${author})` : ""}` : "";
    button.setAttribute(
      "aria-label",
      `${formatTimecode(claim.start_sec)} ${claimVerdictLabel(claim, lang)}${quoteLabel}: ${claim.text}`
    );
    if (quote) item.dataset.quote = "true";
    const dot = el(doc, "span", "nobs-claims-dot");
    dot.dataset.flag = claim.flag;
    const time = el(doc, "span", "nobs-claims-time", formatTimecode(claim.start_sec));
    const body = el(doc, "span", "nobs-claims-body");
    // A quote row: a quote glyph and who is quoted.
    if (quote) body.appendChild(el(doc, "span", "nobs-claims-quote", `\u275D ${author || t("quote.label", lang)}`));
    body.appendChild(el(doc, "span", "nobs-claims-text", claim.text));
    const summary = String(claim.summary ?? "").trim();
    if (summary) body.appendChild(el(doc, "span", "nobs-claims-summary", summary));
    // Solid tags first: the row's one chip is the surest.
    const rowTags = claimTags(claim).sort((a, b) => Number(isPossible(a)) - Number(isPossible(b)));
    if (rowTags.length) {
      const tagLine = el(doc, "span", "nobs-claims-tags");
      const first = el(doc, "span", "tag-chip tag-chip-small", tagLabel(rowTags[0], lang));
      first.dataset.tier = isPossible(rowTags[0]) ? "possible" : "solid";
      first.title = tagTooltip(rowTags[0], lang);
      tagLine.appendChild(first);
      if (rowTags.length > 1) {
        const more = el(doc, "span", "tag-more", `+${rowTags.length - 1}`);
        more.title = rowTags.slice(1).map((tag) => tagLabel(tag, lang)).join(", ");
        tagLine.appendChild(more);
      }
      body.appendChild(tagLine);
      button.setAttribute(
        "aria-label",
        `${button.getAttribute("aria-label")} (${t("tags.heading", lang)}: ${rowTags.map((tag) => tagLabel(tag, lang)).join(", ")})`
      );
    }
    button.append(dot, time, body);
    button.addEventListener("click", () => onSelect(claim));
    item.appendChild(button);
    list.appendChild(item);
    return { claim, item };
  });

  const empty = el(doc, "p", "nobs-claims-empty", t("list.empty", lang));
  empty.hidden = true;

  function applyFilter() {
    let shown = 0;
    for (const { claim, item } of rows) {
      const visible =
        (filter === "all" || verdictKey(claim) === filter) && (tagFilter === "all" || claimHasTag(claim, tagFilter));
      item.hidden = !visible;
      if (visible) shown += 1;
    }
    empty.hidden = shown > 0;
    onFilterChange?.({
      claims: rows.filter(({ item }) => !item.hidden).map(({ claim }) => claim),
      flag: filter,
      tag: tagFilter,
    });
  }

  // Scrolling along with playback (setting "followPlayback"). The list
  // scrolls inside its own scrolling panel only, never the page, and pauses
  // for a few seconds after the viewer scrolls it by hand.
  let lastFollowed = null;
  let pausedUntil = 0;
  const now = () => (globalThis.performance?.now?.() ?? Date.now());
  const follow = () => (followPlaybackSetting?.() ?? true) && now() >= pausedUntil;
  const scrollerOf = () => {
    for (let node = root; node && node !== doc.body; node = node.parentElement) {
      const style = doc.defaultView?.getComputedStyle?.(node);
      if (style && /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    }
    return null;
  };
  const pause = () => {
    pausedUntil = now() + 6000;
  };
  for (const type of ["wheel", "touchmove", "keydown"]) root.addEventListener(type, pause, { passive: true });
  function scrollIntoPanel(item) {
    const scroller = scrollerOf();
    if (!scroller || item.offsetParent === null) return;
    const box = scroller.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    // The pinned header covers the top of the panel: the visible list starts below it.
    const pinned = header.getBoundingClientRect?.().height ?? 0;
    const viewTop = box.top + pinned;
    const viewHeight = Math.max(box.bottom - viewTop, 0);
    // Already comfortably in view: leave it.
    if (rect.top >= viewTop + 40 && rect.bottom <= box.bottom - 40) return;
    const top = scroller.scrollTop + (rect.top - viewTop) - viewHeight / 3;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  section.append(header, list, empty);
  root.replaceChildren(section);

  return {
    highlight(timeSec) {
      let first = null;
      for (const { claim, item } of rows) {
        const active = timeSec >= claim.start_sec && timeSec < claim.end_sec;
        if (active) item.setAttribute("aria-current", "true");
        else item.removeAttribute("aria-current");
        if (active && !first && !item.hidden) first = item;
      }
      // Follow playback: when a new claim starts, scroll it into view.
      if (first && first !== lastFollowed) {
        lastFollowed = first;
        if (follow()) scrollIntoPanel(first);
      }
    },
  };
}
