// web/src/report.js
//
// The full write-up of one analysis, for download: Markdown (a .md file) or
// a print-ready HTML document that the browser saves as PDF (print dialog,
// "Save as PDF"; Cyrillic and every other script render as on screen).
// Built from the run JSON the player already has (GET /runs/{id}?tags=all).

import { formatTimecode } from "./claimSync.js";
import { t } from "./i18n.js";
import { claimVerdictLabel, isQuote, verdictKey } from "./popup.js";

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
  },
};

function words(lang) {
  return String(lang ?? "en").toLowerCase().startsWith("ru") ? TEXT.ru : TEXT.en;
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
  for (const obs of run.observations ?? []) {
    const places = (obs.spans ?? []).filter(Boolean);
    observations.push({
      name: obs.name ?? obs.tag_id ?? "",
      literature: obs.literature ?? "",
      explanation: obs.explanation ?? obs.definition ?? "",
      places: places.map((p) => ({ sec: p.start_sec ?? null, text: p.text ?? "" })),
    });
  }
  const offFlag = (run.timeline_marks ?? []).map((tag) => ({
    name: tag.name,
    explanation: tag.explanation ?? "",
    sec: tag.evidence?.start_sec ?? null,
    text: tag.evidence?.text ?? "",
  }));
  const sponsoredName = run.tag_catalogue?.markers?.sponsored?.name ?? t("tags.sponsored", lang);
  const ads = (run.segment_markers ?? []).map((s) => ({
    name: s.subtype_name || s.name || sponsoredName,
    start: s.start_sec,
    end: s.end_sec,
    spans: s.evidence_spans?.length ? s.evidence_spans : s.evidence ? [s.evidence] : [],
  }));

  const items = claims.map((claim) => {
    const notes = (list) =>
      (list ?? []).map((tag) => ({
        name: tag.name,
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
    tagged: items.filter((i) => i.reasons.length || i.phrasing.length).length,
    counts,
    observations,
    offFlag,
    ads,
    items,
    tagDisclaimer: t("tags.disclaimer", lang),
    run,
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

  if (r.observations.length || r.offFlag.length || r.ads.length) {
    out.push(`## ${w.observations}`, "");
    for (const o of r.observations) {
      out.push(`**${mdEscape(o.name)}**${o.literature ? ` (${mdEscape(o.literature)})` : ""}${o.explanation ? ` — ${mdEscape(o.explanation)}` : ""}`);
      for (const p of o.places) out.push(`- ${mdTime(r, p.sec)} «${mdEscape(p.text)}»`);
      out.push("");
    }
    if (r.offFlag.length) {
      out.push(`### ${w.offFlag}`, "");
      for (const m of r.offFlag) out.push(`- ${mdTime(r, m.sec)} **${mdEscape(m.name)}** — «${mdEscape(m.text)}»${m.explanation ? `. ${mdEscape(m.explanation)}` : ""}`);
      out.push("");
    }
    if (r.ads.length) {
      out.push(`### ${w.ads}`, "");
      for (const a of r.ads) {
        out.push(`- ${mdTime(r, a.start)}–${formatTimecode(a.end)} ${mdEscape(a.name)}${a.spans.length ? `: «${a.spans.map(mdEscape).join("» … «")}»` : ""}`);
      }
      out.push("");
    }
  }

  out.push(`## ${w.list}`, "");
  for (const i of r.items) {
    out.push(`### ${mdTime(r, i.sec)} — ${mdEscape(i.verdict)}`, "");
    if (i.quote) out.push(`*${w.quoteOf}${i.quote.author ? `: ${mdEscape(i.quote.author)}` : ""}*`, "");
    out.push(`> ${mdEscape(i.text)}`, "");
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
        out.push(`- ${mdEscape(n.name)}${n.literature ? ` (${mdEscape(n.literature)})` : ""}: ${mdEscape(n.explanation)}${n.text ? ` — «${mdEscape(n.text)}»` : ""}`);
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

  if (r.observations.length || r.offFlag.length || r.ads.length) {
    parts.push(`<h2>${esc(w.observations)}</h2>`);
    for (const o of r.observations) {
      parts.push(`<p><span class="label">${esc(o.name)}</span>${o.literature ? ` (${esc(o.literature)})` : ""}${o.explanation ? ` — ${esc(o.explanation)}` : ""}</p>`);
      if (o.places.length) parts.push(`<ul>${o.places.map((p) => `<li>${htmlTime(r, p.sec)} «${esc(p.text)}»</li>`).join("")}</ul>`);
    }
    if (r.offFlag.length) {
      parts.push(`<h3>${esc(w.offFlag)}</h3><ul>${r.offFlag.map((m) => `<li>${htmlTime(r, m.sec)} <span class="label">${esc(m.name)}</span> — «${esc(m.text)}»${m.explanation ? `. ${esc(m.explanation)}` : ""}</li>`).join("")}</ul>`);
    }
    if (r.ads.length) {
      parts.push(`<h3>${esc(w.ads)}</h3><ul>${r.ads.map((a) => `<li>${htmlTime(r, a.start)}–${formatTimecode(a.end)} ${esc(a.name)}${a.spans.length ? `: «${a.spans.map(esc).join("» … «")}»` : ""}</li>`).join("")}</ul>`);
    }
  }

  parts.push(`<h2>${esc(w.list)}</h2>`);
  for (const i of r.items) {
    const notes = (label, list) =>
      list.length
        ? `<p class="label">${esc(label)}:</p><ul>${list.map((n) => `<li>${esc(n.name)}${n.literature ? ` (${esc(n.literature)})` : ""}: ${esc(n.explanation)}${n.text ? ` — «${esc(n.text)}»` : ""}</li>`).join("")}</ul>`
        : "";
    parts.push(`<section class="claim">
      <div class="claim-head"><span class="dot" data-flag="${esc(i.flag)}"></span>${htmlTime(r, i.sec)} <span class="verdict">${esc(i.verdict)}</span></div>
      ${i.quote ? `<p class="who">${esc(w.quoteOf)}${i.quote.author ? `: ${esc(i.quote.author)}` : ""}</p>` : ""}
      <p class="text">${esc(i.text)}</p>
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
