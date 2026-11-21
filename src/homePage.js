// web/src/homePage.js
//
// The home page (web/request.html; the public site's index.html): every
// finished analysis as a grid of cards, a video-site layout with Skeptium's
// own content.
//
// * Top bar: menu button, logo, the search field in the middle (src/homeSearch.js),
//   the account corner on the right (src/accountMenu.js; its «Question a
//   video» button opens the request lightbox).
// * Left rail: Home, Library of analyses, Commentators, Sources, Trust and
//   the «You» section (signed in: the account; signed out: sign in). Below
//   1100 px it is a drawer the menu button opens.
// * Chips (src/homeFilters.js), then the cards: thumbnail with the video
//   length and a Deep badge (Light, the default, has none); the channel's avatar (its picture, cached
//   at build time, else its initial on a neutral tone: src/channelAvatar.js),
//   the title (two lines) and ONE meta row: channel · date (ellipsised) with
//   the verdict counts at its end (they add up to the claims). Beside each
//   card (it is one link, so not inside it) a «More» button on the title's
//   first line opens Copy link / Share / Open video (src/cardMenu.js).
// * The unfiltered feed: the two newest rows, a «Deep analyses» shelf (one
//   row), the rest in date order, then an end marker (renderGrid).
// * Searching (?q=) swaps the grid for the results view: rows with the
//   matches highlighted, the matching claims under each, or an empty state.
// * Phones (<=760 px): a bottom tab bar (Home, Library, Voices, You); «You»
//   opens a sheet with the rail's «You» actions and the top bar drops the
//   account corner, leaving the menu, logo and search.
// * Signed out, a call to action: sign in to question a video, or use an
//   invite code. Wide screens hide it (styles.css) while the full rail
//   shows «You» with the same two actions; the top bar keeps sign-in. The
//   invite lightbox (src/publicRequest.js; an invite link
//   #code=… opens it with the code filled, a pending request reopens it).
//
// Everything is built with DOM APIs and textContent: titles, channels and
// claims come from YouTube and the analyses and are never parsed as HTML.

import { t } from "./i18n.js?v=d9665ac097";
import { counted, th } from "./stringsHome.js?v=d9665ac097";
import { buildSearchIndex, highlightInto, mountSearchBox, queryTerms, search, snippet } from "./homeSearch.js?v=d9665ac097";
import { chipsFor, filterRuns, mountChipScroller, renderChips, renderFilterMenu } from "./homeFilters.js?v=d9665ac097";
import { VIDEO_ID_RE } from "./youtubeId.js?v=d9665ac097";
import { channelAvatar } from "./channelAvatar.js?v=d9665ac097";
import { moreButton, mountCardMenu } from "./cardMenu.js?v=d9665ac097";

const FLAGS = ["green", "yellow", "red", "white"];
const DRAWER_QUERY = "(max-width: 1099px)";
const TABBAR_QUERY = "(max-width: 760px)";
const ACCOUNT_HREF = "account.html";

/** "7:23", "1:05:09" for a length in seconds; "" when unknown. */
export function formatVideoDuration(sec) {
  const s = Math.round(Number(sec));
  if (!Number.isFinite(s) || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** "19 Nov 2026" / "19 нояб. 2026 г." in the interface language. */
export function formatDate(iso, lang = "ru") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

/** A card's date: day and month, plus the year only when it is not this year. */
export function formatCardDate(iso, lang = "ru", now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const opts = { day: "numeric", month: "short" };
  if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", opts);
}

export function playerHref(run) {
  return `player.html?run_id=${Number(run.run_id)}`;
}

function el(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null && text !== "") node.textContent = text;
  return node;
}

function thumb(doc, run, lang, { deepBadge = true } = {}) {
  const box = el(doc, "div", "nobs-hp-thumb");
  if (VIDEO_ID_RE.test(run.video_id ?? "")) {
    const img = doc.createElement("img");
    img.src = `https://i.ytimg.com/vi/${run.video_id}/hqdefault.jpg`;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    box.append(img);
  }
  // Light is the default and carries no overlay: only the exception (Deep,
  // or a Deep version on its way) is marked on the artwork. Inside the Deep
  // shelf the heading already says Deep, so its cards carry no Deep badge.
  const kind = run.upgrading ? "upgrading" : run.effort === "deep" && deepBadge ? "deep" : "";
  if (kind) box.append(el(doc, "span", `nobs-hp-badge nobs-hp-badge-${kind}`, t(`home.badge.${kind}`, lang)));
  const time = formatVideoDuration(run.video_duration_sec);
  if (time) {
    const d = el(doc, "span", "nobs-hp-duration", time);
    d.setAttribute("aria-label", th("home.duration", { time }, lang));
    box.append(d);
  }
  return box;
}

function avatar(doc, run) {
  return channelAvatar(doc, { name: run.channel || run.title || "?", src: run.channel ? run.channel_avatar : "" });
}

/** The verdict counts as labelled chips (dot + number; the label in title/aria). */
export function verdictChips(doc, run, lang = "ru", { flags = FLAGS } = {}) {
  const row = el(doc, "span", "nobs-hp-verdicts");
  row.setAttribute("role", "list");
  row.setAttribute("aria-label", t("home.verdicts", lang));
  for (const f of flags) {
    const n = run.flags?.[f] ?? 0;
    if (!n) continue;
    const chip = el(doc, "span", `nobs-hp-verdict nobs-hp-verdict-${f}`);
    chip.setAttribute("role", "listitem");
    const label = th(`home.verdict.${f}`, { n }, lang);
    chip.title = label;
    chip.setAttribute("aria-label", label);
    const dot = el(doc, "span", `nobs-hp-dot nobs-hp-dot-${f}`);
    dot.setAttribute("aria-hidden", "true");
    chip.append(dot, doc.createTextNode(String(n)));
    row.append(chip);
  }
  return row;
}

function metaLine(doc, run, lang) {
  const meta = el(doc, "span", "nobs-hp-meta");
  meta.textContent = [counted(run.claim_count ?? 0, "home.claims", lang), formatDate(run.created_at, lang)].filter(Boolean).join(" · ");
  return meta;
}

function flagTotal(run) {
  return FLAGS.reduce((sum, f) => sum + (Number(run.flags?.[f]) || 0), 0);
}

/** The verdicts a card shows in its meta row; «not checked» is left to the label. */
const CARD_FLAGS = FLAGS.filter((f) => f !== "white");

/**
 * A card's one meta row: «channel · short date», then the checked verdict
 * counts at its end. The channel has priority (CSS caps the counts' share);
 * the « · » separators are drawn by CSS before each part after the first, so
 * an ellipsis sits right against the dot. When all the counts add up to the
 * claims they stand in for «350 claims» (named, with the unchecked count, in
 * the row's tooltip and the counts' label); the claims stay in the text when
 * no checked count shows or the counts do not add up.
 */
function cardMeta(doc, run, lang, now) {
  const row = el(doc, "div", "nobs-hp-meta-row");
  const meta = el(doc, "span", "nobs-hp-meta");
  const claims = counted(run.claim_count ?? 0, "home.claims", lang);
  const total = flagTotal(run);
  const shown = CARD_FLAGS.some((f) => Number(run.flags?.[f]) > 0);
  const countsAreClaims = shown && total === Number(run.claim_count ?? total);
  const parts = [];
  if (run.channel) parts.push(["channel", run.channel]);
  if (!countsAreClaims) parts.push(["claims", claims]);
  const date = formatCardDate(run.created_at, lang, now);
  if (date) parts.push(["date", date]);
  parts.forEach(([kind, text], i) => meta.append(el(doc, "span", `nobs-hp-meta-${kind}${i ? " nobs-hp-meta-sep" : ""}`, text)));
  const white = Number(run.flags?.white) || 0;
  const unchecked = white ? th("home.verdict.white", { n: white }, lang) : "";
  // The full line (claims, the unchecked count, the full date) for when the row is cut short.
  row.title = [run.channel, claims, unchecked, formatDate(run.created_at, lang)].filter(Boolean).join(" · ");
  row.append(meta);
  if (shown) {
    const chips = verdictChips(doc, run, lang, { flags: CARD_FLAGS });
    chips.setAttribute("aria-label", `${t("home.verdicts", lang)}: ${[claims, unchecked].filter(Boolean).join(", ")}`);
    row.append(chips);
  }
  return row;
}

/** One card of the grid: a link to the analysis (`deepBadge: false` inside the Deep shelf). */
export function renderCard(doc, run, lang = "ru", now = new Date(), { deepBadge = true } = {}) {
  const card = el(doc, "a", "nobs-hp-card");
  card.href = playerHref(run);
  card.dataset.runId = String(Number(run.run_id));
  card.append(thumb(doc, run, lang, { deepBadge }));
  const body = el(doc, "div", "nobs-hp-card-body");
  const text = el(doc, "div", "nobs-hp-card-text");
  const title = el(doc, "h3", "nobs-hp-title", run.title || run.video_id || `#${run.run_id}`);
  text.append(title);
  text.append(cardMeta(doc, run, lang, now));
  body.append(avatar(doc, run), text);
  card.append(body);
  return card;
}

/** The grid's track: cards at least 320px wide, 16px apart (styles.css .nobs-hp-grid). */
const CARD_MIN = 320;
const CARD_GAP = 16;
/** How many rows of the newest analyses come before the shelf. */
const LEAD_ROWS = 2;

/** The number of grid columns for a feed `width` px wide (3 when it is not laid out). */
export function gridColumns(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 3;
  return Math.max(1, Math.floor((w + CARD_GAP) / (CARD_MIN + CARD_GAP)));
}

/** A one-column feed (a phone) shows the shelf as a swipeable row of 2 to 4 cards. */
const ROW_SHELF_MIN = 2;
const ROW_SHELF_MAX = 4;

/**
 * The unfiltered feed in sections: the newest `LEAD_ROWS` rows, then the
 * «Deep analyses» shelf (one row of the Deep runs that come after them),
 * then everything else in date order. Every run appears once. No shelf
 * (one section) when there are no Deep runs past the lead rows. In one
 * column the shelf is a horizontal row (styles.css .nobs-hp-shelf-row) of
 * 2 to 4 cards; with fewer than 2 there is no shelf, the Deep chip filters.
 */
export function feedSections(runs, columns = 3) {
  const cols = Math.max(1, Number(columns) || 1);
  const lead = runs.slice(0, LEAD_ROWS * cols);
  const after = runs.slice(lead.length);
  const row = cols === 1;
  const shelf = after.filter((r) => r.effort === "deep").slice(0, row ? ROW_SHELF_MAX : cols);
  if (!shelf.length || (row && shelf.length < ROW_SHELF_MIN)) return { lead: runs, shelf: [], rest: [] };
  return { lead, shelf, rest: after.filter((r) => !shelf.includes(r)) };
}

/** A grid cell: the card (one link) and its «More» button beside it. */
export function renderItem(doc, run, lang = "ru", now = new Date(), cardOptions = {}) {
  const item = el(doc, "div", "nobs-hp-item");
  item.append(renderCard(doc, run, lang, now, cardOptions), moreButton(doc, run, lang));
  return item;
}

function cardGrid(doc, runs, lang, cls = "", cardOptions = {}) {
  const grid = el(doc, "div", `nobs-hp-grid${cls ? ` ${cls}` : ""}`);
  for (const run of runs) grid.append(renderItem(doc, run, lang, new Date(), cardOptions));
  return grid;
}

/**
 * The grid of cards (or its empty state) into `root`. Unfiltered and with
 * `columns` known, the feed is split by the Deep shelf (feedSections); every
 * list ends with an end marker naming how many analyses it held.
 */
export function renderGrid(root, runs, lang = "ru", { filtered = false, onShowAll = null, columns = 0, onShelf = null } = {}) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  if (!runs.length) {
    const empty = el(doc, "div", "nobs-hp-empty");
    empty.append(el(doc, "p", "nobs-hp-empty-title", t(filtered ? "home.emptyFilter" : "home.empty", lang)));
    if (filtered && onShowAll) {
      const b = el(doc, "button", "nobs-hp-button", t("home.showAll", lang));
      b.type = "button";
      b.addEventListener("click", onShowAll);
      empty.append(b);
    }
    root.append(empty);
    return 0;
  }
  const { lead, shelf, rest } = !filtered && columns ? feedSections(runs, columns) : { lead: runs, shelf: [], rest: [] };
  root.append(cardGrid(doc, lead, lang));
  if (shelf.length) {
    const section = el(doc, "section", `nobs-hp-shelf${columns === 1 ? " nobs-hp-shelf-row" : ""}`);
    section.setAttribute("aria-labelledby", "home-shelf-deep");
    const head = el(doc, "div", "nobs-hp-shelf-head");
    const title = el(doc, "h2", "nobs-hp-shelf-title", t("home.shelf.deep", lang));
    title.id = "home-shelf-deep";
    head.append(title, el(doc, "span", "nobs-hp-shelf-note", t("home.shelf.deepNote", lang)));
    if (onShelf) {
      // A quiet text link with a chevron next to the heading, not a second
      // pill beside the bar's Sign in (styles.css .nobs-hp-shelf-all).
      const all = el(doc, "button", "nobs-hp-shelf-all");
      all.append(el(doc, "span", "", t("home.shelf.all", lang)), svgIcon(doc, "M9 6l6 6-6 6", 16));
      all.type = "button";
      all.addEventListener("click", () => onShelf("deep"));
      head.append(all);
    }
    section.append(head, cardGrid(doc, shelf, lang, "nobs-hp-shelf-grid", { deepBadge: false }));
    root.append(section);
    if (rest.length) root.append(cardGrid(doc, rest, lang));
  }
  const end = el(doc, "p", "nobs-hp-end");
  end.append(el(doc, "span", "nobs-hp-end-text", th(filtered ? "home.end.filtered" : "home.end", { count: counted(runs.length, "search.analyses", lang) }, lang)));
  root.append(end);
  return runs.length;
}

/** The results view: a heading and one row per analysis, or the empty state. */
export function renderResults(root, results, query, lang = "ru", { onShowAll = null } = {}) {
  const doc = root.ownerDocument;
  const terms = queryTerms(query);
  root.replaceChildren();
  if (!results.length) {
    const empty = el(doc, "div", "nobs-hp-empty nobs-hp-search-empty");
    empty.setAttribute("role", "status");
    const icon = el(doc, "span", "nobs-hp-empty-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.append(searchIcon(doc, 48));
    empty.append(icon, el(doc, "p", "nobs-hp-empty-title", th("search.emptyTitle", { q: query }, lang)),
      el(doc, "p", "nobs-hp-empty-hint", t("search.emptyHint", lang)));
    if (onShowAll) {
      const b = el(doc, "button", "nobs-hp-button", t("home.showAll", lang));
      b.type = "button";
      b.addEventListener("click", onShowAll);
      empty.append(b);
    }
    root.append(empty);
    return 0;
  }
  const head = el(doc, "p", "nobs-hp-results-count", counted(results.length, "search.results", lang).replace("{q}", query));
  head.setAttribute("role", "status");
  const list = el(doc, "ol", "nobs-hp-results");
  for (const result of results) {
    const run = result.run;
    const li = el(doc, "li", "nobs-hp-result");
    const link = el(doc, "a", "nobs-hp-result-link");
    link.href = playerHref(run);
    link.dataset.runId = String(Number(run.run_id));
    link.append(thumb(doc, run, lang));
    const body = el(doc, "div", "nobs-hp-result-body");
    body.append(highlightInto(el(doc, "h3", "nobs-hp-title"), run.title || run.video_id || `#${run.run_id}`, terms));
    const who = el(doc, "span", "nobs-hp-result-channel");
    if (run.channel) who.append(avatar(doc, run), highlightInto(el(doc, "span", "nobs-hp-channel"), run.channel, terms));
    body.append(who, metaLine(doc, run, lang), verdictChips(doc, run, lang));
    if (result.claims.length) {
      const claims = el(doc, "ul", "nobs-hp-result-claims");
      for (const claim of result.claims) {
        const item = el(doc, "li", "nobs-hp-result-claim");
        const flag = FLAGS.includes(claim.flag) ? claim.flag : "white";
        const dot = el(doc, "span", `nobs-hp-dot nobs-hp-dot-${flag}`);
        dot.setAttribute("role", "img");
        dot.setAttribute("aria-label", t(`verdict.${flag}`, lang));
        dot.title = t(`verdict.${flag}`, lang);
        item.append(dot, highlightInto(el(doc, "span", "nobs-hp-claim-text"), snippet(claim.text, terms), terms));
        claims.append(item);
      }
      body.append(claims);
      if (result.claimCount > result.claims.length) {
        body.append(el(doc, "span", "nobs-hp-result-more", counted(result.claimCount, "search.claimsMatched", lang)));
      }
    }
    link.append(body);
    li.append(link);
    list.append(li);
  }
  root.append(head, list);
  return results.length;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgIcon(doc, d, size = 24) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
export function searchIcon(doc, size = 24) {
  return svgIcon(doc, "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.3 15.3 20 20", size);
}

// ---- the «You» section of the rail and the signed-out call to action -------------------------------------

/** Account state from the top bar's corner: "in", "out" (sign-in offered) or "none". */
export function accountState(bar) {
  if (bar?.querySelector(".nobs-account-avatar")) return "in";
  if (bar?.querySelector(".nobs-account-login")) return "out";
  return "none";
}

function renderYou(root, state, lang, { onAsk, onCode }) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  root.hidden = state === "none" && !onCode;
  root.append(el(doc, "h2", "nobs-hp-rail-heading", t("home.you", lang)));
  if (state === "in") {
    const account = el(doc, "a", "nobs-hp-rail-item", t("home.you.account", lang));
    account.href = ACCOUNT_HREF;
    account.prepend(svgIcon(doc, "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0"));
    const ask = el(doc, "button", "nobs-hp-rail-item", t("home.you.ask", lang));
    ask.type = "button";
    ask.prepend(svgIcon(doc, "M12 5v14M5 12h14"));
    ask.addEventListener("click", onAsk);
    root.append(account, ask);
    return;
  }
  root.append(el(doc, "p", "nobs-hp-rail-note", t("home.you.signedOut", lang)));
  if (state === "out") {
    const signIn = el(doc, "a", "nobs-hp-signin", t("home.you.signIn", lang));
    signIn.href = ACCOUNT_HREF;
    signIn.prepend(svgIcon(doc, "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0", 20));
    root.append(signIn);
  }
  if (onCode) {
    // A plain 40px rail row (icon + label), like the nav above it.
    const code = el(doc, "button", "nobs-hp-rail-item nobs-hp-rail-code");
    code.type = "button";
    code.append(svgIcon(doc, "M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM14 6v2.5M14 11v2M14 15.5V18"), el(doc, "span", "", t("home.you.code", lang)));
    code.addEventListener("click", onCode);
    root.append(code);
  }
}

// ---- a small dialog helper (the invite lightbox, the drawer) ----------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function trapTab(e, box, doc) {
  const items = [...box.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest("[hidden]"));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (doc.activeElement === first || !box.contains(doc.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (doc.activeElement === last || !box.contains(doc.activeElement))) {
    e.preventDefault();
    first.focus();
  }
}

/** Open/close a modal overlay (`backdrop` holding `box`). Returns {open, close, isOpen}. */
export function makeOverlay(doc, backdrop, box, { onClose = null, focusFirst = null } = {}) {
  let opener = null;
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") trapTab(e, box, doc);
  };
  function open(from = doc.activeElement) {
    if (!backdrop.hidden) return;
    opener = from;
    backdrop.hidden = false;
    doc.documentElement.classList.add("nobs-modal-open");
    doc.addEventListener("keydown", onKey, true);
    (focusFirst?.() ?? box.querySelector(FOCUSABLE))?.focus?.();
  }
  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    doc.documentElement.classList.remove("nobs-modal-open");
    doc.removeEventListener("keydown", onKey, true);
    onClose?.();
    if (opener?.isConnected) opener.focus?.();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  return { open, close, isOpen: () => !backdrop.hidden };
}

// ---- the page ------------------------------------------------------------------------------------------

/** ?q= and ?chip= of an address. */
export function readState(search) {
  const p = new URLSearchParams(search ?? "");
  return { q: (p.get("q") ?? "").trim(), chip: p.get("chip") || "all" };
}

/** The address for a state (other parameters and the fragment kept). */
export function stateHref(loc, { q, chip }) {
  const u = new URL(String(loc.href));
  if (q) u.searchParams.set("q", q);
  else u.searchParams.delete("q");
  if (chip && chip !== "all") u.searchParams.set("chip", chip);
  else u.searchParams.delete("chip");
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Mount the home page. `els` are the page's elements (see web/request.html).
 * Returns {state, setQuery, setChip, ready} for tests.
 */
export function mountHome({
  doc = globalThis.document,
  win = globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  lang = "ru",
  els,
  navigate = (href) => {
    win.location.href = href;
  },
  onInvite = null,
  now = () => Date.now(),
}) {
  const state = { runs: [], claims: null, index: [], ...readState(win?.location?.search), loaded: false };
  let claimsPromise = null;
  let lastAccount = null; // the account corner's state (accountState)
  const chipScroller = els.chips ? mountChipScroller(els.chips, lang, win) : null;
  let columns = 0; // the grid's column count at the last draw (gridColumns)
  const feedColumns = () => gridColumns(els.grid.clientWidth || els.main?.clientWidth || 0);
  // The shelf's «All Deep»: the Deep chip, from the top of the list.
  const showShelf = (id) => {
    setChip(id);
    if (doc.documentElement) doc.documentElement.scrollTop = 0;
  };

  function rebuildIndex() {
    state.index = buildSearchIndex(state.runs, state.claims);
  }

  function ensureClaims() {
    if (!claimsPromise) {
      claimsPromise = Promise.resolve()
        .then(() => fetchImpl("/search-index"))
        .then((r) => (r?.ok ? r.json() : null))
        .then((body) => {
          if (body?.claims) {
            state.claims = body;
            rebuildIndex();
            if (state.q) draw();
          }
        })
        .catch(() => {});
    }
    return claimsPromise;
  }

  function pushState() {
    try {
      win.history.pushState(null, "", stateHref(win.location, state));
    } catch {
      // a sandboxed frame: the view still changes
    }
  }

  function draw() {
    // Before the list is in, every chip but All is unknown: keep the address's chip.
    const chips = chipsFor(state.runs, lang, now());
    const shown = renderChips(els.chips, chips, state.chip, (id) => setChip(id), lang);
    if (chipScroller) renderFilterMenu(chipScroller.filters, chips, shown, (id) => setChip(id), lang);
    if (state.loaded) state.chip = shown;
    const visible = filterRuns(state.runs, state.chip, now());
    els.chips.hidden = !state.loaded || state.runs.length < 2;
    if (chipScroller) {
      chipScroller.bar.hidden = els.chips.hidden;
      chipScroller.update();
    }
    const showAll = () => {
      state.chip = "all";
      setQuery("");
      els.main?.focus?.({ preventScroll: true });
    };
    if (state.q) {
      els.grid.hidden = true;
      els.results.hidden = false;
      const results = search(state.index, state.q).filter((r) => visible.includes(r.run));
      renderResults(els.results, results, state.q, lang, { onShowAll: showAll });
    } else {
      els.results.hidden = true;
      els.grid.hidden = false;
      if (state.loaded) {
        columns = feedColumns();
        renderGrid(els.grid, visible, lang, { filtered: state.chip !== "all", onShowAll: showAll, columns, onShelf: showShelf });
      }
    }
    if (els.input.value.trim() !== state.q) els.input.value = state.q;
    els.clear.hidden = !els.input.value;
    // Searching: no call to action, and on a phone the query stays in the bar.
    if (els.cta) els.cta.hidden = lastAccount === "in" || Boolean(state.q);
    if (state.q) els.bar.dataset.search = "open";
    doc.title = state.q ? `${state.q} — Skeptium` : t("home.pageTitle", lang);
  }

  function setQuery(q, { push = true } = {}) {
    state.q = String(q ?? "").trim();
    if (state.q) ensureClaims();
    if (push) pushState();
    draw();
    if (state.q) els.main?.scrollTo?.({ top: 0 });
  }

  function setChip(id) {
    state.chip = id || "all";
    pushState();
    draw();
    // The chips were redrawn: keep the focus on the chosen one.
    const chip = [...els.chips.querySelectorAll("[data-chip]")].find((b) => b.dataset.chip === state.chip);
    (chip ?? chipScroller?.filters.querySelector(".nobs-hp-filters-button"))?.focus?.();
  }

  const cardMenu = mountCardMenu({
    doc,
    win,
    roots: [els.grid],
    findRun: (id) => state.runs.find((r) => Number(r.run_id) === id),
    lang,
  });

  const box = mountSearchBox({
    doc,
    els: { form: els.form, input: els.input, clear: els.clear, list: els.suggest },
    lang,
    getIndex: () => state.index,
    ensureClaims,
    onSubmit: (q) => {
      setQuery(q);
      if (!state.q) closeMobileSearch(false);
      else els.input.blur();
    },
    onPick: (result) => navigate(playerHref(result.run)),
  });

  // Phone: the search field opens over the top bar.
  function openMobileSearch() {
    els.bar.dataset.search = "open";
    els.input.focus();
  }
  function closeMobileSearch(focusButton = true) {
    if (els.bar.dataset.search !== "open") return;
    delete els.bar.dataset.search;
    box.close();
    if (focusButton) els.searchOpen?.focus();
  }
  els.searchOpen?.addEventListener("click", openMobileSearch);
  els.searchBack?.addEventListener("click", () => {
    closeMobileSearch();
    if (state.q) setQuery("");
  });

  // The rail: collapses to icons on wide screens, a drawer on narrow ones.
  const drawerMedia = win?.matchMedia?.(DRAWER_QUERY);
  const drawer = makeOverlay(doc, els.scrim, els.rail, {
    onClose: () => {
      els.menu.setAttribute("aria-expanded", "false");
      doc.body.classList.remove("nobs-hp-drawer-open");
    },
  });
  els.scrim.hidden = true;
  els.menu.addEventListener("click", () => {
    if (drawerMedia?.matches) {
      if (drawer.isOpen()) drawer.close();
      else {
        doc.body.classList.add("nobs-hp-drawer-open");
        els.menu.setAttribute("aria-expanded", "true");
        drawer.open(els.menu);
      }
      return;
    }
    const mini = doc.body.dataset.rail !== "mini";
    if (mini) doc.body.dataset.rail = "mini";
    else delete doc.body.dataset.rail;
    els.menu.setAttribute("aria-expanded", String(!mini));
  });
  drawerMedia?.addEventListener?.("change", () => drawer.close());
  els.menu.setAttribute("aria-expanded", drawerMedia?.matches ? "false" : "true");

  // «You» and the call to action follow the account corner of the top bar.
  const askFromBar = () => {
    drawer.close();
    els.bar.querySelector(".nobs-account-ask")?.click();
  };
  const openInvite = onInvite
    ? () => {
        drawer.close();
        onInvite();
      }
    : null;
  // Phones: the bottom tab bar's «You» opens a sheet with the same actions
  // (the top bar then holds no account corner, styles.css).
  const youSheet =
    els.youScrim && els.youSheet
      ? makeOverlay(doc, els.youScrim, els.youSheet, {
          onClose: () => els.tabYou?.setAttribute("aria-expanded", "false"),
        })
      : null;
  const closeYouSheet = () => youSheet?.close();
  els.tabYou?.addEventListener("click", () => {
    if (!youSheet) return;
    els.tabYou.setAttribute("aria-expanded", "true");
    youSheet.open(els.tabYou);
  });
  // A wider window has no tab bar: an open sheet goes away with it.
  win?.matchMedia?.(TABBAR_QUERY)?.addEventListener?.("change", (e) => {
    if (!e.matches) closeYouSheet();
  });
  function syncTabYou(s) {
    if (!els.tabYou) return;
    els.tabYou.hidden = s === "none" && !openInvite;
    els.tabYou.dataset.account = s;
    // Signed in: the account picture in place of the person icon.
    const img = s === "in" ? els.bar.querySelector(".nobs-account-avatar img") : null;
    const icon = els.tabYouIcon;
    if (!icon) return;
    icon.querySelector(".nobs-hp-tab-avatar")?.remove();
    if (img?.getAttribute("src")) {
      const pic = doc.createElement("img");
      pic.className = "nobs-hp-tab-avatar";
      pic.alt = "";
      pic.src = img.getAttribute("src");
      pic.referrerPolicy = "no-referrer";
      pic.addEventListener("error", () => pic.remove());
      icon.append(pic);
    }
  }
  function syncAccount() {
    const s = accountState(els.bar);
    if (s === lastAccount) return;
    lastAccount = s;
    renderYou(els.you, s, lang, { onAsk: askFromBar, onCode: openInvite });
    if (els.youSheetBody) {
      const sheetAsk = () => {
        closeYouSheet();
        askFromBar();
      };
      const sheetCode = openInvite
        ? () => {
            closeYouSheet();
            openInvite();
          }
        : null;
      renderYou(els.youSheetBody, s, lang, { onAsk: sheetAsk, onCode: sheetCode });
      els.youSheetBody.hidden = false;
    }
    syncTabYou(s);
    if (els.cta) {
      els.cta.hidden = s === "in" || Boolean(state.q);
      if (els.ctaSignIn) els.ctaSignIn.hidden = s !== "out";
    }
  }
  if (els.ctaSignIn) els.ctaSignIn.href = ACCOUNT_HREF;
  if (els.ctaCode) {
    if (openInvite) els.ctaCode.addEventListener("click", openInvite);
    else els.ctaCode.hidden = true;
  }
  syncAccount();
  if (globalThis.MutationObserver) new MutationObserver(syncAccount).observe(els.bar, { childList: true, subtree: true });

  // The shelf follows the second row: redraw when the column count changes.
  if (globalThis.ResizeObserver && els.main) {
    new ResizeObserver(() => {
      if (state.loaded && !state.q && feedColumns() !== columns) draw();
    }).observe(els.main);
  }

  win?.addEventListener?.("popstate", () => {
    const s = readState(win.location.search);
    state.chip = s.chip;
    setQuery(s.q, { push: false });
  });

  const ready = Promise.resolve()
    .then(() => fetchImpl("/runs"))
    .then((r) => (r?.ok ? r.json() : Promise.reject(new Error("runs"))))
    .then((body) => {
      state.runs = body.runs ?? [];
      state.loaded = true;
      rebuildIndex();
      const latest = state.runs[0];
      if (latest && els.libraryLink) els.libraryLink.href = playerHref(latest);
      if (latest && els.tabLibrary) els.tabLibrary.href = playerHref(latest);
      if (state.q) ensureClaims();
      draw();
    })
    .catch(() => {
      state.loaded = true;
      els.grid.replaceChildren(el(doc, "p", "nobs-hp-empty-title", t("home.loadError", lang)));
    });
  draw();
  return { state, setQuery, setChip, ready, ensureClaims, drawer, cardMenu, youSheet };
}
