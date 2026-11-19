// web/src/report.js
//
// The full write-up of one analysis, for download: Markdown (a .md file) or
// a print-ready HTML document that the browser saves as PDF (print dialog,
// "Save as PDF"; Cyrillic and every other script render as on screen).
// Built from the run JSON the player already has (GET /runs/{id}?tags=all).
// "Possible" tags are named «возможно: …» / "possibly: …" and marked pale in
// the PDF; with "Show possible tags" off they are left out (settings.js).
// A note («Личное мнение», not a technique) is listed plainly and not
// counted among the claims "with phrasing notes"; a tag the speaker
// qualifies elsewhere carries the line «Дальше — оговорка автора: «…» (mm:ss)».

import { formatTimecode } from "./claimSync.js?v=4250a1ebb1";
import { labelLanguage, t } from "./i18n.js?v=4250a1ebb1";
import { claimVerdictLabel, isQuote, isRef, verdictKey } from "./popup.js?v=4250a1ebb1";
import { isNote, isPossible, qualifierLine, segmentSource, tagLabel, visibleTags } from "./tags.js?v=4250a1ebb1";
import { formatScoopTotals, formatScore, rejectedSummary, scoopAnchors, shownScoops } from "./scoopList.js?v=4250a1ebb1";

const VERDICT_ORDER = ["green", "yellow", "red", "insufficient", "white"];

const TEXT = {
  ru: {
    heading: "Разбор видео",
    video: "Видео",
    analysis: "Анализ",
    created: "Сформировано",
    overview: "Итог",
    claims: "утверждений",
    quotes: "цитат",
    tagged: "с пометками о подаче",
    disclaimerFacts:
      "Проверка фактов выполнена автоматически (языковые модели и веб-поиск) и может ошибаться. Каждый вывод сопровождается источниками — проверяйте их.",
    observations: "Наблюдения по всему видео",
    ads: "Рекламные вставки",
    offFlag: "Приёмы вне утверждений",
    list: "Утверждения по порядку",
    summary: "Кратко",
    argument: "Разбор",
    confidence: "Уверенность",
    sources: "Источники",
    quoteOf: "Цитата",
    original: "Оригинал",
    phrasing: "Как это сказано",
    reason: "Причина вердикта",
    at: "в",
    refs: "Отсылки к видео",
    inSource: "в обсуждаемом видео",
    scoops: "Скупы",
    scoopsTop: "Топ скупов",
    scoopEvidence: "Доказательства",
    scoopWhy: "Почему меняет понимание",
    scoopPatterns: "Карта паттернов",
    scoopLimits: "Ограничения анализа",
    scoopLimitsText: [
      "Работа идёт по автосубтитрам: отдельные слова могут быть распознаны неверно.",
      "Анализируется только текст: интонация, мимика и видеоряд не учитываются.",
      "Обсуждаемые видео сопоставляются по совпадению текста; источники могут быть неполными.",
      "Выборки малы: при знаменателе меньше 10 проценты не приводятся.",
      "Скуп — интерпретация, а не вердикт о людях и их намерениях.",
    ],
    scoopMeasured: "Замер генерации",
  },
  en: {
    heading: "Video analysis",
    video: "Video",
    analysis: "Analysis",
    created: "Generated",
    overview: "Overview",
    claims: "claims",
    quotes: "quotes",
    tagged: "with phrasing notes",
    disclaimerFacts:
      "The fact-check is automated (language models and web search) and can be wrong. Every finding lists its sources -- check them.",
    observations: "Whole-video observations",
    ads: "Sponsored segments",
    offFlag: "Techniques outside the claims",
    list: "Claims in order",
    summary: "In short",
    argument: "Details",
    confidence: "Confidence",
    sources: "Sources",
    quoteOf: "Quote",
    original: "Original",
    phrasing: "How it's phrased",
    reason: "Reason for the verdict",
    at: "at",
    refs: "References to videos",
    inSource: "in the discussed video",
    scoops: "Scoops",
    scoopsTop: "Top scoops",
    scoopEvidence: "Evidence",
    scoopWhy: "Why it changes the reading",
    scoopPatterns: "Pattern map",
    scoopLimits: "Limits of the analysis",
    scoopLimitsText: [
      "Based on automatic captions: single words can be misheard.",
      "Text only: tone, facial expression and the picture are not analysed.",
      "Discussed videos are matched by shared text; sources can be incomplete.",
      "Samples are small: no percentages below a denominator of 10.",
      "A scoop is an interpretation, not a verdict about people or their intentions.",
    ],
    scoopMeasured: "Generation measured",
  },
};

function words(lang) {
  return String(labelLanguage(lang) ?? "en").toLowerCase().startsWith("ru") ? TEXT.ru : TEXT.en;
}

function videoUrl(run, sec) {
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(run.video_id ?? "")}`;
  return sec == null ? base : `${base}&t=${Math.max(0, Math.floor(sec))}s`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The report's content as plain data, shared by the Markdown and HTML
 * renderers so both say the same thing.
 */
export function buildReport(run, { title = "", now = new Date() } = {}) {
  const lang = run.caption_language ?? "en";
  const w = words(lang);
  const claims = [...(run.claims ?? [])].sort((a, b) => a.start_sec - b.start_sec);
  const counts = VERDICT_ORDER.map((key) => ({
    key,
    label: t(`verdict.${key}`, lang),
    count: claims.filter((c) => verdictKey(c) === key).length,
  })).filter((c) => c.count > 0);

  const observations = [];
  for (const obs of visibleTags(run.observations)) {
    const places = (obs.spans ?? []).filter(Boolean);
    observations.push({
      possible: isPossible(obs),
      name: tagLabel({ ...obs, name: obs.name ?? obs.tag_id ?? "" }, lang),
      literature: obs.literature ?? "",
      explanation: obs.explanation ?? obs.definition ?? "",
      places: places.map((p) => ({ sec: p.start_sec ?? null, text: p.text ?? "" })),
      qualifier: qualifierLine(obs, lang),
    });
  }
  const offFlag = visibleTags(run.timeline_marks).map((tag) => ({
    possible: isPossible(tag),
    note: isNote(tag),
    qualifier: qualifierLine(tag, lang),
    name: tagLabel(tag, lang),
    explanation: tag.explanation ?? "",
    sec: tag.evidence?.start_sec ?? null,
    text: tag.evidence?.text ?? "",
  }));
  const sponsoredName = run.tag_catalogue?.markers?.sponsored?.name ?? t("tags.sponsored", lang);
  const ads = (run.segment_markers ?? []).map((s) => ({
    name: s.subtype_name || run.tag_catalogue?.markers?.sponsored?.subtypes?.[s.subtype]?.name || s.name || sponsoredName,
    start: s.start_sec,
    end: s.end_sec,
    spans: s.evidence_spans?.length ? s.evidence_spans : s.evidence ? [s.evidence] : [],
    // «по данным SponsorBlock» / "also marked in SponsorBlock" ('' for ours alone).
    source: segmentSource(s, lang)?.note ?? "",
  }));
  // Referenced videos: the discussed videos and the claims about them.
  const referencedVideos = (run.referenced_videos ?? []).map((v) => ({
    title: String(v.title ?? "").trim() || v.source_video_id,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.source_video_id ?? "")}`,
    confidence: t(`ref.confidence.${v.confidence}`, lang),
    runId: v.source_run_id ?? null,
  }));
  const refs = claims.filter(isRef).map((claim) => ({
    sec: claim.start_sec,
    flag: claim.flag,
    verdict: claimVerdictLabel(claim, lang),
    kind: t(`ref.kind.${claim.ref.kind}`, lang),
    text: claim.text ?? "",
    source: String(claim.ref.source_title ?? "").trim() || claim.ref.source_video_id || "",
    sourceSec: claim.ref.source_start_sec ?? null,
    sourceUrl: /^https:\/\/(www\.)?youtube\.com\//.test(String(claim.ref.source_url ?? "")) ? claim.ref.source_url : "",
    words: String(claim.ref.source_words ?? "").trim(),
  }));
  // A whole-video SponsorBlock label (sponsored / exclusive access).
  const sponsorBlockVideo = run.sponsorblock_note ? t("tags.sponsorBlockVideo", lang) : "";

  const items = claims.map((claim) => {
    const notes = (list) =>
      visibleTags(list).map((tag) => ({
        possible: isPossible(tag),
        note: isNote(tag),
        qualifier: qualifierLine(tag, lang),
        name: tagLabel(tag, lang),
        literature: tag.literature ?? "",
        explanation: tag.explanation ?? "",
        sec: tag.evidence?.start_sec ?? null,
        text: tag.evidence?.text ?? "",
      }));
    const quote = isQuote(claim)
      ? {
          author: String(claim.quote.author ?? "").trim(),
          original: String(claim.quote.original_quote ?? "").trim(),
          source: String(claim.quote.original_source ?? "").trim(),
        }
      : null;
    return {
      id: claim.id,
      sec: claim.start_sec,
      flag: claim.flag,
      verdict: claimVerdictLabel(claim, lang),
      text: claim.text ?? "",
      summary: String(claim.summary ?? "").trim(),
      argument: String(claim.argument ?? "").trim(),
      confidence: claim.flag !== "white" && typeof claim.confidence === "number" ? Math.round(claim.confidence) : null,
      sources: claim.sources ?? [],
      quote,
      reasons: notes(claim.verdict_reasons),
      phrasing: notes(claim.tags),
    };
  });

  return {
    lang,
    w,
    title: title || run.title || run.video_id || `#${run.run_id}`,
    url: videoUrl(run),
    runId: run.run_id,
    created: now.toISOString().slice(0, 10),
    total: claims.length,
    quotes: items.filter((i) => i.quote).length,
    // A note («Личное мнение») is not a technique: it does not make a claim "tagged".
    tagged: items.filter((i) => i.reasons.length || i.phrasing.some((n) => !n.note)).length,
    counts,
    observations,
    offFlag,
    ads,
    sponsorBlockVideo,
    referencedVideos,
    refs,
    items,
    tagDisclaimer: t("tags.disclaimer", lang),
    scoops: buildScoops(run, lang),
    run,
  };
}

/** The scoops section (null when the run has no scoop generation loaded). */
function buildScoops(run, lang) {
  const response = run.scoops;
  if (!response?.scoop_run || response.scoop_run.status !== "complete") return null;
  const anchorOf = (a) => ({
    sec: a.start_sec,
    quote: String(a.quote ?? "").trim(),
    source: a.video === "source",
    url: a.video === "source" ? (/^https:\/\/(www\.)?youtube\.com\//.test(String(a.watch_url ?? "")) ? a.watch_url : "") : videoUrl(run, a.start_sec),
  });
  const card = (s) => ({
    title: s.title ?? "",
    scoop: s.scoop ?? "",
    anchors: scoopAnchors(s).map(anchorOf),
    before: s.reframe?.before ?? "",
    after: s.reframe?.after ?? "",
    confidence: s.confidence?.level ? t(`scoop.confidence.${s.confidence.level}`, lang) : "",
    confidenceRule: s.confidence?.rule ?? "",
    scores: s.scores
      ? `${t("scoop.axis.sharp", lang)} ${formatScore(s.scores.sharp, lang)} · ${t("scoop.axis.interesting", lang)} ${formatScore(s.scores.interesting, lang)} · ${t("scoop.axis.nonobvious", lang)} ${formatScore(s.scores.nonobvious, lang)} · ${t("scoop.total", lang)} ${formatScore(s.scores.total_0_100, lang, 0)}/100`
      : "",
    status: s.status ? t(`scoop.status.${s.status}`, lang) : "",
    directions: s.directions ?? [],
  });
  const shown = shownScoops(response);
  const metrics = [];
  const seen = new Set();
  for (const s of shown) {
    for (const m of s.stats_resolved ?? []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      metrics.push({ unit: m.unit ?? "", count: m.count_text || `${m.numerator} / ${m.denominator}`, method: m.method ?? "", limits: (m.limitations ?? []).join("; ") });
    }
  }
  const aap = [];
  for (const key of ["audience", "agenda", "persona"]) {
    for (const e of response.aap_map?.[key] ?? []) {
      const text = key === "audience" ? e.text : key === "agenda" ? [e.observed_direction, e.inferred].filter(Boolean).join(" ") : e.role;
      if (text) aap.push({ kind: t(`scoop.aap.${key}`, lang), text, alternative: e.alternative ?? "" });
    }
  }
  return {
    shown: shown.map(card),
    none: shown.length ? "" : t("scoop.none", lang),
    noneWhy: shown.length ? "" : rejectedSummary(response.scoop_run.summary, lang),
    hypotheses: (response.hypotheses ?? []).map(card),
    metrics,
    aap,
    measured: formatScoopTotals(response, lang),
  };
}

// ---- Markdown ----

function mdEscape(text) {
  return String(text ?? "").replace(/([\\`*_[\]<>#|])/g, "\\$1");
}

function mdTime(report, sec) {
  return sec == null ? "" : `[${formatTimecode(sec)}](${videoUrl(report.run, sec)})`;
}

export function reportMarkdown(run, options = {}) {
  const r = buildReport(run, options);
  const { w } = r;
  const out = [];
  out.push(`# ${w.heading}: ${mdEscape(r.title)}`, "");
  out.push(`- ${w.video}: ${r.url}`);
  out.push(`- ${w.analysis}: #${r.runId} · ${w.created} ${r.created}`, "");
  out.push(`## ${w.overview}`, "");
  out.push(
    `${r.total} ${w.claims}` +
      (r.quotes ? ` · ${r.quotes} ${w.quotes}` : "") +
      (r.tagged ? ` · ${r.tagged} ${w.tagged}` : ""),
    ""
  );
  for (const c of r.counts) out.push(`- ${c.label}: ${c.count}`);
  out.push("", `> ${w.disclaimerFacts}`, ">", `> ${r.tagDisclaimer}`, "");

  if (r.scoops) {
    const sc = r.scoops;
    const anchorMd = (a) => {
      const time = a.url ? `[${formatTimecode(a.sec)}](${a.url})` : formatTimecode(a.sec);
      return `${time} «${mdEscape(a.quote)}»${a.source ? ` (${w.inSource})` : ""}`;
    };
    out.push(`## ${w.scoops}`, "", `> ${t("scoop.disclaimer", r.lang)}`, "");
    if (sc.shown.length) {
      out.push(`### ${w.scoopsTop}`, "");
      for (const s of sc.shown) {
        out.push(`#### ${mdEscape(s.title)}`, "", mdEscape(s.scoop), "");
        if (s.anchors.length) out.push(`**${w.scoopEvidence}:** ${s.anchors.map(anchorMd).join("; ")}`, "");
        if (s.before || s.after) out.push(`**${w.scoopWhy}:** ${t("scoop.before", r.lang)}: ${mdEscape(s.before)} / ${t("scoop.after", r.lang)}: ${mdEscape(s.after)}`, "");
        if (s.confidence) out.push(`**${t("scoop.confidence", r.lang)}:** ${s.confidence}${s.confidenceRule ? ` — ${mdEscape(s.confidenceRule)}` : ""}${s.status ? ` · ${s.status}` : ""}`, "");
        if (s.scores) out.push(s.scores, "");
      }
    } else {
      out.push(`*${sc.none}*`, "");
      if (sc.noneWhy) out.push(mdEscape(sc.noneWhy), "");
    }
    if (sc.metrics.length) {
      out.push(`### ${w.scoopPatterns}`, "");
      for (const m of sc.metrics) out.push(`- **${m.count}** — ${mdEscape(m.unit)}${m.method ? `. ${t("scoop.method", r.lang)}: ${mdEscape(m.method)}` : ""}${m.limits ? `. ${t("scoop.limits", r.lang)}: ${mdEscape(m.limits)}` : ""}`);
      out.push("");
    }
    if (sc.aap.length && (sc.shown.length || sc.hypotheses.length)) {
      out.push(`### ${t("scoop.aap", r.lang)}`, "", `*${t("scoop.aapNote", r.lang)}*`, "");
      for (const a of sc.aap) out.push(`- **${a.kind}:** ${mdEscape(a.text)}${a.alternative ? ` *${t("scoop.alternative", r.lang)}: ${mdEscape(a.alternative)}*` : ""}`);
      out.push("");
    }
    if (sc.hypotheses.length) {
      out.push(`### ${t("scoop.hypotheses", r.lang)}`, "");
      for (const h of sc.hypotheses) {
        out.push(`- **${mdEscape(h.title)}** — ${mdEscape(h.scoop)}${h.directions.length ? ` ${t("scoop.directions", r.lang)}: ${h.directions.map(mdEscape).join("; ")}` : ""}`);
      }
      out.push("");
    }
    out.push(`### ${w.scoopLimits}`, "");
    for (const line of w.scoopLimitsText) out.push(`- ${line}`);
    out.push("");
    if (sc.measured) out.push(`*${w.scoopMeasured}: ${sc.measured}*`, "");
  }

  if (r.observations.length || r.offFlag.length || r.ads.length || r.sponsorBlockVideo) {
    out.push(`## ${w.observations}`, "");
    for (const o of r.observations) {
      out.push(`**${mdEscape(o.name)}**${o.literature ? ` (${mdEscape(o.literature)})` : ""}${o.explanation ? ` — ${mdEscape(o.explanation)}` : ""}`);
      for (const p of o.places) out.push(`- ${mdTime(r, p.sec)} «${mdEscape(p.text)}»`);
      if (o.qualifier) out.push(`- *${mdEscape(o.qualifier)}*`);
      out.push("");
    }
    if (r.offFlag.length) {
      out.push(`### ${w.offFlag}`, "");
      for (const m of r.offFlag) out.push(`- ${mdTime(r, m.sec)} **${mdEscape(m.name)}** — «${mdEscape(m.text)}»${m.explanation ? `. ${mdEscape(m.explanation)}` : ""}${m.qualifier ? ` *${mdEscape(m.qualifier)}*` : ""}`);
      out.push("");
    }
    if (r.ads.length || r.sponsorBlockVideo) {
      out.push(`### ${w.ads}`, "");
      if (r.sponsorBlockVideo) out.push(`*${mdEscape(r.sponsorBlockVideo)}*`, "");
      for (const a of r.ads) {
        out.push(`- ${mdTime(r, a.start)}–${formatTimecode(a.end)} ${mdEscape(a.name)}${a.spans.length ? `: «${a.spans.map(mdEscape).join("» … «")}»` : ""}${a.source ? ` *(${mdEscape(a.source)})*` : ""}`);
      }
      out.push("");
    }
  }

  if (r.referencedVideos.length || r.refs.length) {
    out.push(`## ${w.refs}`, "");
    out.push(`**${t("ref.videos", r.lang)}:**`);
    for (const v of r.referencedVideos) out.push(`- [${mdEscape(v.title)}](${v.url}) — ${mdEscape(v.confidence)}`);
    out.push("");
    for (const x of r.refs) {
      out.push(`- ${mdTime(r, x.sec)} **${mdEscape(x.verdict)}** (${mdEscape(x.kind)}): «${mdEscape(x.text)}»`);
      if (x.sourceUrl) {
        out.push(`  - ${w.inSource} [${mdEscape(x.source)}${x.sourceSec != null ? ` ${formatTimecode(x.sourceSec)}` : ""}](${x.sourceUrl})${x.words ? `: «${mdEscape(x.words)}»` : ""}`);
      }
    }
    out.push("");
  }

  out.push(`## ${w.list}`, "");
  for (const i of r.items) {
    out.push(`### ${mdTime(r, i.sec)} — ${mdEscape(i.verdict)}`, "");
    if (i.quote) out.push(`*${w.quoteOf}${i.quote.author ? `: ${mdEscape(i.quote.author)}` : ""}*`, "");
    out.push(`> ${r.lang.startsWith("ru") ? "«" : "“"}${mdEscape(i.text)}${r.lang.startsWith("ru") ? "»" : "”"}`, "");
    if (i.summary) out.push(`**${w.summary}:** ${mdEscape(i.summary)}`, "");
    if (i.quote?.original) {
      out.push(`**${w.original}:** «${mdEscape(i.quote.original)}»${i.quote.source ? ` — ${i.quote.source}` : ""}`, "");
    }
    if (i.argument) out.push(`**${w.argument}:** ${mdEscape(i.argument)}`, "");
    if (i.confidence != null) out.push(`${w.confidence}: ${i.confidence}%`, "");
    for (const [label, list] of [[w.reason, i.reasons], [w.phrasing, i.phrasing]]) {
      if (!list.length) continue;
      out.push(`**${label}:**`);
      for (const n of list) {
        out.push(`- ${mdEscape(n.name)}${n.literature ? ` (${mdEscape(n.literature)})` : ""}: ${mdEscape(n.explanation)}${n.text ? ` — «${mdEscape(n.text)}»` : ""}${n.qualifier ? ` *${mdEscape(n.qualifier)}*` : ""}`);
      }
      out.push("");
    }
    if (i.sources.length) {
      out.push(`**${w.sources}:**`);
      for (const s of i.sources) out.push(`- [${mdEscape(hostOf(s))}](${s})`);
      out.push("");
    }
  }
  return out.join("\n");
}

// ---- Print-ready HTML (saved as PDF from the print dialog) ----

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url) {
  return /^https?:\/\//i.test(String(url ?? "")) ? String(url) : "#";
}

function htmlTime(r, sec) {
  return sec == null ? "" : `<a class="tc" href="${esc(videoUrl(r.run, sec))}">${formatTimecode(sec)}</a>`;
}

const PRINT_CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.45 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 6pt; }
  h2 { font-size: 13pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  h3 { font-size: 11pt; margin: 10pt 0 4pt; }
  .meta { color: #555; margin: 0 0 8pt; }
  .counts { display: flex; flex-wrap: wrap; gap: 6pt; margin: 6pt 0; padding: 0; list-style: none; }
  .counts li { border: 1px solid #ccc; border-radius: 10pt; padding: 1pt 8pt; }
  .note { color: #555; font-size: 9pt; border-left: 3px solid #ccc; padding-left: 8pt; margin: 8pt 0; }
  .claim { break-inside: avoid; border-top: 1px solid #e3e3e3; padding: 7pt 0; }
  .claim-head { display: flex; gap: 8pt; align-items: baseline; }
  .dot { width: 9pt; height: 9pt; border-radius: 50%; display: inline-block; flex: none; border: 1px solid #999; }
  .dot[data-flag="green"] { background: #2e9e4f; border-color: #2e9e4f; }
  .dot[data-flag="yellow"] { background: #e2b419; border-color: #e2b419; }
  .dot[data-flag="red"] { background: #d64545; border-color: #d64545; }
  .dot[data-flag="white"] { background: #fff; }
  .verdict { font-weight: 600; }
  .tc { color: #555; text-decoration: none; font-variant-numeric: tabular-nums; }
  .text { font-size: 11pt; font-weight: 600; margin: 3pt 0; }
  .who { color: #555; font-style: italic; margin: 2pt 0; }
  p { margin: 3pt 0; }
  .label { font-weight: 600; }
  ul { margin: 2pt 0 2pt 14pt; padding: 0; }
  .src a { color: #1a55a8; word-break: break-all; }
  blockquote { margin: 3pt 0; padding-left: 8pt; border-left: 2px solid #ddd; color: #333; }
  a { color: inherit; }
  .possible { color: #777; }
  .opinion-note { color: #666; }
  .qualifier { color: #555; font-style: italic; }
  .scoop { break-inside: avoid; border-left: 3px solid #4f4bd6; padding: 4pt 0 4pt 8pt; margin: 6pt 0; }
  .scores { color: #333; font-variant-numeric: tabular-nums; }
`;

export function reportHtml(run, options = {}) {
  const r = buildReport(run, options);
  const { w } = r;
  const parts = [];
  parts.push(`<h1>${esc(w.heading)}: ${esc(r.title)}</h1>`);
  parts.push(`<p class="meta">${esc(w.video)}: <a href="${esc(r.url)}">${esc(r.url)}</a><br>${esc(w.analysis)} #${esc(r.runId)} · ${esc(w.created)} ${esc(r.created)}</p>`);
  parts.push(`<h2>${esc(w.overview)}</h2>`);
  parts.push(`<p>${r.total} ${esc(w.claims)}${r.quotes ? ` · ${r.quotes} ${esc(w.quotes)}` : ""}${r.tagged ? ` · ${r.tagged} ${esc(w.tagged)}` : ""}</p>`);
  parts.push(`<ul class="counts">${r.counts.map((c) => `<li>${esc(c.label)}: ${c.count}</li>`).join("")}</ul>`);
  parts.push(`<p class="note">${esc(w.disclaimerFacts)}<br>${esc(r.tagDisclaimer)}</p>`);

  if (r.scoops) {
    const sc = r.scoops;
    const anchorHtml = (a) =>
      `${a.url ? `<a class="tc" href="${esc(safeUrl(a.url))}">${formatTimecode(a.sec)}</a>` : formatTimecode(a.sec)} «${esc(a.quote)}»${a.source ? ` <span class="qualifier">(${esc(w.inSource)})</span>` : ""}`;
    parts.push(`<h2>${esc(w.scoops)}</h2><p class="note">${esc(t("scoop.disclaimer", r.lang))}</p>`);
    if (sc.shown.length) {
      parts.push(`<h3>${esc(w.scoopsTop)}</h3>`);
      for (const s of sc.shown) {
        parts.push(`<section class="scoop">
      <p class="text">${esc(s.title)}</p>
      <p>${esc(s.scoop)}</p>
      ${s.anchors.length ? `<p class="label">${esc(w.scoopEvidence)}:</p><ul>${s.anchors.map((a) => `<li>${anchorHtml(a)}</li>`).join("")}</ul>` : ""}
      ${s.before || s.after ? `<p><span class="label">${esc(w.scoopWhy)}:</span> ${esc(t("scoop.before", r.lang))}: ${esc(s.before)} / ${esc(t("scoop.after", r.lang))}: ${esc(s.after)}</p>` : ""}
      ${s.confidence ? `<p><span class="label">${esc(t("scoop.confidence", r.lang))}:</span> ${esc(s.confidence)}${s.confidenceRule ? ` — ${esc(s.confidenceRule)}` : ""}${s.status ? ` · ${esc(s.status)}` : ""}</p>` : ""}
      ${s.scores ? `<p class="scores">${esc(s.scores)}</p>` : ""}
    </section>`);
      }
    } else {
      parts.push(`<p><em>${esc(sc.none)}</em></p>${sc.noneWhy ? `<p class="note">${esc(sc.noneWhy)}</p>` : ""}`);
    }
    if (sc.metrics.length) {
      parts.push(`<h3>${esc(w.scoopPatterns)}</h3><ul>${sc.metrics.map((m) => `<li><span class="label">${esc(m.count)}</span> — ${esc(m.unit)}${m.method ? `. ${esc(t("scoop.method", r.lang))}: ${esc(m.method)}` : ""}${m.limits ? `. ${esc(t("scoop.limits", r.lang))}: ${esc(m.limits)}` : ""}</li>`).join("")}</ul>`);
    }
    if (sc.aap.length && (sc.shown.length || sc.hypotheses.length)) {
      parts.push(`<h3>${esc(t("scoop.aap", r.lang))}</h3><p class="note">${esc(t("scoop.aapNote", r.lang))}</p><ul>${sc.aap.map((a) => `<li><span class="label">${esc(a.kind)}:</span> ${esc(a.text)}${a.alternative ? ` <span class="qualifier">${esc(t("scoop.alternative", r.lang))}: ${esc(a.alternative)}</span>` : ""}</li>`).join("")}</ul>`);
    }
    if (sc.hypotheses.length) {
      parts.push(`<h3>${esc(t("scoop.hypotheses", r.lang))}</h3><ul>${sc.hypotheses.map((h) => `<li><span class="label">${esc(h.title)}</span> — ${esc(h.scoop)}${h.directions.length ? ` <span class="qualifier">${esc(t("scoop.directions", r.lang))}: ${h.directions.map(esc).join("; ")}</span>` : ""}</li>`).join("")}</ul>`);
    }
    parts.push(`<h3>${esc(w.scoopLimits)}</h3><ul>${w.scoopLimitsText.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`);
    if (sc.measured) parts.push(`<p class="note">${esc(w.scoopMeasured)}: ${esc(sc.measured)}</p>`);
  }

  if (r.observations.length || r.offFlag.length || r.ads.length || r.sponsorBlockVideo) {
    parts.push(`<h2>${esc(w.observations)}</h2>`);
    for (const o of r.observations) {
      parts.push(`<p${o.possible ? ' class="possible"' : ""}><span class="label">${esc(o.name)}</span>${o.literature ? ` (${esc(o.literature)})` : ""}${o.explanation ? ` — ${esc(o.explanation)}` : ""}</p>`);
      if (o.places.length) parts.push(`<ul>${o.places.map((p) => `<li>${htmlTime(r, p.sec)} «${esc(p.text)}»</li>`).join("")}</ul>`);
      if (o.qualifier) parts.push(`<p class="qualifier">${esc(o.qualifier)}</p>`);
    }
    if (r.offFlag.length) {
      parts.push(`<h3>${esc(w.offFlag)}</h3><ul>${r.offFlag.map((m) => `<li${m.possible ? ' class="possible"' : ""}>${htmlTime(r, m.sec)} <span class="label">${esc(m.name)}</span> — «${esc(m.text)}»${m.explanation ? `. ${esc(m.explanation)}` : ""}${m.qualifier ? ` <span class="qualifier">${esc(m.qualifier)}</span>` : ""}</li>`).join("")}</ul>`);
    }
    if (r.ads.length || r.sponsorBlockVideo) {
      parts.push(`<h3>${esc(w.ads)}</h3>${r.sponsorBlockVideo ? `<p class="note">${esc(r.sponsorBlockVideo)}</p>` : ""}<ul>${r.ads.map((a) => `<li>${htmlTime(r, a.start)}–${formatTimecode(a.end)} ${esc(a.name)}${a.spans.length ? `: «${a.spans.map(esc).join("» … «")}»` : ""}${a.source ? ` <span class="qualifier">(${esc(a.source)})</span>` : ""}</li>`).join("")}</ul>`);
    }
  }

  if (r.referencedVideos.length || r.refs.length) {
    parts.push(`<h2>${esc(w.refs)}</h2>`);
    parts.push(`<p class="label">${esc(t("ref.videos", r.lang))}:</p><ul>${r.referencedVideos.map((v) => `<li><a href="${esc(v.url)}">${esc(v.title)}</a> — ${esc(v.confidence)}</li>`).join("")}</ul>`);
    parts.push(`<ul class="refs">${r.refs.map((x) => `<li><span class="dot" data-flag="${esc(x.flag)}"></span> ${htmlTime(r, x.sec)} <span class="verdict">${esc(x.verdict)}</span> (${esc(x.kind)}): «${esc(x.text)}»${x.sourceUrl ? `<br>${esc(w.inSource)} <a href="${esc(x.sourceUrl)}">${esc(x.source)}${x.sourceSec != null ? ` ${formatTimecode(x.sourceSec)}` : ""}</a>${x.words ? `: <blockquote>${esc(x.words)}</blockquote>` : ""}` : ""}</li>`).join("")}</ul>`);
  }

  parts.push(`<h2>${esc(w.list)}</h2>`);
  for (const i of r.items) {
    const notes = (label, list) =>
      list.length
        ? `<p class="label">${esc(label)}:</p><ul>${list.map((n) => `<li${n.possible ? ' class="possible"' : n.note ? ' class="opinion-note"' : ""}>${esc(n.name)}${n.literature ? ` (${esc(n.literature)})` : ""}: ${esc(n.explanation)}${n.text ? ` — «${esc(n.text)}»` : ""}${n.qualifier ? ` <span class="qualifier">${esc(n.qualifier)}</span>` : ""}</li>`).join("")}</ul>`
        : "";
    parts.push(`<section class="claim">
      <div class="claim-head"><span class="dot" data-flag="${esc(i.flag)}"></span>${htmlTime(r, i.sec)} <span class="verdict">${esc(i.verdict)}</span></div>
      ${i.quote ? `<p class="who">${esc(w.quoteOf)}${i.quote.author ? `: ${esc(i.quote.author)}` : ""}</p>` : ""}
      <p class="text">${r.lang.startsWith("ru") ? "«" : "“"}${esc(i.text)}${r.lang.startsWith("ru") ? "»" : "”"}</p>
      ${i.summary ? `<p><span class="label">${esc(w.summary)}:</span> ${esc(i.summary)}</p>` : ""}
      ${i.quote?.original ? `<blockquote>${esc(i.quote.original)}${i.quote.source ? ` — <a href="${esc(safeUrl(i.quote.source))}">${esc(hostOf(i.quote.source))}</a>` : ""}</blockquote>` : ""}
      ${i.argument ? `<p><span class="label">${esc(w.argument)}:</span> ${esc(i.argument)}</p>` : ""}
      ${i.confidence != null ? `<p>${esc(w.confidence)}: ${i.confidence}%</p>` : ""}
      ${notes(w.reason, i.reasons)}
      ${notes(w.phrasing, i.phrasing)}
      ${i.sources.length ? `<p class="label">${esc(w.sources)}:</p><ul class="src">${i.sources.map((s) => `<li><a href="${esc(safeUrl(s))}">${esc(s)}</a></li>`).join("")}</ul>` : ""}
    </section>`);
  }
  return `<!doctype html><html lang="${esc(r.lang)}"><head><meta charset="utf-8"><title>NOBS — ${esc(r.title)}</title><style>${PRINT_CSS}</style></head><body>${parts.join("\n")}</body></html>`;
}

// ---- Delivery ----

function fileStem(run, title) {
  const base = String(title || run.video_id || "analysis")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `NOBS ${run.run_id} - ${base}`;
}

/** Download the Markdown write-up as a .md file. */
export function downloadMarkdown(run, { title = "", doc = document } = {}) {
  const blob = new Blob([reportMarkdown(run, { title })], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = `${fileStem(run, title)}.md`;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The original transcript as plain text: a short header, then one caption
 * cue per line as "[m:ss] text"; a speaker change (YouTube's ">>") starts a
 * new paragraph marked ">>".
 */
export function transcriptText(run, cues, { title = "" } = {}) {
  const head = [];
  if (title) head.push(title);
  if (run.video_id) head.push(`https://www.youtube.com/watch?v=${run.video_id}`);
  const lines = [];
  for (const cue of cues ?? []) {
    const text = String(cue.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (cue.voice_change && lines.length) lines.push("");
    lines.push(`[${formatTimecode(cue.start_sec)}] ${cue.voice_change ? ">> " : ""}${text}`);
  }
  return `${head.length ? `${head.join("\n")}\n\n` : ""}${lines.join("\n")}\n`;
}

/** Fetch the run's caption cues and download them as a .txt file. */
export async function downloadTranscript(run, { title = "", doc = document, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`/runs/${run.run_id}/captions`);
  if (!response.ok) throw new Error(`captions: HTTP ${response.status}`);
  const { cues } = await response.json();
  saveBlob(doc, new Blob([transcriptText(run, cues, { title })], { type: "text/plain;charset=utf-8" }), `${fileStem(run, title)} - transcript.txt`);
}

function saveBlob(doc, blob, name) {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Open the print dialog on the print-ready write-up (in a hidden frame, so
 * the player stays as it is); "Save as PDF" there gives the PDF.
 */
export function printReport(run, { title = "", doc = document } = {}) {
  const frame = doc.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = reportHtml(run, { title });
  frame.addEventListener("load", () => {
    const win = frame.contentWindow;
    // The PDF's default file name comes from the top document's title.
    const previousTitle = doc.title;
    doc.title = fileStem(run, title);
    const cleanup = () => {
      doc.title = previousTitle;
      setTimeout(() => frame.remove(), 500);
    };
    win.addEventListener("afterprint", cleanup, { once: true });
    win.focus();
    win.print();
    setTimeout(cleanup, 60000);
  });
  doc.body.appendChild(frame);
}
