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

import { formatTimecode } from "./claimSync.js";
import { t } from "./i18n.js";

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
  if (tag.literature) lines.push(`${t("tags.literature", lang)}: ${tag.literature}`);
  if (tag.subtype_name) lines.push(tag.subtype_name);
  if (tag.explanation) lines.push(tag.explanation);
  const start = evidenceTime(tag);
  if (tag.evidence?.text) lines.push(`«${tag.evidence.text}»${start != null ? ` (${formatTimecode(start)})` : ""}`);
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
  return `${quote}<p class="tag-explanation">${seek} ${escapeHtml(tag.explanation ?? "")}</p>`;
}

/** The "how it is phrased" block of the claim popup ("" without tags). */
export function renderTagChipsHtml(claim, lang = "en") {
  const tags = claim?.tags ?? [];
  if (!tags.length) return "";
  const chips = tags
    .map(
      (tag, i) => `
        <li class="tag-item">
          <button type="button" class="tag-chip" data-action="toggle-tag" data-tag-id="${escapeHtml(tag.tag_id)}"
            aria-expanded="false" aria-controls="tag-panel-${i}" title="${escapeHtml(tagTooltip(tag, lang))}">${escapeHtml(tag.name)}</button>
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
  const reasons = claim?.verdict_reasons ?? [];
  if (!reasons.length) return "";
  const items = reasons
    .map(
      (tag) => `
        <li class="verdict-reason" title="${escapeHtml(tagTooltip(tag, lang))}">
          <span class="verdict-reason-label">${escapeHtml(t("tags.reason", lang))}:</span> ${escapeHtml(tag.name)}
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

/** Tag ids present on a run's claims, in catalogue order, with counts. */
export function tagFilterOptions(run) {
  const counts = new Map();
  for (const claim of run?.claims ?? []) {
    for (const tag of [...(claim.tags ?? []), ...(claim.verdict_reasons ?? [])]) {
      if (!counts.has(tag.tag_id)) counts.set(tag.tag_id, { tag_id: tag.tag_id, name: tag.name, count: 0 });
      counts.get(tag.tag_id).count += 1;
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
  return [...(claim.tags ?? []), ...(claim.verdict_reasons ?? [])].some((tag) => tag.tag_id === tagId);
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
  for (const obs of run?.observations ?? []) {
    const spans = (obs.spans ?? []).filter((span) => typeof span.start_sec === "number" && Number.isFinite(span.start_sec));
    const all = spans.map((span) => formatTimecode(span.start_sec)).join(", ");
    for (const span of spans) {
      const lines = [obs.name];
      if (obs.literature) lines.push(`${t("tags.literature", lang)}: ${obs.literature}`);
      if (obs.explanation) lines.push(obs.explanation);
      lines.push(all);
      if (span.text) lines.push(`«${span.text}» (${formatTimecode(span.start_sec)})`);
      lines.push(t("tags.notIntent", lang));
      lines.push(t("tags.disclaimer", lang));
      items.push({
        kind: "observation",
        observation: obs.kind,
        start_sec: span.start_sec,
        end_sec: span.end_sec ?? span.start_sec,
        label: `${formatTimecode(span.start_sec)} ${obs.name}: «${span.text ?? ""}»`,
        title: lines.join("\n"),
      });
    }
  }
  return items;
}

/** Timeline items: off-flag marks, video-level marks and ad segments, for the control bar. */
export function timelineItems(run) {
  const lang = run?.caption_language ?? "en";
  const sponsoredName = run?.tag_catalogue?.markers?.sponsored?.name ?? t("tags.sponsored", lang);
  const sponsoredDefinition = run?.tag_catalogue?.markers?.sponsored?.definition ?? "";
  const marks = (run?.timeline_marks ?? [])
    .filter((tag) => evidenceTime(tag) != null)
    .map((tag) => ({
      kind: "tag",
      tag_id: tag.tag_id,
      start_sec: tag.evidence.start_sec,
      end_sec: tag.evidence.end_sec ?? tag.evidence.start_sec,
      label: `${formatTimecode(tag.evidence.start_sec)} ${tag.name}: «${tag.evidence.text ?? ""}»`,
      // A mark outside any flag has no popup: its tooltip carries the disclaimer.
      title: `${tag.name}\n${tagTooltip(tag, lang)}\n${t("tags.disclaimer", lang)}`,
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
    return {
      kind: "sponsored",
      start_sec: segment.start_sec,
      end_sec: segment.end_sec,
      label: `${formatTimecode(segment.start_sec)} ${name}`,
      title: `${name}${quoted ? `: ${quoted}` : ""}${definition ? `\n${definition}` : ""}`,
    };
  });
  return [...segments, ...marks, ...observationItems(run, lang)];
}
