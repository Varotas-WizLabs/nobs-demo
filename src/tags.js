// web/src/tags.js
//
// Presentation tags on a claim ("how it is phrased"), from GET /runs/{id}:
// claim.tags (layer B: chips), claim.verdict_reasons (layer A: a line in the
// verdict details), run.timeline_marks (spans outside any flag),
// run.observations (video-level marks: a false analogy across the video) and
// run.segment_markers (ad inserts). Tag names and literature terms come from
// the server's catalogue (one table, nobs/tags/catalogue.py); fixed UI
// strings (heading, disclaimer) from i18n.js. A tag describes the wording,
// never the speaker's intent, and every chip says so.
//
// Every tag, mark and observation has a `tier`: "solid", or "possible" (the
// automatic check was not sure: a minority of votes kept it, or it is below
// the bar). A possible one is drawn pale with the prefix «возможно:» /
// "possibly:" and a tooltip line saying so -- in the popup, the claim list,
// the filters, the timeline and the export -- and is left out everywhere
// when the viewer switches "Show possible tags" off (settings.js).
//
// Round 5 (owner decisions):
// - tier "note" («Личное мнение» / "Personal opinion", catalogue
//   `technique: false`) is a neutral note, not a technique: a quiet grey
//   chip, never «возможно:», always shown, left out of the technique counts
//   and the tag filter;
// - a tag or an observation the speaker qualifies elsewhere carries
//   `qualifier` {text, start_sec, end_sec}: shown as «Дальше — оговорка
//   автора» / "The speaker qualifies this later" with its timecode and the
//   verbatim words, in the popup, the tooltips (list chip, timeline) and the
//   export.

import { frameTimelineItems } from "./frames.js?v=04a8d84c10";
import { formatTimecode } from "./claimSync.js?v=04a8d84c10";
import { t } from "./i18n.js?v=04a8d84c10";
import { showPossibleTags } from "./settings.js?v=04a8d84c10";

export function isPossible(tag) {
  return tag?.tier === "possible";
}

/** A neutral note («Личное мнение»), not a technique. */
export function isNote(tag) {
  return tag?.tier === "note" || tag?.technique === false;
}

/** "solid" | "possible" | "note": the display tier. */
export function tierOf(tag) {
  if (isNote(tag)) return "note";
  return isPossible(tag) ? "possible" : "solid";
}

const TIER_ORDER = { solid: 0, possible: 1, note: 2 };

/** Solid tags first, then possible ones, then notes. */
export function byTier(a, b) {
  return TIER_ORDER[tierOf(a)] - TIER_ORDER[tierOf(b)];
}

/** The tags to show under the viewer's setting (possible ones only when on). */
export function visibleTags(list, showPossible = showPossibleTags()) {
  return (list ?? []).filter((tag) => showPossible || isNote(tag) || !isPossible(tag));
}

/** The speaker's own qualification of a tag or observation, if any. */
export function qualifierOf(tag) {
  const q = tag?.qualifier;
  return q && typeof q.text === "string" && q.text.trim() ? q : null;
}

function qualifierLabel(tag, lang) {
  const q = qualifierOf(tag);
  const at = tag?.evidence?.start_sec ?? tag?.spans?.[0]?.start_sec;
  const earlier = typeof q?.start_sec === "number" && typeof at === "number" && q.start_sec < at;
  return t(earlier ? "tags.qualifierEarlier" : "tags.qualifierLater", lang);
}

/** "The speaker qualifies this later: «…» (12:34)", or "" without a qualifier. */
export function qualifierLine(tag, lang = "en") {
  const q = qualifierOf(tag);
  if (!q) return "";
  const time = typeof q.start_sec === "number" && Number.isFinite(q.start_sec) ? ` (${formatTimecode(q.start_sec)})` : "";
  return `${qualifierLabel(tag, lang)}: «${q.text}»${time}`;
}

/** A tag's display name: "possibly: <name>" for a possible one. */
export function tagLabel(tag, lang = "en") {
  return isPossible(tag) ? `${t("tags.possible", lang)}: ${tag.name}` : tag.name;
}

/** The run with only the tags the viewer's setting shows (claims, marks, observations). */
export function visibleRun(run, showPossible = showPossibleTags()) {
  if (!run || showPossible) return run;
  return {
    ...run,
    claims: (run.claims ?? []).map((claim) => ({
      ...claim,
      tags: visibleTags(claim.tags, false),
      verdict_reasons: visibleTags(claim.verdict_reasons, false),
    })),
    timeline_marks: visibleTags(run.timeline_marks, false),
    observations: visibleTags(run.observations, false),
  };
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function evidenceTime(tag) {
  const start = tag?.evidence?.start_sec;
  return typeof start === "number" && Number.isFinite(start) ? start : null;
}

/** Plain-text tooltip: literature term, explanation, evidence with timecode, disclaimer. */
export function tagTooltip(tag, lang = "en") {
  const lines = [];
  if (isNote(tag)) lines.push(t("tags.noteHint", lang));
  else if (isPossible(tag)) lines.push(t("tags.possibleHint", lang));
  if (tag.literature) lines.push(`${t("tags.literature", lang)}: ${tag.literature}`);
  if (tag.subtype_name) lines.push(tag.subtype_name);
  if (tag.explanation) lines.push(tag.explanation);
  const start = evidenceTime(tag);
  if (tag.evidence?.text) lines.push(`«${tag.evidence.text}»${start != null ? ` (${formatTimecode(start)})` : ""}`);
  const qualifier = qualifierLine(tag, lang);
  if (qualifier) lines.push(qualifier);
  lines.push(t("tags.notIntent", lang));
  return lines.join("\n");
}

function evidenceHtml(tag, lang) {
  const start = evidenceTime(tag);
  const quote = tag.evidence?.text
    ? `<blockquote class="tag-evidence">«${escapeHtml(tag.evidence.text)}»</blockquote>`
    : "";
  const seek =
    start != null
      ? `<button type="button" class="tag-seek" data-seek="${start}" aria-label="${escapeHtml(t("tags.seek", lang))} ${formatTimecode(start)}">${formatTimecode(start)}</button>`
      : "";
  return `${quote}<p class="tag-explanation">${seek} ${escapeHtml(tag.explanation ?? "")}</p>${qualifierHtml(tag, lang)}`;
}

/** «Дальше — оговорка автора» with its timecode (a seek button) and the verbatim words. */
function qualifierHtml(tag, lang) {
  const q = qualifierOf(tag);
  if (!q) return "";
  const start = typeof q.start_sec === "number" && Number.isFinite(q.start_sec) ? q.start_sec : null;
  const seek =
    start != null
      ? ` <button type="button" class="tag-seek" data-seek="${start}" aria-label="${escapeHtml(t("tags.seek", lang))} ${formatTimecode(start)}">${formatTimecode(start)}</button>`
      : "";
  return `<p class="tag-qualifier"><span class="tag-qualifier-label">${escapeHtml(qualifierLabel(tag, lang))}</span>${seek} «${escapeHtml(q.text)}»</p>`;
}

/** The "how it is phrased" block of the claim popup ("" without tags). */
function tierAttr(tag) {
  return ` data-tier="${tierOf(tag)}"`;
}

export function renderTagChipsHtml(claim, lang = "en") {
  const tags = [...visibleTags(claim?.tags)].sort(byTier);
  if (!tags.length) return "";
  const chips = tags
    .map(
      (tag, i) => `
        <li class="tag-item">
          <button type="button" class="tag-chip" data-action="toggle-tag" data-tag-id="${escapeHtml(tag.tag_id)}"${tierAttr(tag)}
            aria-expanded="false" aria-controls="tag-panel-${i}" title="${escapeHtml(tagTooltip(tag, lang))}">${escapeHtml(tagLabel(tag, lang))}</button>
          <div class="tag-panel" id="tag-panel-${i}" hidden>
            ${tag.literature ? `<p class="tag-literature">${escapeHtml(t("tags.literature", lang))}: ${escapeHtml(tag.literature)}</p>` : ""}
            ${evidenceHtml(tag, lang)}
          </div>
        </li>`
    )
    .join("");
  return `
    <section class="claim-tags" aria-label="${escapeHtml(t("tags.heading", lang))}">
      <p class="claim-tags-heading">${escapeHtml(t("tags.heading", lang))}</p>
      <ul class="tag-chips">${chips}</ul>
      <p class="tag-disclaimer">${escapeHtml(t("tags.disclaimer", lang))}</p>
    </section>`;
}

/** Layer A: "Reason: <name>" lines inside the verdict details ("" without).
 * `disclaimer: false` when the popup already shows it under the chips. */
export function renderVerdictReasonsHtml(claim, lang = "en", { disclaimer = true } = {}) {
  const reasons = visibleTags(claim?.verdict_reasons);
  if (!reasons.length) return "";
  const items = reasons
    .map(
      (tag) => `
        <li class="verdict-reason"${tierAttr(tag)} title="${escapeHtml(tagTooltip(tag, lang))}">
          <span class="verdict-reason-label">${escapeHtml(t("tags.reason", lang))}:</span> ${escapeHtml(tagLabel(tag, lang))}
          ${evidenceHtml(tag, lang)}
        </li>`
    )
    .join("");
  const note = disclaimer ? `<p class="tag-disclaimer">${escapeHtml(t("tags.disclaimer", lang))}</p>` : "";
  return `<ul class="verdict-reasons">${items}</ul>${note}`;
}

/** Wire chip toggles and timecode seeks inside a rendered popup. */
export function wireTagInteractions(container, { onSeek } = {}) {
  container.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-action='toggle-tag'], [data-seek]");
    if (!target || !container.contains(target)) return;
    if (target.dataset.action === "toggle-tag") {
      const panel = container.querySelector(`#${target.getAttribute("aria-controls")}`);
      const open = target.getAttribute("aria-expanded") === "true";
      target.setAttribute("aria-expanded", String(!open));
      if (panel) panel.hidden = open;
      return;
    }
    const seconds = Number(target.dataset.seek);
    if (Number.isFinite(seconds) && onSeek) onSeek(seconds);
  });
}

/** A claim's shown tags (chips and verdict reasons) under the viewer's setting. */
export function claimTags(claim) {
  return visibleTags([...(claim?.tags ?? []), ...(claim?.verdict_reasons ?? [])]);
}

/**
 * Tag ids present on a run's claims, in catalogue order, with counts: `count`
 * = solid + possible shown, `possible` = how many of them are possible.
 */
export function tagFilterOptions(run) {
  const counts = new Map();
  for (const claim of run?.claims ?? []) {
    // A note («Личное мнение») is not a technique: no filter chip for it.
    for (const tag of claimTags(claim).filter((tag) => !isNote(tag))) {
      if (!counts.has(tag.tag_id)) counts.set(tag.tag_id, { tag_id: tag.tag_id, name: tag.name, count: 0, possible: 0 });
      const entry = counts.get(tag.tag_id);
      entry.count += 1;
      if (isPossible(tag)) entry.possible += 1;
    }
  }
  const order = (run?.tag_catalogue?.tags ?? []).map((tag) => tag.id);
  return [...counts.values()].sort((a, b) => {
    const ia = order.indexOf(a.tag_id);
    const ib = order.indexOf(b.tag_id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

export function claimHasTag(claim, tagId) {
  return claimTags(claim).some((tag) => tag.tag_id === tagId);
}

/**
 * The timeline items left by the claim list's filters: everything when no
 * filter is set; with only a tag filter, the off-flag marks of that tag;
 * with a flag filter, none (they belong to no flag).
 */
export function filterTimelineItems(items, { flag = "all", tag = "all" } = {}) {
  if (flag === "all" && tag === "all") return items;
  if (flag !== "all") return [];
  return items.filter((item) => item.kind === "tag" && item.tag_id === tag);
}

/**
 * Video-level observations (a false analogy running through the video): one
 * mark per place, each tooltip naming the comparison, the literature term,
 * every timecode, its own words and the disclaimer. Drawn like the off-flag
 * marks; no popup, so the tooltip carries the disclaimer.
 */
function observationItems(run, lang) {
  const items = [];
  for (const obs of visibleTags(run?.observations)) {
    const spans = (obs.spans ?? []).filter((span) => typeof span.start_sec === "number" && Number.isFinite(span.start_sec));
    const all = spans.map((span) => formatTimecode(span.start_sec)).join(", ");
    for (const span of spans) {
      const name = tagLabel(obs, lang);
      const lines = [name];
      if (isPossible(obs)) lines.push(t("tags.possibleHint", lang));
      if (obs.literature) lines.push(`${t("tags.literature", lang)}: ${obs.literature}`);
      if (obs.explanation) lines.push(obs.explanation);
      lines.push(all);
      if (span.text) lines.push(`«${span.text}» (${formatTimecode(span.start_sec)})`);
      const qualifier = qualifierLine(obs, lang);
      if (qualifier) lines.push(qualifier);
      lines.push(t("tags.notIntent", lang));
      lines.push(t("tags.disclaimer", lang));
      items.push({
        kind: "observation",
        observation: obs.kind,
        tier: tierOf(obs),
        start_sec: span.start_sec,
        end_sec: span.end_sec ?? span.start_sec,
        label: `${formatTimecode(span.start_sec)} ${name}: «${span.text ?? ""}»`,
        title: lines.join("\n"),
      });
    }
  }
  return items;
}

/**
 * Where an ad segment comes from, for its tooltip and the export: null for
 * our own detector alone; "both" when SponsorBlock marks it too;
 * "sponsorblock" / "sponsorblock_unconfirmed" (no votes, not locked) for a
 * SponsorBlock-only segment. `note` is the line to show.
 */
export function segmentSource(segment, lang) {
  const sources = segment?.sources ?? ["nobs"];
  if (!sources.includes("sponsorblock")) return null;
  if (sources.includes("nobs")) return { kind: "both", note: t("tags.alsoSponsorBlock", lang) };
  if (segment.confidence === "unconfirmed") {
    return { kind: "sponsorblock_unconfirmed", note: t("tags.perSponsorBlockUnconfirmed", lang) };
  }
  return { kind: "sponsorblock", note: t("tags.perSponsorBlock", lang) };
}

/** Timeline items: off-flag marks, video-level marks and ad segments, for the control bar. */
export function timelineItems(run) {
  const lang = run?.caption_language ?? "en";
  const sponsoredName = run?.tag_catalogue?.markers?.sponsored?.name ?? t("tags.sponsored", lang);
  const sponsoredDefinition = run?.tag_catalogue?.markers?.sponsored?.definition ?? "";
  const marks = visibleTags(run?.timeline_marks)
    .filter((tag) => evidenceTime(tag) != null)
    .map((tag) => ({
      kind: "tag",
      tag_id: tag.tag_id,
      tier: tierOf(tag),
      start_sec: tag.evidence.start_sec,
      end_sec: tag.evidence.end_sec ?? tag.evidence.start_sec,
      label: `${formatTimecode(tag.evidence.start_sec)} ${tagLabel(tag, lang)}: «${tag.evidence.text ?? ""}»`,
      // A mark outside any flag has no popup: its tooltip carries the disclaimer.
      title: `${tagLabel(tag, lang)}\n${tagTooltip(tag, lang)}\n${t("tags.disclaimer", lang)}`,
    }));
  const subtypes = run?.tag_catalogue?.markers?.sponsored?.subtypes ?? {};
  const segments = (run?.segment_markers ?? []).map((segment) => {
    // A subtype ("self_promo": the author's own channel) has its own name.
    const sub = segment.subtype ? subtypes[segment.subtype] : null;
    const name = sub?.name ?? sponsoredName;
    const definition = sub?.definition ?? sponsoredDefinition;
    // Each phrase is verbatim caption text, quoted on its own (never stitched).
    const spans = segment.evidence_spans?.length ? segment.evidence_spans : segment.evidence ? [segment.evidence] : [];
    const quoted = spans.map((s) => `«${s}»`).join(" … ");
    const source = segmentSource(segment, lang);
    const sbOnly = source && source.kind !== "both";
    return {
      kind: "sponsored",
      start_sec: segment.start_sec,
      end_sec: segment.end_sec,
      ...(source ? { source: source.kind } : {}),
      label: `${formatTimecode(segment.start_sec)} ${name}${sbOnly ? ` (${source.note})` : ""}`,
      title:
        `${name}${quoted ? `: ${quoted}` : ""}${definition ? `\n${definition}` : ""}` +
        (source ? `\n${source.note}${sbOnly ? `\n${t("tags.sponsorBlockHint", lang)}` : ""}` : ""),
    };
  });
  return [...segments, ...marks, ...observationItems(run, lang), ...frameTimelineItems(run)];
}
