// web/src/scoopList.js
//
// The «Скупы» tab of the right-hand panel: the scoops of the run's latest
// scoop generation (GET /runs/{id}/scoops). A scoop is a non-obvious
// connection in the material that changes how it reads (docs/methodology/
// scoop.md). Each card: title, the scoop sentence, three bars (sharpness,
// interest, non-obviousness, 0–10) and the 0–100 strength with its band, a
// confidence chip kept apart from the strength, type and status chips, the
// verified quotes with timecodes (this video: seek; the discussed video:
// link), and a details block (surface → what was dug up → hidden
// connection → new reading; statistics as numerator / denominator;
// alternative explanation and counterexample; refutation outcome).
// Also: the generation's state (running / none found / failed), the
// hypotheses and the audience / agenda / persona map (collapsed), and a
// totals line (passes, time, cost, models). DOM APIs and textContent only.

import { formatTimecode } from "./claimSync.js?v=922fa24595";
import { labelLanguage, t } from "./i18n.js?v=922fa24595";
import { formatCost, formatDuration, modelLabel } from "./runStats.js?v=922fa24595";
import { seekTarget } from "./settings.js?v=922fa24595";

/**
 * Play `player` from a scoop anchor at `sec`, the seek lead-in earlier
 * (setting "seekLeadSec", as for claims and timeline markers).
 */
export function seekToAnchor(player, sec) {
  player.seekTo(seekTarget(sec), true);
  player.playVideo();
}

const AXES = [
  ["sharp", "scoop.axis.sharp"],
  ["interesting", "scoop.axis.interesting"],
  ["nonobvious", "scoop.axis.nonobvious"],
];
const SUBSCORES = ["R", "N", "S", "G", "E"];

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** t() with {name} placeholders. */
export function tf(key, lang, vars = {}) {
  return t(key, lang).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Decimal comma for Russian: 6.1 -> "6,1". */
export function formatScore(value, lang, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  const text = value.toFixed(digits).replace(/\.0+$/, "");
  return String(labelLanguage(lang) ?? "").toLowerCase().startsWith("ru") ? text.replace(".", ",") : text;
}

/** The scoops a response shows (complete generation only). */
export function shownScoops(response) {
  return response?.scoop_run?.status === "complete" ? (response.scoops ?? []) : [];
}

/** Scoops by strength (rank, then total) or by the first place in this video. */
export function sortScoops(scoops, mode = "strength") {
  const list = [...(scoops ?? [])];
  if (mode === "time") {
    return list.sort((a, b) => firstSec(a) - firstSec(b));
  }
  return list.sort(
    (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.scores?.total_0_100 ?? 0) - (a.scores?.total_0_100 ?? 0)
  );
}

function firstSec(scoop) {
  if (typeof scoop.first_sec === "number") return scoop.first_sec;
  const own = (scoop.anchors ?? []).filter((a) => a.video !== "source" && typeof a.start_sec === "number");
  return own.length ? Math.min(...own.map((a) => a.start_sec)) : Number.POSITIVE_INFINITY;
}

/**
 * The anchors to show: verified only, one per place (the merge can repeat a
 * place with a longer quote; the longer one stays), this video first, each
 * group in time order.
 */
export function scoopAnchors(scoop) {
  const byPlace = new Map();
  for (const anchor of scoop.anchors ?? []) {
    if (anchor.verified === false || typeof anchor.start_sec !== "number") continue;
    const key = `${anchor.run_id}:${anchor.unit ?? ""}:${Math.round(anchor.start_sec)}`;
    const prev = byPlace.get(key);
    if (!prev || String(anchor.quote ?? "").length > String(prev.quote ?? "").length) byPlace.set(key, anchor);
  }
  const all = [...byPlace.values()];
  const own = all.filter((a) => a.video !== "source").sort((a, b) => a.start_sec - b.start_sec);
  const source = all.filter((a) => a.video === "source").sort((a, b) => a.run_id - b.run_id || a.start_sec - b.start_sec);
  return [...own, ...source];
}

/** "Рассмотрено кандидатов: 22 — ниже порога силы 6, …" from the summary. */
export function rejectedSummary(summary, lang) {
  if (!summary || !summary.candidates) return "";
  const groups = new Map();
  for (const [code, count] of Object.entries(summary.reasons ?? {})) {
    const key = reasonKey(code);
    groups.set(key, (groups.get(key) ?? 0) + count);
  }
  const parts = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${t(`scoop.reason.${key}`, lang)}: ${count}`);
  const head = tf("scoop.considered", lang, { n: summary.candidates });
  return parts.length ? `${head} — ${parts.join(", ")}` : head;
}

function reasonKey(code) {
  const c = String(code);
  if (c.startsWith("dup:")) return "dup";
  if (c.startsWith("bar:total")) return "total";
  if (c.startsWith("bar:N")) return "N";
  if (c.startsWith("bar:G")) return "G";
  if (c.startsWith("bar:low_confidence")) return "low_confidence";
  if (c.includes("collapses")) return "collapses";
  if (c.startsWith("G5")) return "retelling";
  if (c.startsWith("G1")) return "anchor";
  if (c.startsWith("G3")) return "number";
  if (/^G(4|7|11)/.test(c)) return "caution";
  return "other";
}

/** "10 проходов · 4m52s · $2.54 · Sonnet $1.42, Fable 5.2 $1.12" ('' if nothing is known). */
export function formatScoopTotals(response, lang) {
  const totals = response?.scoop_run?.totals ?? {};
  const parts = [];
  const passes = (response?.pass_stats ?? []).length;
  if (passes) parts.push(`${passes} ${t("scoop.passes", lang)}`);
  const duration = formatDuration(typeof totals.wall_ms === "number" ? totals.wall_ms / 1000 : null);
  if (duration) parts.push(duration);
  const cost = formatCost(totals.cost_usd);
  if (cost) parts.push(cost);
  const models = Object.entries(totals.by_model ?? {})
    .filter(([, v]) => typeof v?.cost_usd === "number")
    .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
    .map(([name, v]) => `${aliasLabel(name)} ${formatCost(v.cost_usd)}`);
  if (models.length) parts.push(models.join(", "));
  return parts.join(" · ");
}

function aliasLabel(name) {
  const label = modelLabel(name);
  return label === name ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/** One line per pass while a generation runs: "scoop.micro — 28s, $0.14". */
function passLine(stat) {
  const name = String(stat.stage ?? "").replace(/^scoop\./, "");
  const bits = [formatDuration((stat.wall_ms ?? 0) / 1000)];
  if (stat.cost_usd) bits.push(formatCost(stat.cost_usd));
  return `${name} — ${bits.filter(Boolean).join(", ")}`;
}

/**
 * Render the tab into `root`. Returns { highlight(timeSec) } (marks the
 * anchors playing now, and their cards).
 *
 * @param {HTMLElement} root
 * @param {object} run       the complete run (GET /runs/{id})
 * @param {object} response  GET /runs/{id}/scoops
 * @param {{onSeek: (sec: number) => void, lang?: string,
 *   onRegenerate?: () => void, onSelectClaim?: (claim: object) => void,
 *   status?: object}} options
 *   `status` is GET /scoop-runs/{id}/status while a generation runs.
 */
export function renderScoopList(root, run, response, { onSeek, lang: langOption, onRegenerate, onSelectClaim, status } = {}) {
  const doc = root.ownerDocument;
  const lang = langOption ?? run?.caption_language ?? "en";
  const section = el(doc, "section", "nobs-scoops");
  section.lang = lang;
  const anchorButtons = [];
  let sortMode = "strength";

  const header = el(doc, "div", "nobs-scoops-header");
  header.appendChild(el(doc, "h2", "nobs-claims-title", t("scoop.title", lang)));
  section.appendChild(header);

  const scoops = shownScoops(response);
  const hypotheses = response?.scoop_run?.status === "complete" ? (response.hypotheses ?? []) : [];
  const active = response?.active ?? null;
  const claimsById = new Map((run?.claims ?? []).map((c) => [c.id, c]));

  const body = el(doc, "div", "nobs-scoops-body");
  section.appendChild(body);

  if (active) {
    const box = el(doc, "div", "nobs-scoops-state");
    box.dataset.state = "running";
    box.appendChild(el(doc, "p", "nobs-scoops-running", t("scoop.running", lang)));
    const lines = el(doc, "ul", "nobs-scoops-passes");
    for (const stat of status?.pass_stats ?? []) lines.appendChild(el(doc, "li", null, passLine(stat)));
    box.appendChild(lines);
    body.appendChild(box);
  } else if (response?.last_failed && !scoops.length) {
    const box = el(doc, "div", "nobs-scoops-state");
    box.dataset.state = "failed";
    box.appendChild(el(doc, "p", "nobs-scoops-failed", t("scoop.failed", lang)));
    if (response.last_failed.error) box.appendChild(el(doc, "p", "nobs-scoops-note", response.last_failed.error));
    if (onRegenerate) box.appendChild(actionButton(doc, t("scoop.retry", lang), onRegenerate));
    body.appendChild(box);
  } else if (!response?.scoop_run) {
    const box = el(doc, "div", "nobs-scoops-state");
    box.dataset.state = "empty";
    box.appendChild(el(doc, "p", "nobs-scoops-intro", t("scoop.intro", lang)));
    if (onRegenerate) {
      box.appendChild(actionButton(doc, t("scoop.generate", lang), onRegenerate));
      box.appendChild(el(doc, "p", "nobs-scoops-note", t("scoop.estimate", lang)));
    }
    body.appendChild(box);
  } else if (!scoops.length) {
    const box = el(doc, "div", "nobs-scoops-state");
    box.dataset.state = "none";
    box.appendChild(el(doc, "p", "nobs-scoops-none", t("scoop.none", lang)));
    const why = rejectedSummary(response.scoop_run.summary, lang);
    if (why) box.appendChild(el(doc, "p", "nobs-scoops-note", why));
    body.appendChild(box);
  }

  if (scoops.length) {
    header.appendChild(el(doc, "p", "nobs-scoops-intro", t("scoop.intro", lang)));
    const sorts = el(doc, "div", "nobs-claims-filters nobs-scoops-sort");
    for (const mode of ["strength", "time"]) {
      const chip = el(doc, "button", "nobs-claims-chip", t(`scoop.sort.${mode}`, lang));
      chip.type = "button";
      chip.dataset.sort = mode;
      chip.setAttribute("aria-pressed", String(mode === sortMode));
      chip.addEventListener("click", () => {
        sortMode = mode;
        for (const c of sorts.children) c.setAttribute("aria-pressed", String(c.dataset.sort === sortMode));
        drawCards();
      });
      sorts.appendChild(chip);
    }
    header.appendChild(sorts);
  }

  const list = el(doc, "ol", "nobs-scoops-list");
  body.appendChild(list);
  const cards = new Map();
  for (const scoop of scoops) cards.set(scoop, renderCard(scoop, false));
  function drawCards() {
    list.replaceChildren(...sortScoops(scoops, sortMode).map((s) => cards.get(s)));
  }
  drawCards();

  if (hypotheses.length) {
    const fold = el(doc, "details", "nobs-scoops-fold");
    fold.dataset.fold = "hypotheses";
    fold.appendChild(el(doc, "summary", null, `${t("scoop.hypotheses", lang)} ${hypotheses.length}`));
    const hList = el(doc, "ol", "nobs-scoops-list");
    for (const h of hypotheses) hList.appendChild(renderCard(h, true));
    fold.appendChild(hList);
    body.appendChild(fold);
  }

  const aap = renderAap(response?.aap_map);
  if (aap && scoops.length + hypotheses.length) body.appendChild(aap);

  if (response?.scoop_run) {
    const foot = el(doc, "div", "nobs-scoops-foot");
    foot.appendChild(el(doc, "p", "nobs-scoops-disclaimer", t("scoop.disclaimer", lang)));
    const totals = formatScoopTotals(response, lang);
    if (totals) foot.appendChild(el(doc, "p", "nobs-scoops-totals", totals));
    if (onRegenerate && !active) foot.appendChild(actionButton(doc, t("scoop.regenerate", lang), onRegenerate, "nobs-scoops-link"));
    body.appendChild(foot);
  }

  root.replaceChildren(section);

  // Compact card (owner, 2026-11-17): title, the scoop in a few sentences,
  // a small score indicator and the first timecode. The bars, chips, anchors
  // and the step-by-step evidence are no longer shown on the card.
  function renderCard(scoop, isHypothesis) {
    const item = el(doc, "li", "nobs-scoop nobs-scoop-compact");
    item.dataset.scoopId = String(scoop.id);
    if (isHypothesis) item.dataset.hypothesis = "true";
    const scores = scoop.scores ?? {};
    const total = Number(scores.total_0_100) || 0;

    const head = el(doc, "div", "nobs-scoop-head");
    const anchors = scoopAnchors(scoop);
    const first = anchors.find((x) => x.video !== "source");
    if (first) {
      const time = el(doc, "button", "nobs-scoop-time", formatTimecode(first.start_sec));
      time.type = "button";
      time.dataset.sec = String(first.start_sec);
      time.setAttribute("aria-label", `${t("scoop.seek", lang)} ${formatTimecode(first.start_sec)}`);
      time.addEventListener("click", () => onSeek?.(first.start_sec));
      head.appendChild(time);
      anchorButtons.push({ anchor: first, button: time, card: item });
    }
    head.appendChild(el(doc, "h3", "nobs-scoop-title", scoop.title ?? ""));
    // Small score indicator: a ring filled to the total (0–100).
    const meter = el(doc, "span", "nobs-scoop-score");
    meter.setAttribute("role", "meter");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", String(Math.round(total)));
    const label = `${t("scoop.total", lang)}: ${formatScore(total, lang, 0)}/100${isHypothesis ? ` · ${t("scoop.status.hypothesis", lang)}` : ""}`;
    meter.setAttribute("aria-label", label);
    meter.title = label;
    meter.style.setProperty("--score", String(Math.max(0, Math.min(100, total))));
    meter.appendChild(el(doc, "span", "nobs-scoop-score-num", formatScore(total, lang, 0)));
    head.appendChild(meter);
    item.appendChild(head);

    item.appendChild(el(doc, "p", "nobs-scoop-text", scoop.scoop ?? ""));
    return item;
  }

  function renderAnchor(anchor, card) {
    const li = el(doc, "li", "nobs-scoop-anchor");
    const quote = `«${String(anchor.quote ?? "").trim()}»`;
    if (anchor.video === "source") {
      li.dataset.video = "source";
      const isReview = anchor.other_role === "review";
      if (isReview) li.dataset.role = "review";
      const link = el(doc, "a", "nobs-scoop-anchor-link");
      link.href = /^https:\/\/(www\.)?youtube\.com\//.test(String(anchor.watch_url ?? ""))
        ? anchor.watch_url
        : `https://www.youtube.com/watch?v=${encodeURIComponent(anchor.video_id ?? "")}&t=${Math.floor(anchor.start_sec)}s`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.appendChild(el(doc, "span", "nobs-scoop-anchor-time", formatTimecode(anchor.start_sec)));
      link.appendChild(el(doc, "span", "nobs-scoop-anchor-quote", quote));
      li.appendChild(link);
      const meta = el(doc, "span", "nobs-scoop-anchor-source", t(isReview ? "scoop.reviewVideo" : "scoop.sourceVideo", lang));
      li.appendChild(meta);
      if (anchor.run_id != null) {
        const runLink = el(doc, "a", "nobs-scoop-anchor-run", t("scoop.sourceRun", lang));
        runLink.href = `player.html?run_id=${encodeURIComponent(anchor.run_id)}`;
        li.appendChild(doc.createTextNode(" · "));
        li.appendChild(runLink);
      }
      return li;
    }
    const button = el(doc, "button", "nobs-scoop-anchor-seek");
    button.type = "button";
    button.dataset.sec = String(anchor.start_sec);
    button.setAttribute("aria-label", `${t("scoop.seek", lang)} ${formatTimecode(anchor.start_sec)}: ${quote}`);
    button.appendChild(el(doc, "span", "nobs-scoop-anchor-time", formatTimecode(anchor.start_sec)));
    button.appendChild(el(doc, "span", "nobs-scoop-anchor-quote", quote));
    button.addEventListener("click", () => onSeek?.(anchor.start_sec));
    li.appendChild(button);
    anchorButtons.push({ anchor, button, card });
    return li;
  }

  function renderDetails(scoop, anchors, isHypothesis) {
    const details = el(doc, "details", "nobs-scoop-details");
    details.appendChild(el(doc, "summary", null, t("scoop.details", lang)));
    const add = (label, text) => {
      if (!String(text ?? "").trim()) return;
      const block = el(doc, "div", "nobs-scoop-step");
      block.appendChild(el(doc, "h4", null, label));
      block.appendChild(el(doc, "p", null, text));
      details.appendChild(block);
      return block;
    };
    add(t("scoop.surface", lang), scoop.surface);

    // What was dug up: the quotes (all found in the captions) and the
    // fact-check verdicts of the same places.
    const dug = el(doc, "div", "nobs-scoop-step");
    dug.appendChild(el(doc, "h4", null, t("scoop.dug", lang)));
    dug.appendChild(el(doc, "p", null, tf("scoop.anchorsCount", lang, { n: anchors.length })));
    const verdicts = (scoop.context ?? []).filter((c) => c.kind === "verdict");
    if (verdicts.length) {
      dug.appendChild(el(doc, "p", "nobs-scoop-sublabel", t("scoop.verdicts", lang)));
      const ul = el(doc, "ul", "nobs-scoop-verdicts");
      for (const v of verdicts) {
        const li = el(doc, "li");
        const dot = el(doc, "span", "nobs-claims-dot");
        dot.dataset.flag = v.flag ?? "white";
        li.appendChild(dot);
        const claim = claimsById.get(v.claim_id);
        if (claim && v.run_id === run?.run_id && onSelectClaim) {
          const b = el(doc, "button", "nobs-scoop-verdict", `${formatTimecode(claim.start_sec)} ${v.text ?? ""}`);
          b.type = "button";
          b.addEventListener("click", () => onSelectClaim(claim));
          li.appendChild(b);
        } else {
          li.appendChild(el(doc, "span", "nobs-scoop-verdict", v.text ?? ""));
        }
        ul.appendChild(li);
      }
      dug.appendChild(ul);
    }
    details.appendChild(dug);

    add(t("scoop.link", lang), scoop.link);
    if (scoop.reframe && (scoop.reframe.before || scoop.reframe.after)) {
      const block = el(doc, "div", "nobs-scoop-step nobs-scoop-reframe");
      block.appendChild(el(doc, "h4", null, t("scoop.reframe", lang)));
      for (const key of ["before", "after"]) {
        if (!scoop.reframe[key]) continue;
        const p = el(doc, "p");
        p.dataset.reframe = key;
        p.appendChild(el(doc, "span", "nobs-scoop-sublabel", `${t(`scoop.${key}`, lang)}: `));
        p.appendChild(doc.createTextNode(scoop.reframe[key]));
        block.appendChild(p);
      }
      details.appendChild(block);
    }

    // Merged duplicates whose anchors are about something else (another
    // source, another clip): one line each, kept apart from the evidence.
    const also = [...(scoop.also ?? []), ...(scoop.also_sources ?? []).filter((x) => !(scoop.also ?? []).some((y) => y.title === x.title))];
    if (also.length) {
      const block = el(doc, "div", "nobs-scoop-step nobs-scoop-also");
      block.appendChild(el(doc, "h4", null, t("scoop.also", lang)));
      for (const x of also) block.appendChild(el(doc, "p", "nobs-scoops-note", x.title ?? ""));
      details.appendChild(block);
    }

    const stats = scoop.stats_resolved ?? [];
    if (stats.length) {
      const block = el(doc, "div", "nobs-scoop-step nobs-scoop-stats");
      block.appendChild(el(doc, "h4", null, t("scoop.stats", lang)));
      for (const m of stats) {
        const p = el(doc, "p", "nobs-scoop-stat");
        const count = m.count_text || `${m.numerator} / ${m.denominator}`;
        p.appendChild(el(doc, "strong", "nobs-scoop-stat-count", count));
        p.appendChild(doc.createTextNode(` — ${m.unit ?? ""}`));
        block.appendChild(p);
        const meta = [];
        if (m.method) meta.push(`${t("scoop.method", lang)}: ${m.method}`);
        if (m.limitations?.length) meta.push(`${t("scoop.limits", lang)}: ${m.limitations.join("; ")}`);
        if (meta.length) block.appendChild(el(doc, "p", "nobs-scoops-note", meta.join(" · ")));
        if (m.by_segment?.length) {
          block.appendChild(el(doc, "p", "nobs-scoops-note", m.by_segment.map((s) => `${s.label ?? s.segment ?? ""}: ${s.numerator}/${s.denominator}`).join(" · ")));
        }
      }
      details.appendChild(block);
    }

    add(t("scoop.alternative", lang), scoop.alternative);
    if (scoop.counterexample?.text) {
      const block = add(t("scoop.counterexample", lang), scoop.counterexample.text);
      const a = scoop.counterexample.anchor;
      if (block && a?.verified && typeof a.start_sec === "number" && a.video !== "source") {
        const b = el(doc, "button", "nobs-scoop-anchor-seek");
        b.type = "button";
        b.dataset.sec = String(a.start_sec);
        b.appendChild(el(doc, "span", "nobs-scoop-anchor-time", formatTimecode(a.start_sec)));
        b.appendChild(el(doc, "span", "nobs-scoop-anchor-quote", `«${a.quote ?? ""}»`));
        b.addEventListener("click", () => onSeek?.(a.start_sec));
        block.appendChild(b);
      }
    }

    if (isHypothesis || scoop.directions?.length) {
      if (scoop.directions?.length) {
        const block = el(doc, "div", "nobs-scoop-step");
        block.appendChild(el(doc, "h4", null, t("scoop.directions", lang)));
        const ul = el(doc, "ul");
        for (const d of scoop.directions) ul.appendChild(el(doc, "li", null, d));
        block.appendChild(ul);
        details.appendChild(block);
      }
    }

    // Status, confidence reason, sub-scores and the refutation outcome.
    const status = el(doc, "div", "nobs-scoop-step nobs-scoop-meta");
    status.appendChild(el(doc, "h4", null, t("scoop.statusLabel", lang)));
    const lines = [];
    const statusKey = isHypothesis ? "hypothesis" : scoop.status;
    if (statusKey) lines.push(t(`scoop.status.${statusKey}`, lang));
    if (scoop.confidence?.level) {
      lines.push(`${t("scoop.confidence", lang)}: ${t(`scoop.confidence.${scoop.confidence.level}`, lang)}${scoop.confidence.rule ? ` (${scoop.confidence.rule})` : ""}`);
    }
    status.appendChild(el(doc, "p", null, lines.join(" · ")));
    const sub = scoop.scores?.sub;
    if (sub) {
      status.appendChild(
        el(doc, "p", "nobs-scoop-sub", `${t("scoop.subscores", lang)}: ${SUBSCORES.filter((k) => k in sub).map((k) => `${k} (${t(`scoop.sub.${k}`, lang)}) ${formatScore(sub[k], lang)}`).join(" · ")}`)
      );
    }
    const refute = scoop.refute;
    if (refute?.outcome) {
      const reason = refute.votes?.find((v) => v.reason)?.reason ?? "";
      status.appendChild(el(doc, "p", null, `${t("scoop.refute", lang)}: ${t(`scoop.refute.${refute.outcome}`, lang)}${reason ? ` — ${reason}` : ""}`));
      if (refute.narrowed_from?.scoop) {
        status.appendChild(el(doc, "p", "nobs-scoops-note", `${t("scoop.narrowedFrom", lang)}: ${refute.narrowed_from.scoop}`));
      }
    }
    details.appendChild(status);
    return details;
  }

  function renderAap(map) {
    if (!map) return null;
    const groups = ["audience", "agenda", "persona"].filter((k) => (map[k] ?? []).length);
    if (!groups.length) return null;
    const fold = el(doc, "details", "nobs-scoops-fold");
    fold.dataset.fold = "aap";
    fold.appendChild(el(doc, "summary", null, t("scoop.aap", lang)));
    fold.appendChild(el(doc, "p", "nobs-scoops-note", t("scoop.aapNote", lang)));
    for (const key of groups) {
      const block = el(doc, "div", "nobs-scoop-step");
      block.appendChild(el(doc, "h4", null, t(`scoop.aap.${key}`, lang)));
      const ul = el(doc, "ul");
      for (const entry of map[key]) ul.appendChild(aapEntry(key, entry));
      block.appendChild(ul);
      fold.appendChild(block);
    }
    return fold;
  }

  function aapEntry(key, entry) {
    const li = el(doc, "li", "nobs-scoop-aap");
    const pairs = [];
    if (key === "audience") pairs.push([entry.kind ? t(`scoop.aap.kind.${entry.kind}`, lang) : null, entry.text]);
    else if (key === "agenda") {
      pairs.push([t("scoop.aap.observed", lang), entry.observed_direction]);
      pairs.push([t("scoop.aap.effect", lang), entry.effect]);
      pairs.push([t("scoop.aap.inferred", lang), entry.inferred]);
      pairs.push([t("scoop.aap.declared", lang), entry.declared]);
    } else {
      pairs.push([null, entry.role]);
      pairs.push([t("scoop.aap.mechanism", lang), entry.mechanism ? t(`scoop.aap.mech.${entry.mechanism}`, lang) : ""]);
      pairs.push([t("scoop.aap.authority", lang), entry.authority_source]);
    }
    pairs.push([t("scoop.alternative", lang), entry.alternative]);
    for (const [label, text] of pairs) {
      if (!String(text ?? "").trim()) continue;
      const p = el(doc, "p");
      if (label) p.appendChild(el(doc, "span", "nobs-scoop-sublabel", `${label}: `));
      p.appendChild(doc.createTextNode(text));
      li.appendChild(p);
    }
    return li;
  }

  return {
    highlight(timeSec) {
      const playing = new Set();
      for (const { anchor, button, card } of anchorButtons) {
        const end = typeof anchor.end_sec === "number" ? anchor.end_sec : anchor.start_sec + 5;
        const active = timeSec >= anchor.start_sec && timeSec < end;
        if (active) {
          button.setAttribute("aria-current", "true");
          playing.add(card);
        } else button.removeAttribute("aria-current");
      }
      for (const { card } of anchorButtons) {
        if (playing.has(card)) card.dataset.now = "true";
        else delete card.dataset.now;
      }
    },
  };
}

function actionButton(doc, label, onClick, className = "nobs-scoops-action") {
  const button = el(doc, "button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}
