// web/src/homeSearch.js
//
// The home page's instant search over the analyses: titles and channels
// (from GET /runs) and the text of every finished claim (GET /search-index,
// loaded the first time the search box is used; the public build answers it
// from data/search-index.json, src/demoShim.js).
//
// Matching ignores case, accents and «ё/е»; every word of the query must
// appear somewhere in the analysis (title, channel or a claim) at the start
// of a word (a Unicode-aware boundary, so Cyrillic counts as letters):
// «aesth» finds «aesthetic», «the» never finds «another». A whole-word hit
// ranks above a prefix hit. A short stop word («the», «и») matches only as a
// whole word («the», not «they») and never in a channel name, so an analysis
// is not pulled in only through its channel. Highlighting
// marks the same word-start matches, mapped back onto the original text, and
// builds <mark> elements with textContent only: titles and claims are never
// parsed as HTML.
//
// mountSearchBox() wires the top bar's search field as a combobox. The
// suggestion panel follows the typing (suggest()): up to three groups under
// small labels, Analyses (with thumbnails), Channels (only those with an
// analysis not already listed) and Claims (the single claims holding the
// words, with their verdict), then a quiet «See all N results» row (the
// results view) only when more analyses match than are listed. When no
// analysis holds every word, a «Search for …» row leads instead. ArrowUp /
// ArrowDown move through every row, Enter opens the chosen one (or, with
// nothing chosen, the results view), Escape closes the panel and then clears
// the field, «/» focuses it. Every row has one rhythm: a one-line title and
// at most one meta line; a snippet opens at the matched word (or its
// sentence's start just before it), never with a leading «…». A query of
// stop words only lists no analysis whose title lacks them. A query matching nothing still opens the panel:
// a muted «No analyses match …» note with a hint, then the «Search for» row
// (the results view's empty state).

import { t } from "./i18n.js?v=06e433deee";
import { counted, th } from "./stringsHome.js?v=06e433deee";
import { VIDEO_ID_RE } from "./youtubeId.js?v=06e433deee";
import { channelAvatar } from "./channelAvatar.js?v=06e433deee";

const MAX_TERMS = 8;
const SPLIT_RE = /[\s.,;:!?"'«»„“”()[\]{}<>\/\\|+*=~`^#&%@]+/u;

/** One character as the search sees it: lower case, no accents, ё→е. */
function foldChar(ch) {
  const lower = ch.toLowerCase();
  if (lower === "ё") return "е";
  if (lower === "й") return "й"; // a letter of its own in Russian, not и + breve
  return lower.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** The searchable form of a text. */
export function normalize(text) {
  let out = "";
  for (const ch of String(text ?? "")) out += foldChar(ch);
  return out;
}

/** The text's searchable form and, for each of its characters, the index of
 * the original character it came from (for highlighting). */
export function foldWithMap(text) {
  const source = String(text ?? "");
  let folded = "";
  const map = [];
  let i = 0;
  for (const ch of source) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k += 1) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(source.length);
  return { folded, map };
}

/** The distinct words of a query, folded (at most eight). */
export function queryTerms(query) {
  const seen = [];
  for (const word of normalize(query).split(SPLIT_RE)) {
    if (word && !seen.includes(word)) seen.push(word);
    if (seen.length >= MAX_TERMS) break;
  }
  return seen;
}

/**
 * The search index of the listed analyses.
 * @param {object[]} runs  GET /runs entries (title, channel, ...)
 * @param {object|null} claimsIndex  GET /search-index ({claims: {run_id: [[id, flag, text]]}}) or null
 */
export function buildSearchIndex(runs, claimsIndex = null) {
  const claims = claimsIndex?.claims ?? {};
  return (runs ?? []).map((run) => {
    const rows = claims[String(run.run_id)] ?? [];
    return {
      run,
      title: normalize(run.title || run.video_id || ""),
      channel: normalize(run.channel || ""),
      claims: rows.map(([id, flag, text]) => ({ id, flag, text: String(text ?? ""), folded: normalize(text) })),
    };
  });
}

const WORD_CHAR_RE = /[\p{L}\p{N}\p{M}]/u;
const isWordChar = (ch) => ch != null && WORD_CHAR_RE.test(ch);

/** The next index (from `from`) where `term` starts a word of `haystack`,
 * or -1. A stop word counts only as a whole word («the», not «they»). */
export function wordStartIndex(haystack, term, from = 0) {
  if (!term) return -1;
  const whole = isStopWord(term);
  let at = haystack.indexOf(term, from);
  while (at !== -1) {
    if ((at === 0 || !isWordChar(haystack[at - 1])) && !(whole && isWordChar(haystack[at + term.length]))) return at;
    at = haystack.indexOf(term, at + 1);
  }
  return -1;
}

/** How `term` occurs in `haystack`: 2 as a whole word, 1 only as a word's start, 0 not at all. */
export function matchKind(haystack, term) {
  let best = 0;
  for (let at = wordStartIndex(haystack, term); at !== -1; at = wordStartIndex(haystack, term, at + 1)) {
    if (!isWordChar(haystack[at + term.length])) return 2;
    best = 1;
  }
  return best;
}

// Words too common to say anything about a channel: «the» must not list
// every analysis of «The Breakfast Show».
const STOP_WORDS = new Set([
  "a", "an", "the", "of", "and", "or", "in", "on", "at", "to", "for", "is", "it", "by", "with", "from", "as", "be", "are", "was", "this", "that",
  "и", "в", "во", "на", "с", "со", "к", "ко", "о", "об", "у", "по", "за", "из", "от", "до", "не", "но", "а", "ли", "же", "что", "как", "это",
]);
export const isStopWord = (term) => STOP_WORDS.has(term);

/**
 * Search the index. Returns [{run, score, inTitle, inChannel, claimCount,
 * claims: [{id, flag, text, hits}]}], best first (ties: newest first).
 * An empty query returns [].
 */
export function search(index, query, { claimsPerResult = 3 } = {}) {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const results = [];
  for (const entry of index ?? []) {
    let score = 0;
    let all = true;
    let inTitle = false;
    let inChannel = false;
    const claimHits = new Map();
    for (const term of terms) {
      let hit = false;
      const titleKind = matchKind(entry.title, term);
      if (titleKind) {
        hit = inTitle = true;
        score += titleKind === 2 ? 14 : 9;
      }
      const channelKind = entry.channel && !isStopWord(term) ? matchKind(entry.channel, term) : 0;
      if (channelKind) {
        hit = inChannel = true;
        score += channelKind === 2 ? 8 : 5;
      }
      let whole = 0;
      let prefix = 0;
      for (const claim of entry.claims) {
        const kind = matchKind(claim.folded, term);
        if (kind) {
          if (kind === 2) whole += 1;
          else prefix += 1;
          claimHits.set(claim, (claimHits.get(claim) ?? 0) + 1);
        }
      }
      if (whole || prefix) {
        hit = true;
        score += Math.min(whole, 6) + Math.min(prefix, 6) / 2;
      }
      if (!hit) {
        all = false;
        break;
      }
    }
    if (!all) continue;
    const ranked = [...claimHits.entries()].sort((a, b) => b[1] - a[1]);
    // A claim holding every word of the query weighs more than scattered hits.
    if (terms.length > 1 && ranked[0]?.[1] === terms.length) score += 6;
    results.push({
      run: entry.run,
      score,
      inTitle,
      inChannel,
      claimCount: claimHits.size,
      claims: ranked.slice(0, claimsPerResult).map(([claim, hits]) => ({ id: claim.id, flag: claim.flag, text: claim.text, hits })),
    });
  }
  return results.sort((a, b) => b.score - a.score || Number(b.run.run_id) - Number(a.run.run_id));
}

/** The [start, end) ranges of `text` matching any of the (folded) terms, merged. */
export function matchRanges(text, terms) {
  const { folded, map } = foldWithMap(text);
  const ranges = [];
  for (const term of terms ?? []) {
    if (!term) continue;
    let at = wordStartIndex(folded, term);
    while (at !== -1) {
      ranges.push([map[at], map[at + term.length]]);
      at = wordStartIndex(folded, term, at + term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

const SPACE_RE = /\s/;
/** The start of the word holding position `i` of `s`. */
function wordStartAt(s, i) {
  let j = i;
  while (j > 0 && !SPACE_RE.test(s[j - 1])) j -= 1;
  return j;
}

/**
 * A window of a long text around its first match (with «…» where cut),
 * always cut between words. `lead` is how much text may come before the
 * match (default a third of `max`); a short lead keeps the match visible in
 * a one-line row that the browser ellipsises at the end.
 */
export function snippet(text, terms, max = 180, { lead, sentence = 0 } = {}) {
  const source = String(text ?? "");
  const first = matchRanges(source, terms)[0];
  // A sentence starting at most `sentence` characters before the match: the
  // window opens there, with no «…», so the row reads as a sentence.
  if (sentence && first) {
    const from = sentenceStartBefore(source, first[0], sentence);
    if (from === 0 && source.length <= max) return source;
    if (from >= 0) return snippetFrom(source, from, first, max, false);
  }
  // Leave room for the match itself and a little after it.
  const before = Math.min(lead ?? Math.floor(max / 3), first ? Math.max(0, max - (first[1] - first[0]) - 12) : max);
  if (source.length <= max && (!first || first[0] <= before)) return source;
  let start = 0;
  if (first && first[0] > before) {
    const target = first[0] - before;
    const back = wordStartAt(source, target);
    if (target - back <= 16) start = back;
    else {
      // The word at the cut is long: start at the next word, never past the match's own word.
      let next = target;
      while (next < first[0] && !SPACE_RE.test(source[next])) next += 1;
      start = next < first[0] ? next + 1 : wordStartAt(source, first[0]);
    }
  }
  return snippetFrom(source, start, first, max);
}

/**
 * A one-line snippet that opens at the match: at the start of its sentence
 * when that is at most `reach` characters before the match, otherwise at the
 * matched word itself. Never a leading «…» (the row reads as text, not as a
 * broken cut) and the match is always in the first characters, so a narrow
 * row that the browser ellipsises at the end still shows it.
 */
export function matchSnippet(text, terms, max = 140, reach = 12) {
  const source = String(text ?? "");
  const first = matchRanges(source, terms)[0];
  if (!first) return snippetFrom(source, 0, null, max, false);
  let from = reach ? sentenceStartBefore(source, first[0], reach) : -1;
  if (from < 0) from = wordStartAt(source, first[0]);
  if (from === 0 && source.length <= max) return source;
  return snippetFrom(source, from, first, max, false);
}

/** The start of the earliest sentence beginning within `reach` characters before `at`, or -1. */
function sentenceStartBefore(source, at, reach) {
  const floor = Math.max(0, at - reach);
  if (floor === 0) return 0;
  const re = /[.!?…]["'»”)]*\s+(?=\S)/gu;
  re.lastIndex = Math.max(0, floor - 4);
  for (let m = re.exec(source); m && m.index < at; m = re.exec(source)) {
    const next = m.index + m[0].length;
    if (next >= floor && next <= at) return next;
  }
  return -1;
}

/** The text from `start` (a word start), at most about `max` long, cut
 * between words; `cut` says whether a «…» marks the start. */
function snippetFrom(source, start, first, max, cut = start > 0) {
  let end = Math.min(source.length, start + max);
  if (end < source.length && !SPACE_RE.test(source[end])) {
    const back = wordStartAt(source, end);
    if (back > (first ? first[1] : start) && back > start) end = back;
    else {
      // The cut would split the match's word or the only word: end after that word.
      while (end < source.length && !SPACE_RE.test(source[end])) end += 1;
    }
  }
  let body = source.slice(start, end).trim();
  if (end < source.length) body = body.replace(/[\s,;:–—-]+$/u, "");
  return (cut ? "…" : "") + body + (end < source.length ? "…" : "");
}

/** Fill `el` with `text`, the matches of `terms` wrapped in <mark>. Returns el. */
export function highlightInto(el, text, terms) {
  const doc = el.ownerDocument;
  const source = String(text ?? "");
  el.replaceChildren();
  let pos = 0;
  for (const [start, end] of matchRanges(source, terms)) {
    if (start > pos) el.append(doc.createTextNode(source.slice(pos, start)));
    const mark = doc.createElement("mark");
    mark.textContent = source.slice(start, end);
    el.append(mark);
    pos = end;
  }
  if (pos < source.length) el.append(doc.createTextNode(source.slice(pos)));
  return el;
}

/**
 * The suggestion panel's content for a query: {total, analyses, channels,
 * claims}. `total` counts the analyses holding every word (the results
 * view); `analyses` are the best of them; `channels` the channels whose name
 * holds every word ({name, count, runIds, run}); `claims` single claims of any
 * analysis holding the most words, a claim with every word first
 * ({run, claim: {id, flag, text}, hits}).
 */
export function suggest(index, query, { analyses = 4, channels = 3, claims = 3 } = {}) {
  const terms = queryTerms(query);
  if (!terms.length) return { total: 0, analyses: [], channels: [], claims: [] };
  const results = search(index, query);
  // A query of stop words only («the», «и»): an analysis is listed only when
  // its title holds them; one holding «the» somewhere in a claim says nothing.
  const onlyStop = terms.every(isStopWord);
  const listable = onlyStop ? results.filter((r) => r.inTitle) : results;
  const byChannel = new Map();
  const claimHits = [];
  for (const entry of index ?? []) {
    if (entry.channel && terms.every((term) => !isStopWord(term) && matchKind(entry.channel, term))) {
      const name = String(entry.run.channel);
      const seen = byChannel.get(entry.channel);
      if (seen) {
        seen.count += 1;
        seen.runIds.push(entry.run.run_id);
      } else byChannel.set(entry.channel, { name, count: 1, runIds: [entry.run.run_id], run: entry.run, start: terms.every((term) => matchKind(entry.channel, term) === 2) });
    }
    for (const claim of entry.claims) {
      let hits = 0;
      let whole = 0;
      for (const term of terms) {
        const kind = matchKind(claim.folded, term);
        if (kind) {
          hits += 1;
          if (kind === 2) whole += 1;
        }
      }
      if (hits) claimHits.push({ run: entry.run, claim: { id: claim.id, flag: claim.flag, text: claim.text }, hits, whole });
    }
  }
  const newest = (a, b) => Number(b.run.run_id) - Number(a.run.run_id);
  claimHits.sort((a, b) => b.hits - a.hits || b.whole - a.whole || newest(a, b));
  return {
    total: results.length,
    analyses: listable.slice(0, analyses),
    channels: [...byChannel.values()]
      .sort((a, b) => Number(b.start) - Number(a.start) || b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, channels)
      .map(({ name, count, runIds, run }) => ({ name, count, runIds, run })),
    claims: claimHits.slice(0, claims).map(({ run, claim, hits }) => ({ run, claim, hits })),
  };
}

// ---- the search box (combobox) -----------------------------------------------------------------------

const FLAGS = ["green", "yellow", "red", "white"];
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  search: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.3 15.3 20 20",
  video: "M4 6.5h16v11H4zM10.5 9.5v5l4-2.5z",
  claim: "M6 7h12M6 11h12M6 15h7M17 14.5l1.5 1.5 3-3.5",
};
// One mark per verdict (check, dash, cross, question), drawn inside a filled
// disc of the verdict colour, so a claim row says its verdict by shape as
// well as colour.
const VERDICT_MARKS = {
  green: "M7.6 12.4l3 3 5.8-6.2",
  yellow: "M8 12h8",
  red: "M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4",
  white: "M9.9 9.7a2.2 2.2 0 1 1 3 2.1c-.6.3-.9.7-.9 1.3v.3M12 16.2v.1",
};

/** A filled verdict disc (no box around it) for a claim row. */
function verdictGlyph(doc, flag, size = 22) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "nobs-hp-verdict-glyph");
  const disc = doc.createElementNS(SVG_NS, "circle");
  disc.setAttribute("cx", "12");
  disc.setAttribute("cy", "12");
  disc.setAttribute("r", "10.5");
  disc.setAttribute("class", "nobs-hp-verdict-disc");
  const mark = doc.createElementNS(SVG_NS, "path");
  mark.setAttribute("d", VERDICT_MARKS[flag]);
  mark.setAttribute("class", "nobs-hp-verdict-mark");
  mark.setAttribute("fill", "none");
  mark.setAttribute("stroke-width", "2.4");
  mark.setAttribute("stroke-linecap", "round");
  mark.setAttribute("stroke-linejoin", "round");
  svg.append(disc, mark);
  return svg;
}

function icon(doc, name, size = 20) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function span(doc, cls, text) {
  const node = doc.createElement("span");
  node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** The 64px column leading a row: the video's thumbnail, a kind icon or a verdict disc. */
function lead(doc, kind, row) {
  const box = span(doc, `nobs-hp-suggest-lead nobs-hp-suggest-lead-${kind}`);
  box.setAttribute("aria-hidden", "true");
  if (kind === "analysis" && VIDEO_ID_RE.test(row.run.video_id ?? "")) {
    const img = doc.createElement("img");
    box.classList.add("nobs-thumb-fx"); // the brand-gradient layer (admin «Вид сайта»)
    img.src = `https://i.ytimg.com/vi/${row.run.video_id}/mqdefault.jpg`;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    box.append(img);
  } else if (kind === "channel") {
    box.append(channelAvatar(doc, { name: row.name, src: row.run?.channel_avatar }, "nobs-hp-suggest-avatar"));
  } else if (kind === "claim") {
    const flag = FLAGS.includes(row.claim.flag) ? row.claim.flag : "white";
    box.classList.add(`nobs-hp-suggest-verdict-${flag}`);
    box.append(verdictGlyph(doc, flag));
  } else {
    box.append(icon(doc, kind === "search" ? "search" : "video"));
  }
  return box;
}

const MAX_ANALYSES = 4;
const PICTO_RE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** A run's title for a meta line: no emoji, no doubled spaces. */
export function plainTitle(run) {
  const raw = String(run.title || run.video_id || `#${run.run_id}`);
  return raw.replace(PICTO_RE, "").replace(/\s{2,}/g, " ").trim() || raw;
}

/**
 * Wire the search form. `els`: {form, input, clear, list}. `getIndex()`
 * returns the current index; `ensureClaims()` starts loading the claims
 * (resolves when they are in; then the open list refreshes). `onSubmit(q)`
 * shows the results view (also for a picked channel: its name);
 * `onPick({run, claim?})` opens one analysis.
 */
export function mountSearchBox({ doc = globalThis.document, els, lang = "ru", getIndex, ensureClaims = () => Promise.resolve(), onSubmit, onPick }) {
  const { form, input, clear, list } = els;
  let active = -1;
  let current = []; // the rows, in order: {kind, run?, claim?, name?, query?}
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("search.suggestions", lang));
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);

  function setOpen(open) {
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (open) form.dataset.suggest = "open";
    else delete form.dataset.suggest;
    // The page root carries the state too, so the page under the scrim
    // (the hero call to action, the chips) can step back while the panel is up.
    const root = doc?.documentElement;
    if (root) {
      if (open) root.dataset.searchOpen = "true";
      else delete root.dataset.searchOpen;
    }
  }

  function close() {
    setOpen(false);
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function setActive(i) {
    const items = [...list.querySelectorAll("[role=option]")];
    active = items.length ? (i + items.length) % items.length : -1;
    items.forEach((item, k) => item.setAttribute("aria-selected", String(k === active)));
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", items[active].id);
      items[active].scrollIntoView?.({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function choose(row) {
    close();
    if (row.kind === "search") onSubmit?.(row.query);
    else if (row.kind === "channel") onSubmit?.(row.name);
    else onPick?.(row.claim ? { run: row.run, claim: row.claim } : row.result ?? { run: row.run });
  }

  function option(row, main, sub) {
    const item = doc.createElement("li");
    item.id = `${list.id}-opt-${current.length}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.className = `nobs-hp-suggest nobs-hp-suggest-${row.kind}`;
    item.dataset.kind = row.kind;
    const text = span(doc, "nobs-hp-suggest-text");
    main.classList.add("nobs-hp-suggest-title");
    text.append(main);
    if (sub) {
      sub.classList.add("nobs-hp-suggest-where");
      text.append(sub);
    }
    item.append(lead(doc, row.kind, row), text);
    item.addEventListener("mousedown", (e) => e.preventDefault()); // keep the focus in the field
    item.addEventListener("click", () => choose(row));
    current.push(row);
    return item;
  }

  function group(key, items, note = "") {
    if (!items.length) return null;
    const name = note ? `${t(key, lang)} · ${note}` : t(key, lang);
    const li = doc.createElement("li");
    li.className = "nobs-hp-suggest-group";
    li.setAttribute("role", "group");
    li.setAttribute("aria-label", name);
    const label = span(doc, "nobs-hp-suggest-label", name);
    label.setAttribute("aria-hidden", "true");
    const ul = doc.createElement("ul");
    ul.setAttribute("role", "presentation");
    ul.append(...items);
    li.append(label, ul);
    return li;
  }

  function render() {
    const q = input.value;
    clear.hidden = !q;
    const terms = queryTerms(q);
    current = [];
    list.replaceChildren();
    if (!terms.length) {
      close();
      return;
    }
    const found = suggest(getIndex(), q, { analyses: MAX_ANALYSES });
    // How far back a snippet may open at its sentence's start: about a third
    // of the characters a row's text column shows (a wide panel reads whole
    // sentences, a phone's starts at the matched word), so the match always
    // shows before the row's end.
    const column = Math.max(list.clientWidth || 0, form.clientWidth || 0) - 110; // the list is hidden (0 wide) on the first keystroke
    const reach = Math.max(8, Math.min(40, Math.floor(column / 7.5 / 3)));
    const query = q.trim();
    if (!found.total && !found.channels.length && !found.claims.length) {
      // Nothing matches: the panel still answers. A muted, non-selectable
      // note says so (with one hint), then the «Search for» row leads to the
      // results view's empty state, so typing is never a dead end.
      const note = doc.createElement("li");
      note.className = "nobs-hp-suggest-empty";
      note.setAttribute("role", "presentation");
      const text = span(doc, "nobs-hp-suggest-text");
      text.append(
        span(doc, "nobs-hp-suggest-empty-title", th("search.emptyTitle", { q: query }, lang)),
        span(doc, "nobs-hp-suggest-empty-hint", t("search.noMatchHint", lang)),
      );
      const mark = span(doc, "nobs-hp-suggest-lead nobs-hp-suggest-lead-empty");
      mark.setAttribute("aria-hidden", "true");
      mark.append(icon(doc, "search"));
      note.append(mark, text);
      const head = option({ kind: "search", query }, span(doc, "", th("search.searchFor", { q: query }, lang)));
      // The note is not an option, so a screen reader hears it on the row.
      head.setAttribute("aria-label", `${th("search.emptyTitle", { q: query }, lang)}. ${th("search.searchFor", { q: query }, lang)}`);
      list.append(note, head);
      list.dataset.empty = "true";
      setOpen(true);
      active = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    delete list.dataset.empty;
    // No analysis holds every word (only claims or channels with some of
    // them): a «Search for» row leads, saying so. Otherwise every listed
    // analysis already answers, and the results view is offered only when
    // more match than the panel shows, as a quiet last row.
    const head = found.total
      ? null
      : option({ kind: "search", query }, span(doc, "", th("search.searchFor", { q: query }, lang)), span(doc, "", t("search.noneAll", lang)));
    const analyses = found.analyses.map((result) => {
      const run = result.run;
      const title = highlightInto(span(doc, ""), run.title || run.video_id || `#${run.run_id}`, terms);
      const where = span(doc, "");
      if (!result.inTitle && result.claims[0]) highlightInto(where, matchSnippet(result.claims[0].text, terms, 120, reach), terms);
      else if (result.inChannel && run.channel) highlightInto(where, run.channel, terms);
      else where.textContent = run.channel || "";
      return option({ kind: "analysis", run, result }, title, where);
    });
    // A channel row says nothing new when every analysis of that channel is
    // already listed above (the analysis rows name their channel).
    const listed = new Set(found.analyses.map((r) => String(r.run.run_id)));
    const channels = found.channels.filter((c) => !(c.runIds ?? []).every((id) => listed.has(String(id)))).map((c) =>
      option({ kind: "channel", name: c.name, run: c.run }, highlightInto(span(doc, ""), c.name, terms),
        span(doc, "", `${t("search.channel", lang)} · ${counted(c.count, "search.analyses", lang)}`)));
    // A claim row is its text plus, when needed, one line of meta: the verdict
    // (unless every claim shares it; then the group label says it once) and
    // the analysis, named only when it is not already listed above.
    const flagOf = (c) => (FLAGS.includes(c.claim.flag) ? c.claim.flag : "white");
    const flags = new Set(found.claims.map(flagOf));
    const shared = flags.size === 1 ? [...flags][0] : null;
    const claims = found.claims.map((c) => {
      const flag = flagOf(c);
      const meta = [];
      if (!shared) meta.push(t(`verdict.${flag}`, lang));
      if (!listed.has(String(c.run.run_id))) meta.push(th("search.claimIn", { title: plainTitle(c.run) }, lang));
      const sub = meta.length ? span(doc, shared ? "" : `nobs-hp-suggest-verdict-text-${flag}`, meta.join(" · ")) : null;
      return option({ kind: "claim", run: c.run, claim: c.claim }, highlightInto(span(doc, ""), matchSnippet(c.claim.text, terms, 140, reach), terms), sub);
    });
    const claimsNote = shared ? t(`verdict.${shared}`, lang).toLocaleLowerCase(lang === "ru" ? "ru" : "en") : "";
    let more = null;
    if (found.total > found.analyses.length) {
      more = doc.createElement("li");
      more.className = "nobs-hp-suggest-footer";
      more.setAttribute("role", "presentation");
      const ul = doc.createElement("ul");
      ul.setAttribute("role", "presentation");
      const row = option({ kind: "search", query }, span(doc, "", counted(found.total, "search.seeAll", lang)));
      row.classList.add("nobs-hp-suggest-more");
      ul.append(row);
      more.append(ul);
    }
    list.append(...[
      head,
      group("search.group.analyses", analyses),
      group("search.group.channels", channels),
      group("search.group.claims", claims, claimsNote),
      more,
    ].filter(Boolean));
    setOpen(true);
    active = -1;
    input.removeAttribute("aria-activedescendant");
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", () => {
    ensureClaims().then(() => {
      if (doc.activeElement === input) render();
    });
    if (input.value) render();
  });
  input.addEventListener("blur", () => close());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (list.hidden) render();
      if (!current.length) return;
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1) + (active === -1 && e.key === "ArrowUp" ? 1 : 0));
    } else if (e.key === "Escape") {
      if (!list.hidden) {
        e.preventDefault();
        close();
      } else if (input.value) {
        e.preventDefault();
        input.value = "";
        clear.hidden = true;
        onSubmit?.("");
      }
    } else if (e.key === "Enter" && active >= 0 && current[active]) {
      e.preventDefault();
      choose(current[active]);
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    close();
    onSubmit?.(input.value.trim());
  });
  clear.addEventListener("click", () => {
    input.value = "";
    clear.hidden = true;
    close();
    input.focus();
    onSubmit?.("");
  });
  // «/» focuses the search from anywhere but a text field.
  doc.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    e.preventDefault();
    input.focus();
  });
  clear.hidden = !input.value;
  return { render, close, rows: () => current };
}
