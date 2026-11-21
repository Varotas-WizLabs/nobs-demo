// web/src/trace.js
//
// «Как пришли к вердикту»: the research trace of a Deep run (backend:
// nobs.trace, GET /runs/{id}/trace; the public site serves
// data/runs/<id>.trace.json through demoShim.js) shown per claim in the claim
// popup, plus a download of the whole file.
//
// The trace is loaded lazily, when the section is first opened, and once per
// run per page (a failure is not cached, so a later open retries). The public
// copy has no cost or token keys; this renderer never shows them anyway.
// Strings the publishing scan blanked carry `passage_omitted: true` (a
// passage) or `omitted: true` (any other field of that object): a neutral
// note says so.

import { formatConfidence, formatTimecode } from "./claimSync.js?v=3d15d8e254";
import { labelLanguage, t } from "./i18n.js?v=3d15d8e254";
import "./stringsPlayer.js?v=3d15d8e254";

const FLAGS = ["green", "yellow", "red", "white"];
const ANSWERS = ["true", "mostly_true", "mixed", "false", "uncertain"];
const STANCES = ["supports", "refutes", "context", "speaker_source"];
const STAGES = ["claims", "missed", "frames"];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `url` when it is an http(s) address, else "" (shown as text, never a link). */
function safeHttpUrl(url) {
  const s = String(url ?? "");
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    return new URL(s).href ? s : "";
  } catch {
    return "";
  }
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "") || String(url ?? "");
  } catch {
    return String(url ?? "");
  }
}

// ---- loading (cached per run) ----

const cache = new Map();

/** Test hook: forget every cached trace. */
export function _resetTraceCache() {
  cache.clear();
}

export function loadTrace(fetchImpl, runId) {
  const key = String(runId);
  if (cache.has(key)) return cache.get(key);
  const promise = Promise.resolve()
    .then(() => fetchImpl(`/runs/${runId}/trace`))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((body) => (body && typeof body === "object" && Array.isArray(body.claims) ? body : null))
    .catch(() => null)
    .then((trace) => {
      if (trace === null) cache.delete(key);
      return trace;
    });
  cache.set(key, promise);
  return promise;
}

export function claimTrace(trace, claimId) {
  if (!trace || !Array.isArray(trace.claims) || claimId == null) return null;
  return trace.claims.find((c) => c && String(c.claim_id) === String(claimId)) ?? null;
}

// ---- rendering ----

function omittedNote(lang) {
  return `<span class="claim-trace-omitted">${esc(t("plr.trace.omitted", lang))}</span>`;
}

function omittedIf(obj, lang) {
  return obj && obj.omitted === true ? omittedNote(lang) : "";
}

function modelsHtml(models) {
  const list = (Array.isArray(models) ? models : []).filter((m) => typeof m === "string" && m);
  return list.length ? `<span class="claim-trace-models">${esc(list.join(", "))}</span>` : "";
}

function sourceLink(url, domain) {
  const label = domain || hostOf(url);
  const href = safeHttpUrl(url);
  return href
    ? `<a href="${esc(href)}" title="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : `<span class="claim-trace-domain">${esc(label)}</span>`;
}

function stanceLabel(stance, lang) {
  if (!stance) return "";
  const text = STANCES.includes(stance) ? t(`plr.trace.stance.${stance}`, lang) : stance;
  return `<span class="claim-trace-stance" data-stance="${esc(stance)}">${esc(text)}</span>`;
}

function sourceItem(source, lang) {
  if (!source || typeof source !== "object") return "";
  const parts = [sourceLink(source.url, source.domain), stanceLabel(source.stance, lang)];
  if (source.in_verdict) parts.push(`<span class="claim-trace-badge">${esc(t("plr.trace.inVerdict", lang))}</span>`);
  let passage = "";
  if (source.passage_omitted === true) passage = `<p class="claim-trace-passage">${omittedNote(lang)}</p>`;
  else if (String(source.passage ?? "").trim()) passage = `<p class="claim-trace-passage"><q>${esc(source.passage)}</q></p>`;
  return `<li class="claim-trace-source">${parts.filter(Boolean).join(" ")}${omittedIf(source, lang)}${passage}</li>`;
}

function sourcesList(sources, lang) {
  const items = (Array.isArray(sources) ? sources : []).map((s) => sourceItem(s, lang)).join("");
  return items ? `<ul class="claim-trace-sources">${items}</ul>` : "";
}

function kindLabel(kind) {
  if (kind === "fact_check" || kind === "quote_check" || kind === "refs") return `plr.trace.kind.${kind}`;
  if (kind === "passage_recovery" || kind === "recovery") return "plr.trace.kind.passage_recovery";
  return "plr.trace.kind.other";
}

function outcomeHtml(step, lang) {
  const o = step.outcome;
  if (!o || typeof o !== "object") return "";
  let answer = "";
  if (step.kind === "quote_check" || typeof o.found === "boolean") {
    answer = t(o.found ? "plr.trace.found" : "plr.trace.notFound", lang);
  } else if (o.verdict) {
    answer = ANSWERS.includes(o.verdict) ? t(`plr.trace.answer.${o.verdict}`, lang) : String(o.verdict);
  }
  const conf = typeof o.confidence === "number" ? formatConfidence(o.confidence) : "";
  const line = [answer, conf].filter(Boolean).join(" · ");
  const summary = String(o.summary ?? "").trim();
  return (
    (line ? `<p class="claim-trace-outcome"><span class="claim-trace-label">${esc(t("plr.trace.answer", lang))}:</span> ${esc(line)}</p>` : "") +
    (summary ? `<p class="claim-trace-summary">${esc(summary)}</p>` : "") +
    omittedIf(o, lang)
  );
}

function stepHtml(step, lang) {
  if (!step || typeof step !== "object") return "";
  const queries = (Array.isArray(step.queries) ? step.queries : []).filter((q) => String(q ?? "").trim());
  const queriesHtml = queries.length
    ? `<p class="claim-trace-label">${esc(t("plr.trace.queries", lang))}</p><ul class="claim-trace-queries">${queries
        .map((q) => `<li>${esc(q)}</li>`)
        .join("")}</ul>`
    : "";
  const pages = Array.isArray(step.fetched) && step.fetched.length
    ? `<p class="claim-trace-pages">${esc(t("plr.trace.pages", lang).replace("{n}", String(step.fetched.length)))}</p>`
    : "";
  return `<li class="claim-trace-step" data-kind="${esc(step.kind ?? "other")}">
      <p class="claim-trace-head"><span class="claim-trace-kind">${esc(t(kindLabel(step.kind), lang))}</span> ${modelsHtml(step.models)}</p>
      ${omittedIf(step, lang)}
      ${outcomeHtml(step, lang)}
      ${queriesHtml}
      ${pages}
      ${sourcesList(step.sources, lang)}
    </li>`;
}

function extractionHtml(entry, lang) {
  const ex = entry.extraction && typeof entry.extraction === "object" ? entry.extraction : {};
  const stage = STAGES.includes(ex.stage) ? t(`plr.trace.stage.${ex.stage}`, lang) : "";
  const time = typeof entry.start_sec === "number" ? formatTimecode(entry.start_sec) : "";
  const meta = [stage, time].filter(Boolean).join(" · ");
  const quote = String(ex.quote ?? "").trim();
  const reason = String(ex.added_reason ?? "").trim();
  return `<li class="claim-trace-step" data-kind="extraction">
      <p class="claim-trace-head"><span class="claim-trace-kind">${esc(t("plr.trace.extraction", lang))}</span>${meta ? ` <span class="claim-trace-meta">${esc(meta)}</span>` : ""} ${modelsHtml(ex.models)}</p>
      ${omittedIf(ex, lang)}
      ${quote ? `<blockquote class="claim-trace-quote">${esc(quote)}</blockquote>` : ""}
      ${reason ? `<p class="claim-trace-summary">${esc(reason)}</p>` : ""}
    </li>`;
}

// A score event's reason is fixed English from the backend
// (nobs.sources.live): it is shown in the interface language without the
// internal claim id or tier, and hidden when it has another shape.
const CORROBORATED = /^corroborated in claim #\d+ \((?:supports|refutes)\): (\d+) independent source\(s\) agree, best tier-\S+ (\S+) \(/;
const CONTRADICTED = /^contradicted in claim #\d+ \((?:supports|refutes)\): opposed by tier-\S+ (\S+) \(/;

function pluralKey(n, lang) {
  if (lang === "ru") return n % 10 === 1 && n % 100 !== 11 ? "one" : "many";
  return n === 1 ? "one" : "many";
}

export function scoreReasonText(reason, lang = "en") {
  const text = String(reason ?? "");
  let m = text.match(CORROBORATED);
  if (m) {
    const n = Number(m[1]);
    const key = `plr.trace.reason.corroborated.${pluralKey(n, String(labelLanguage(lang) ?? "").split(/[-_]/)[0].toLowerCase())}`;
    return t(key, lang).replace("{n}", String(n)).replace("{domain}", m[2]);
  }
  m = text.match(CONTRADICTED);
  if (m) return t("plr.trace.reason.contradicted", lang).replace("{domain}", m[1]);
  return "";
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "?";
}

function scoresHtml(entry, lang) {
  const items = [];
  for (const use of Array.isArray(entry.scores) ? entry.scores : []) {
    if (!use || typeof use !== "object") continue;
    const label = use.domain || hostOf(use.url);
    for (const e of Array.isArray(use.events) ? use.events : []) {
      if (!e || typeof e !== "object") continue;
      const reason = scoreReasonText(e.reason, lang);
      items.push(
        `<li>${esc(label)}: ${esc(num(e.before))} → ${esc(num(e.after))}${reason ? ` <span class="claim-trace-reason">(${esc(reason)})</span>` : ""}${omittedIf(e, lang)}</li>`
      );
    }
    if (use.omitted === true) items.push(`<li>${esc(label)} ${omittedNote(lang)}</li>`);
  }
  if (!items.length) return "";
  return `<li class="claim-trace-step" data-kind="scores">
      <p class="claim-trace-head"><span class="claim-trace-kind">${esc(t("plr.trace.scores", lang))}</span></p>
      <ul class="claim-trace-scores">${items.join("")}</ul>
    </li>`;
}

function flagLabel(flag, verdict, lang) {
  if (flag === "white") {
    const checked = (verdict?.counted_sources ?? []).length > 0 || (verdict?.confidence ?? 0) > 0;
    return t(checked ? "verdict.insufficient" : "verdict.white", lang);
  }
  return t(`verdict.${flag}`, lang);
}

function chip(flag, label) {
  return `<span class="claim-trace-chip" data-flag="${esc(flag)}">${esc(label)}</span>`;
}

function specialistHtml(entry, lang) {
  const sp = entry.specialist;
  if (!sp || typeof sp !== "object") return "";
  const flag = FLAGS.includes(sp.verdict) ? sp.verdict : "";
  const verdict = flag ? chip(flag, t(`verdict.${flag}`, lang)) : esc(sp.verdict ?? "");
  const agrees = typeof sp.agrees === "boolean" ? ` ${esc(t(sp.agrees ? "plr.trace.agrees" : "plr.trace.disagrees", lang))}` : "";
  return `<li class="claim-trace-step" data-kind="specialist">
      <p class="claim-trace-head"><span class="claim-trace-kind">${esc(t("plr.trace.specialist", lang))}</span> ${modelsHtml([sp.model])}</p>
      <p class="claim-trace-outcome">${verdict}${agrees}</p>
      ${omittedIf(sp, lang)}
    </li>`;
}

function verdictHtml(entry, lang, verdictLabel) {
  const v = entry.verdict && typeof entry.verdict === "object" ? entry.verdict : {};
  const flag = FLAGS.includes(v.flag) ? v.flag : "white";
  const conf = flag !== "white" && typeof v.confidence === "number" ? ` · ${esc(formatConfidence(v.confidence))}` : "";
  // The same site name the steps show for that URL (else its host).
  const domains = new Map();
  for (const step of Array.isArray(entry.steps) ? entry.steps : []) {
    for (const s of Array.isArray(step?.sources) ? step.sources : []) {
      if (s?.url && s.domain && !domains.has(s.url)) domains.set(s.url, s.domain);
    }
  }
  const counted = (Array.isArray(v.counted_sources) ? v.counted_sources : [])
    .filter((u) => typeof u === "string" && u)
    .map((u) => `<li>${sourceLink(u, domains.get(u) ?? "")}</li>`)
    .join("");
  return `<li class="claim-trace-step" data-kind="verdict">
      <p class="claim-trace-head"><span class="claim-trace-kind">${esc(t("plr.trace.verdict", lang))}</span></p>
      <p class="claim-trace-outcome">${chip(flag, verdictLabel || flagLabel(flag, v, lang))}${conf}</p>
      ${omittedIf(v, lang)}
      ${counted ? `<p class="claim-trace-label">${esc(t("plr.trace.counted", lang))}</p><ul class="claim-trace-sources">${counted}</ul>` : ""}
    </li>`;
}

/** One claim's trace entry as HTML: extraction, steps, score changes, specialist, verdict. */
// `verdictLabel`: the popup's own verdict label (claimVerdictLabel: a quote's
// or a discussed video's wording), so the chip matches the top of the popup.
export function renderClaimTraceHtml(entry, lang = "en", { verdictLabel = "" } = {}) {
  if (!entry || typeof entry !== "object") return "";
  const steps = (Array.isArray(entry.steps) ? entry.steps : []).map((s) => stepHtml(s, lang)).join("");
  const others = sourcesList(entry.other_sources, lang);
  const othersHtml = others
    ? `<li class="claim-trace-step" data-kind="other_sources"><p class="claim-trace-head"><span class="claim-trace-kind">${esc(
        t("plr.trace.otherSources", lang)
      )}</span></p>${others}</li>`
    : "";
  return `${omittedIf(entry, lang)}<ol class="claim-trace-steps">
      ${extractionHtml(entry, lang)}
      ${steps}
      ${othersHtml}
      ${scoresHtml(entry, lang)}
      ${specialistHtml(entry, lang)}
      ${verdictHtml(entry, lang, verdictLabel)}
    </ol>`;
}

/** The collapsed «Как пришли к вердикту» section of a claim popup (filled by wireTrace). */
export function traceSectionHtml(claim, lang = "en") {
  if (claim?.id == null) return "";
  return `<details class="claim-trace" data-claim-id="${esc(claim.id)}"><summary>${esc(
    t("plr.trace.title", lang)
  )}</summary><div class="claim-trace-body"></div><button type="button" class="claim-trace-download" data-action="trace-download">${esc(
    t("plr.trace.download", lang)
  )}</button></details>`;
}

function message(key, lang) {
  return `<p class="claim-trace-message">${esc(t(key, lang))}</p>`;
}

function download(doc, trace, runId) {
  const blob = new Blob([JSON.stringify(trace, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.setAttribute("download", `skeptium-trace-${runId}.json`);
  a.hidden = true;
  doc.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Some browsers start the download after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Wire the popup's trace section (if any): lazy load on open, the download button. */
export function wireTrace(container, { runId, fetchImpl, lang = "en", verdictLabel = "" } = {}) {
  const details = container?.querySelector?.(".claim-trace");
  if (!details || typeof fetchImpl !== "function" || runId == null) return;
  const body = details.querySelector(".claim-trace-body");
  const button = details.querySelector("[data-action='trace-download']");
  const doc = container.ownerDocument ?? document;
  let filled = false;

  function show(trace) {
    if (trace === null) {
      body.innerHTML = message("plr.trace.unavailable", lang);
      if (button) button.hidden = true;
      return;
    }
    if (button) button.hidden = false;
    const entry = claimTrace(trace, details.dataset.claimId);
    body.innerHTML = entry ? renderClaimTraceHtml(entry, lang, { verdictLabel }) : message("plr.trace.noClaim", lang);
    filled = true;
  }

  details.addEventListener("toggle", () => {
    if (!details.open || filled) return;
    body.innerHTML = message("plr.trace.loading", lang);
    loadTrace(fetchImpl, runId).then((trace) => {
      if (!filled) show(trace);
    });
  });

  button?.addEventListener("click", (event) => {
    event.preventDefault();
    loadTrace(fetchImpl, runId).then((trace) => {
      if (trace === null) {
        show(null);
        return;
      }
      download(doc, trace, runId);
    });
  });
}
