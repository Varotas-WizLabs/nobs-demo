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

import { formatTimecode } from "./claimSync.js?v=751d7428cc";
import { claimVerdictLabel, isQuote, isRef, verdictKey } from "./popup.js?v=751d7428cc";
import { t } from "./i18n.js?v=751d7428cc";
import { byTier, claimHasTag, claimTags, tagFilterOptions, tagLabel, tagTooltip, tierOf } from "./tags.js?v=751d7428cc";

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
export function renderClaimList(root, run, { onSelect, onFilterChange, followPlayback: followPlaybackSetting, showTagFilter = () => true }) {
  const doc = root.ownerDocument;
  const lang = run.caption_language ?? "en";
  const claims = [...(run.claims ?? [])].sort((a, b) => a.start_sec - b.start_sec);
  let filter = "all";
  let tagFilter = "all";
  // "References to videos": only claims about a discussed video (a toggle,
  // combined with the other filters; shown only when the run has any).
  let refFilter = false;

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
      for (const c of chips.children) {
        if (c.dataset.filter !== undefined) c.setAttribute("aria-pressed", String(c.dataset.filter === filter));
      }
      applyFilter();
    });
    return chip;
  };
  chips.appendChild(chipFor("all", t("list.all", lang), claims.length));
  for (const flag of FLAG_ORDER) {
    if (counts[flag]) chips.appendChild(chipFor(flag, t(`verdict.${flag}`, lang), counts[flag]));
  }
  const refCount = claims.filter(isRef).length;
  if (refCount) {
    const refChip = el(doc, "button", "nobs-claims-chip nobs-ref-filter", `${t("ref.filter", lang)} ${refCount}`);
    refChip.type = "button";
    refChip.dataset.refFilter = "refs";
    refChip.setAttribute("aria-pressed", "false");
    refChip.addEventListener("click", () => {
      refFilter = !refFilter;
      refChip.setAttribute("aria-pressed", String(refFilter));
      applyFilter();
    });
    chips.appendChild(refChip);
  }
  header.appendChild(chips);

  // Tag filter row: only tags present in this video; with a disclaimer.
  const tagOptions = tagFilterOptions(run);
  const tagChips = el(doc, "div", "nobs-claims-filters nobs-tag-filters");
  // The "Подача" (tag) filter row is optional (setting "showTagFilter").
  if (tagOptions.length && showTagFilter()) {
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
    // The disclaimer lives in the label's tooltip (and on every chip and
    // popup), not as a paragraph in the pinned header.
    const tagLabel = el(doc, "span", "nobs-tag-filter-label", `${t("tags.filter", lang)}:`);
    tagLabel.title = t("tags.disclaimer", lang);
    tagChips.appendChild(tagLabel);
    tagChips.appendChild(tagChipFor("all", t("list.all", lang), claims.length));
    for (const option of tagOptions) {
      const title = option.possible ? `${option.possible} ${t("tags.possibleCount", lang)}` : "";
      const chip = tagChipFor(option.tag_id, option.name, option.count, title);
      if (option.possible === option.count) chip.dataset.tier = "possible";
      tagChips.appendChild(chip);
    }
    header.appendChild(tagChips);
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
    // Solid tags first, then possible ones, then notes («Личное мнение»): the row's one chip is the surest.
    const rowTags = claimTags(claim).sort(byTier);
    if (rowTags.length) {
      const tagLine = el(doc, "span", "nobs-claims-tags");
      const first = el(doc, "span", "tag-chip tag-chip-small", tagLabel(rowTags[0], lang));
      first.dataset.tier = tierOf(rowTags[0]);
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
        (filter === "all" || verdictKey(claim) === filter) &&
        (tagFilter === "all" || claimHasTag(claim, tagFilter)) &&
        (!refFilter || isRef(claim));
      item.hidden = !visible;
      if (visible) shown += 1;
    }
    empty.hidden = shown > 0;
    if (lastTime != null) {
      lastFollowed = null;
      placeNowLine(lastTime);
      for (const { claim, item } of rows) {
        if (!item.hidden && lastTime >= claim.start_sec && lastTime < claim.end_sec) nowLine.hidden = true;
      }
    }
    onFilterChange?.({
      claims: rows.filter(({ item }) => !item.hidden).map(({ claim }) => claim),
      flag: filter,
      tag: tagFilter,
      ...(refCount ? { refs: refFilter } : {}),
    });
  }

  // Scrolling along with playback (setting "followPlayback"). The list
  // scrolls inside its own scrolling panel only, never the page. The playing
  // claim (or the "now" line) is kept in the vertical middle of the visible
  // list; near the start the panel simply stays at the top. When the viewer
  // scrolls by hand, following pauses until they have not scrolled for
  // RESUME_MS, then it returns to the middle.
  const RESUME_MS = 5000;
  const CENTER_SLACK_PX = 24;
  let lastFollowed = null;
  let pausedUntil = 0;
  let programmaticUntil = 0;
  let watchedScroller = null;
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
    pausedUntil = now() + RESUME_MS;
  };
  for (const type of ["wheel", "touchmove", "keydown"]) root.addEventListener(type, pause, { passive: true });

  // "Back to top" button, pinned to the bottom left of the panel.
  const toTop = el(doc, "button", "nobs-to-top");
  toTop.type = "button";
  toTop.title = t("list.toTop", lang);
  toTop.setAttribute("aria-label", toTop.title);
  toTop.hidden = true;
  {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 19V5M5 12l7-7 7 7");
    svg.appendChild(path);
    toTop.appendChild(svg);
  }
  toTop.addEventListener("click", () => {
    const scroller = scrollerOf() ?? watchedScroller;
    pause();
    scroller?.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Watch the panel's own scrolling: a scroll we did not start is the
  // viewer's (scrollbar drag included) and pauses following; it also shows
  // or hides the "back to top" button.
  function watch(scroller) {
    if (!scroller || scroller === watchedScroller) return;
    watchedScroller = scroller;
    scroller.addEventListener(
      "scroll",
      () => {
        if (now() > programmaticUntil) pause();
        toTop.hidden = scroller.scrollTop < 300;
      },
      { passive: true }
    );
  }

  function scrollIntoPanel(item) {
    const scroller = scrollerOf();
    watch(scroller);
    if (!scroller || item.offsetParent === null) return;
    const box = scroller.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    // The pinned header covers the top of the panel: the visible list starts below it.
    // Everything pinned above the list (the panel's button bar, then the
    // header) ends at the header's bottom edge.
    const headerBox = header.getBoundingClientRect?.();
    const viewTop = headerBox && headerBox.bottom > box.top ? headerBox.bottom : box.top;
    const viewMiddle = viewTop + Math.max(box.bottom - viewTop, 0) / 2;
    const itemMiddle = rect.top + (rect.bottom - rect.top) / 2;
    const delta = itemMiddle - viewMiddle;
    const target = Math.max(0, Math.min(scroller.scrollTop + delta, scroller.scrollHeight - scroller.clientHeight));
    // Close enough (or pinned at the top / bottom already): leave it.
    if (Math.abs(target - scroller.scrollTop) < CENTER_SLACK_PX) return;
    programmaticUntil = now() + 1200;
    scroller.scrollTo({ top: target, behavior: "smooth" });
  }

  // The "now" line: absolutely positioned in the list, so rows never move.
  let lastTime = null;
  let nowKey = null;
  const nowLine = el(doc, "li", "nobs-claims-now");
  nowLine.setAttribute("aria-hidden", "true");
  nowLine.hidden = true;
  const nowIcon = el(doc, "span", "nobs-claims-now-icon");
  nowIcon.title = t("list.playingHere", lang);
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 10 10");
  svg.setAttribute("width", "8");
  svg.setAttribute("height", "8");
  const tri = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  tri.setAttribute("d", "M2 1l7 4-7 4z");
  tri.setAttribute("fill", "currentColor");
  svg.appendChild(tri);
  nowIcon.appendChild(svg);
  nowLine.appendChild(nowIcon);
  list.appendChild(nowLine);

  function placeNowLine(timeSec) {
    const visible = rows.filter(({ item }) => !item.hidden);
    if (!visible.length || timeSec == null) {
      nowLine.hidden = true;
      nowKey = null;
      return null;
    }
    const nextIndex = visible.findIndex(({ claim }) => claim.start_sec > timeSec);
    let top;
    if (nextIndex === 0) top = visible[0].item.offsetTop;
    else if (nextIndex === -1) {
      const last = visible[visible.length - 1].item;
      top = last.offsetTop + last.offsetHeight;
    } else {
      const prev = visible[nextIndex - 1].item;
      const next = visible[nextIndex].item;
      top = (prev.offsetTop + prev.offsetHeight + next.offsetTop) / 2;
    }
    nowLine.style.top = `${top}px`;
    nowLine.hidden = false;
    nowKey = `gap:${nextIndex === -1 ? "end" : visible[nextIndex].claim.id}`;
    return nowLine;
  }

  section.append(header, list, empty, toTop);
  root.replaceChildren(section);

  return {
    highlight(timeSec) {
      lastTime = timeSec;
      let first = null;
      for (const { claim, item } of rows) {
        const active = timeSec >= claim.start_sec && timeSec < claim.end_sec;
        if (active) item.setAttribute("aria-current", "true");
        else item.removeAttribute("aria-current");
        if (active && !first && !item.hidden) first = item;
      }
      // Between findings (or on a claim the filters hide): a thin "now"
      // line between the visible rows, laid over the gap without moving them.
      const target = first ?? placeNowLine(timeSec);
      if (first) nowLine.hidden = true;
      // Follow playback: keep the playing claim (or the "now" line) in the
      // middle of the panel; checked on every tick, so it also returns there
      // after a manual scroll once the pause is over.
      lastFollowed = first ?? nowKey;
      if (target && follow()) scrollIntoPanel(target);
      else watch(scrollerOf());
    },
  };
}
