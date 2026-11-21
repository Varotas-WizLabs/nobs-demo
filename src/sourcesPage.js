// web/src/sourcesPage.js
//
// «Индекс источников» (web/sources.html): every site the fact-checks used,
// how often, in which roles, how often what it said held up, and a 0-100
// score (backend: nobs.sources, /sources API). Local app: live from the API.
// Public demo (html[data-demo="1"]): a read-only snapshot, data/sources.json.
//
// The score is shown for reading only: it never decides a verdict.

import { EVIDENCE_LABELS, renderSpecialistSection } from "./specialist.js?v=78dbe39118";
import { renderTrustRow } from "./trustPage.js?v=78dbe39118";
import { tf, tl, topicLabel } from "./stringsSources.js?v=78dbe39118";
import { t } from "./i18n.js?v=78dbe39118";

// The weight of a corroboration / contradiction by the evidence behind it
// (claims about research only; backend nobs.sources.evidence).
export const EVIDENCE_WEIGHTS = {
  systematic_review: 1.5,
  guideline: 1.3,
  rct: 1.3,
  cohort_observational: 1.0,
  official_data: 1.0,
  primary_document: 1.0,
  case_report: 0.7,
  animal_in_vitro: 0.6,
  reference: 0.6,
  expert_opinion: 0.5,
  news_retelling: 0.5,
  preprint: 0.4,
  other: 0.8,
};

export const KINDS = ["primary_document", "official_data", "peer_reviewed", "news", "reference", "other", "low"];

// Labels of data values, in the interface language at draw time.
export const kindLabel = (k) => tl(`srcui.kind.${k}`, k);
export const confidenceLabel = (k) => tl(`srcui.conf.${k}`, k);
export const roleLabel = (k) => tl(`srcui.role.${k}`, undefined);
export const outcomeLabel = (k) => tl(`srcui.outcome.${k}`, k);
export const flagLabel = (k) => tl(`srcui.flag.${k}`, undefined);
export const evidenceLabel = (k) => tl(`srcui.evidence.${k}`, EVIDENCE_LABELS[k] ?? k);

function levelsText(counts) {
  const entries = Object.entries(counts ?? {});
  if (!entries.length) return "—";
  return entries.map(([k, n]) => `${evidenceLabel(k)} ${n}`).join(", ");
}

/** The evidence breakdown of a card (nobs.sources.scorecard). */
export function renderEvidence(doc, card) {
  const bd = card?.evidence_breakdown;
  if (!bd || typeof bd !== "object") return null;
  const box = el(doc, "div", { class: "nobs-src-evidence" });
  box.append(el(doc, "h3", { text: t("srcui.ev.title", "ru") }));
  const dl = el(doc, "dl", { class: "nobs-src-counts" });
  const pairs = [
    [t("srcui.ev.own", "ru"), levelsText(bd.own)],
    [t("srcui.ev.corroboratedBy", "ru"), levelsText(bd.corroborated_by)],
    [t("srcui.ev.contradictedBy", "ru"), levelsText(bd.contradicted_by)],
    [t("srcui.ev.weights", "ru"), `${bd.weight_corroborated ?? 0} / ${bd.weight_contradicted ?? 0}`],
    [t("srcui.ev.liveReconstructed", "ru"), `${bd.live_uses ?? 0} / ${bd.reconstructed_uses ?? 0}`],
    [t("srcui.ev.researchUses", "ru"), bd.research_uses ?? 0],
  ];
  for (const [k, v] of pairs) dl.append(el(doc, "dt", { text: k }), el(doc, "dd", { text: String(v) }));
  box.append(dl);
  return box;
}

export const COLUMNS = [
  { key: "domain", numeric: false },
  { key: "kind", numeric: false },
  { key: "tier", numeric: true },
  { key: "uses", numeric: true },
  { key: "videos", numeric: true },
  { key: "score", numeric: true },
  { key: "confidence", numeric: false },
  { key: "top_topics", numeric: false, sortable: false },
];

const columnLabel = (col) => t(`srcui.col.${col.key}`, "ru");

const CONFIDENCE_ORDER = { insufficient: 0, low: 1, medium: 2, high: 3 };

/** Sort rows by a column (stable; ties by domain). */
export function sortRows(rows, key, dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  const value = (r) => (key === "confidence" ? CONFIDENCE_ORDER[r.confidence] ?? -1 : r[key]);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === vb) return String(a.domain).localeCompare(String(b.domain));
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
    return String(va ?? "").localeCompare(String(vb ?? "")) * sign;
  });
}

/** Keep rows matching the text filter (domain), kind, tier and confidence. */
export function filterRows(rows, { q = "", kind = "", tier = "", scoredOnly = false } = {}) {
  const needle = q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!needle || String(r.domain).includes(needle)) &&
      (!kind || r.kind === kind) &&
      (!tier || String(r.tier) === String(tier)) &&
      (!scoredOnly || r.confidence !== "insufficient"),
  );
}

function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

function scoreCell(doc, row) {
  const insufficient = row.confidence === "insufficient";
  const wrap = el(doc, "span", { class: `nobs-src-score${insufficient ? " is-faint" : ""}` });
  wrap.append(el(doc, "span", { class: "nobs-src-score-num", text: Math.round(row.score) }));
  const bar = el(doc, "span", { class: "nobs-src-bar", "aria-hidden": "true" });
  const fill = el(doc, "span", { class: "nobs-src-bar-fill" });
  fill.style.width = `${Math.max(0, Math.min(100, row.score))}%`;
  bar.append(fill);
  wrap.append(bar);
  wrap.title = tf("srcui.scoreTitle", { low: Math.round(row.low), high: Math.round(row.high), evidence: row.evidence });
  return wrap;
}

function topicsText(row) {
  return (row.top_topics ?? []).map((tp) => `${topicLabel(tp.topic, tp.label)} (${tp.uses})`).join(", ");
}

export function renderTable(doc, rows, { sortKey, sortDir, onSort, onPick }) {
  const table = el(doc, "table", { class: "nobs-src-table" });
  const head = el(doc, "tr");
  for (const col of COLUMNS) {
    const th = el(doc, "th", { scope: "col", class: col.numeric ? "is-num" : "" });
    if (col.sortable === false) {
      th.textContent = columnLabel(col);
    } else {
      const btn = el(doc, "button", { type: "button", class: "nobs-src-sort", "data-key": col.key, text: columnLabel(col) });
      if (col.key === sortKey) {
        th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
        btn.textContent = `${columnLabel(col)} ${sortDir === "asc" ? "↑" : "↓"}`;
      }
      btn.addEventListener("click", () => onSort(col.key));
      th.append(btn);
    }
    head.append(th);
  }
  table.append(el(doc, "thead", {}, head));
  const body = el(doc, "tbody");
  for (const row of rows) {
    const tr = el(doc, "tr", { "data-id": row.id, tabindex: "0" });
    const link = el(doc, "button", { type: "button", class: "nobs-src-domain", text: row.domain });
    link.addEventListener("click", () => onPick(row.id));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onPick(row.id);
    });
    tr.append(
      el(doc, "td", {}, link),
      el(doc, "td", { text: kindLabel(row.kind) }),
      el(doc, "td", { class: "is-num", text: row.tier }),
      el(doc, "td", { class: "is-num", text: row.uses }),
      el(doc, "td", { class: "is-num", text: row.videos }),
      el(doc, "td", { class: "is-num" }, scoreCell(doc, row)),
      el(doc, "td", { class: `nobs-src-conf is-${row.confidence}`, text: confidenceLabel(row.confidence) }),
      el(doc, "td", { class: "nobs-src-topics", text: topicsText(row) }),
    );
    body.append(tr);
  }
  table.append(body);
  return table;
}

function counts(doc, card) {
  const dl = el(doc, "dl", { class: "nobs-src-counts" });
  const pairs = [
    [t("srcui.c.uses", "ru"), card.uses],
    [t("srcui.c.videos", "ru"), card.videos],
    [t("srcui.c.roles", "ru"), `${card.supports} / ${card.refutes} / ${card.context}`],
    [t("srcui.c.corroborated", "ru"), card.corroborated],
    [t("srcui.c.contradicted", "ru"), card.contradicted],
    [t("srcui.c.distorted", "ru"), card.distorted],
    [t("srcui.c.corrected", "ru"), card.corrected],
    [t("srcui.c.unchecked", "ru"), card.unchecked],
    [t("srcui.c.score", "ru"), `${Math.round(card.score)} (${Math.round(card.low)}–${Math.round(card.high)})`],
    [t("srcui.c.confidence", "ru"), tf("srcui.c.confidenceValue", { conf: confidenceLabel(card.confidence), evidence: card.evidence })],
    [t("srcui.c.trend", "ru"), `${card.trend > 0 ? "+" : ""}${card.trend}`],
  ];
  for (const [k, v] of pairs) dl.append(el(doc, "dt", { text: k }), el(doc, "dd", { text: String(v) }));
  return dl;
}

export function renderDetail(doc, detail) {
  const box = el(doc, "section", { class: "nobs-src-detail", "aria-label": tf("srcui.detail.aria", { domain: detail.source.domain }) });
  const s = detail.source;
  box.append(
    el(doc, "h2", { text: s.domain }),
    el(doc, "p", {
      class: "nobs-src-meta",
      text: [
        kindLabel(s.kind),
        tf("srcui.detail.tier", { tier: s.tier }),
        s.owner_group ? tf("srcui.detail.owner", { v: s.owner_group }) : null,
        s.country ? tf("srcui.detail.country", { v: s.country }) : null,
        s.language ? tf("srcui.detail.language", { v: s.language }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }),
  );
  if (detail.overall) {
    box.append(counts(doc, detail.overall));
    const ev = renderEvidence(doc, detail.overall);
    if (ev) box.append(ev);
  }
  if (detail.topics?.length) {
    box.append(el(doc, "h3", { text: t("srcui.detail.byTopic", "ru") }));
    const topicTable = el(doc, "table", { class: "nobs-src-table nobs-src-topic-table" });
    topicTable.append(
      el(
        doc,
        "thead",
        {},
        el(doc, "tr", {}, ...["topic", "uses", "corroborated", "contradicted", "score", "confidence"].map((h) => el(doc, "th", { text: t(`srcui.th.${h}`, "ru") }))),
      ),
    );
    const tb = el(doc, "tbody");
    for (const c of detail.topics) {
      tb.append(
        el(
          doc,
          "tr",
          {},
          el(doc, "td", { text: topicLabel(c.topic, c.label) }),
          el(doc, "td", { class: "is-num", text: c.uses }),
          el(doc, "td", { class: "is-num", text: c.corroborated }),
          el(doc, "td", { class: "is-num", text: c.contradicted + c.distorted }),
          el(doc, "td", { class: "is-num", text: Math.round(c.score) }),
          el(doc, "td", { text: confidenceLabel(c.confidence) }),
        ),
      );
    }
    topicTable.append(tb);
    box.append(topicTable);
  }
  box.append(el(doc, "h3", { text: t("srcui.detail.events", "ru") }));
  if (detail.events?.length) {
    const ul = el(doc, "ul", { class: "nobs-src-events" });
    for (const e of detail.events) {
      ul.append(el(doc, "li", { text: `${e.delta > 0 ? "+" : ""}${e.delta} → ${e.score_after}: ${e.reason}` }));
    }
    box.append(ul);
  } else {
    box.append(el(doc, "p", { class: "nobs-src-muted", text: t("srcui.detail.noEvents", "ru") }));
  }
  box.append(el(doc, "h3", { text: t("srcui.detail.recentUses", "ru") }));
  const ul = el(doc, "ul", { class: "nobs-src-uses" });
  for (const u of detail.uses ?? []) {
    const li = el(doc, "li", { class: `is-${u.outcome}` });
    const claim = el(doc, "a", {
      href: `player.html?run_id=${encodeURIComponent(u.run_id)}`,
      target: "_blank",
      rel: "noopener",
      text: u.claim_text,
    });
    li.append(
      el(doc, "span", { class: `nobs-src-flag is-${u.flag}`, text: flagLabel(u.flag) ?? u.flag ?? "" }),
      " ",
      claim,
      el(doc, "div", {
        class: "nobs-src-use-meta",
        text: [
          `${roleLabel(u.stance) ?? roleLabel(u.role) ?? u.role}${u.role_from === "verdict" ? t("srcui.use.byVerdict", "ru") : ""}`,
          `${outcomeLabel(u.outcome)}${u.support_level ? ` (${evidenceLabel(u.support_level)})` : ""}`,
          u.evidence_level ? evidenceLabel(u.evidence_level) : null,
          u.topic ? topicLabel(u.topic, u.topic) : null,
          u.reconstructed === 0 ? (u.via === "specialist" ? t("srcui.use.specialist", "ru") : t("srcui.use.live", "ru")) : null,
          tf("srcui.use.run", { id: u.run_id }),
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    );
    const src = el(doc, "a", { class: "nobs-src-url", href: u.url, target: "_blank", rel: "noopener noreferrer", text: u.url });
    li.append(src);
    ul.append(li);
  }
  box.append(ul);
  return box;
}

/**
 * Mount the page. `fetchImpl` answers /sources, /sources/{id} and
 * /sources/routes; in the demo the whole snapshot is data/sources.json.
 */
export async function mountSourcesPage(root, { fetchImpl = globalThis.fetch, demo } = {}) {
  const doc = root.ownerDocument;
  const isDemo = demo ?? doc.documentElement?.dataset.demo === "1";
  let snapshot = null;
  let trustSnapshot = null;
  // The trust-connector signals of one domain (web/trust.html): live from
  // /trust/signals, in the demo from data/trust.json. Optional.
  const trustOf = async (domain) => {
    if (isDemo) {
      if (!trustSnapshot) {
        const r = await fetchImpl("data/trust.json");
        trustSnapshot = r.ok ? await r.json() : {};
      }
      return trustSnapshot.signals?.[domain] ?? null;
    }
    const r = await fetchImpl(`/trust/signals?domains=${encodeURIComponent(domain)}`);
    if (!r.ok) return null;
    return (await r.json())?.domains?.[domain] ?? null;
  };
  const getJson = async (path) => {
    if (isDemo) {
      if (!snapshot) {
        const r = await fetchImpl("data/sources.json");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        snapshot = await r.json();
      }
      const p = path.split("?")[0];
      if (p === "/sources") return snapshot;
      if (p === "/sources/routes") return snapshot.routes ?? null;
      if (p === "/sources/specialist") return snapshot.specialist ?? null;
      const m = p.match(/^\/sources\/(\d+)$/);
      if (m) return snapshot.details?.[m[1]] ?? null;
      return null;
    }
    const r = await fetchImpl(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  root.textContent = "";
  const status = el(doc, "p", { class: "nobs-src-muted", text: t("srcui.loading", "ru") });
  root.append(status);
  let data;
  try {
    data = await getJson("/sources?limit=5000");
  } catch (err) {
    status.textContent = tf("srcui.loadFailed", { err: err?.message ?? err });
    return { state: null };
  }
  if (!data || !Array.isArray(data.sources)) {
    status.textContent = t("srcui.empty", "ru");
    return { state: null };
  }
  status.remove();
  const state = { sortKey: "uses", sortDir: "desc", q: "", kind: "", tier: "", scoredOnly: false, picked: null };
  const summary = data.summary ?? {};
  root.append(
    el(doc, "p", {
      class: "nobs-src-summary",
      text:
        tf("srcui.summary", { sources: summary.sources ?? data.sources.length, uses: summary.uses ?? "—", scored: summary.scored ?? "—" }) +
        (summary.live_uses
          ? tf("srcui.summaryLive", {
              live: summary.live_uses,
              corroborated: summary.live_outcomes?.corroborated ?? 0,
              contradicted: summary.live_outcomes?.contradicted ?? 0,
              distorted: summary.live_outcomes?.distorted_original ?? 0,
            })
          : "") +
        (isDemo ? t("srcui.demoSnapshot", "ru") : ""),
    }),
    el(doc, "p", { class: "nobs-src-note", text: t("srcui.note", "ru") }),
  );
  const controls = el(doc, "div", { class: "nobs-src-controls" });
  const search = el(doc, "input", { type: "search", placeholder: t("srcui.search", "ru"), "aria-label": t("srcui.search", "ru") });
  const kind = el(doc, "select", { "aria-label": t("srcui.col.kind", "ru") }, el(doc, "option", { value: "", text: t("srcui.allKinds", "ru") }));
  for (const k of KINDS) kind.append(el(doc, "option", { value: k, text: kindLabel(k) }));
  const tier = el(doc, "select", { "aria-label": t("srcui.col.tier", "ru") }, el(doc, "option", { value: "", text: t("srcui.allTiers", "ru") }));
  for (const n of [1, 2, 3, 4]) tier.append(el(doc, "option", { value: String(n), text: tf("srcui.tierN", { n }) }));
  const scored = el(doc, "input", { type: "checkbox", id: "nobs-src-scored" });
  const scoredLabel = el(doc, "label", { for: "nobs-src-scored" }, scored, t("srcui.scoredOnly", "ru"));
  controls.append(search, kind, tier, scoredLabel);
  const tableWrap = el(doc, "div", { class: "nobs-src-table-wrap" });
  const count = el(doc, "p", { class: "nobs-src-muted" });
  const detailWrap = el(doc, "div", { class: "nobs-src-detail-wrap" });
  root.append(controls, count, tableWrap, detailWrap);

  const pick = async (id) => {
    state.picked = id;
    detailWrap.textContent = "";
    detailWrap.append(el(doc, "p", { class: "nobs-src-muted", text: t("srcui.loading", "ru") }));
    try {
      const detail = await getJson(`/sources/${id}`);
      detailWrap.textContent = "";
      if (!detail) {
        detailWrap.append(el(doc, "p", { class: "nobs-src-muted", text: t("srcui.noDetail", "ru") }));
        return;
      }
      const view = renderDetail(doc, detail);
      detailWrap.append(view);
      view.scrollIntoView?.({ behavior: "smooth", block: "start" });
      try {
        const row = renderTrustRow(doc, await trustOf(detail.source.domain));
        if (row) view.querySelector(".nobs-src-meta")?.after(row);
      } catch {
        // the trust signals are optional
      }
    } catch (err) {
      detailWrap.textContent = tf("srcui.failed", { err: err?.message ?? err });
    }
  };
  const draw = () => {
    const rows = sortRows(filterRows(data.sources, state), state.sortKey, state.sortDir);
    count.textContent = tf("srcui.shown", { shown: Math.min(rows.length, 1000), total: rows.length });
    tableWrap.textContent = "";
    tableWrap.append(
      renderTable(doc, rows.slice(0, 1000), {
        sortKey: state.sortKey,
        sortDir: state.sortDir,
        onSort: (key) => {
          if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          else {
            state.sortKey = key;
            state.sortDir = key === "domain" || key === "kind" || key === "tier" ? "asc" : "desc";
          }
          draw();
        },
        onPick: pick,
      }),
    );
  };
  search.addEventListener("input", () => {
    state.q = search.value;
    draw();
  });
  kind.addEventListener("change", () => {
    state.kind = kind.value;
    draw();
  });
  tier.addEventListener("change", () => {
    state.tier = tier.value;
    draw();
  });
  scored.addEventListener("change", () => {
    state.scoredOnly = scored.checked;
    draw();
  });
  draw();

  // Topic routing (shadow mode): what the claims are about.
  try {
    const routes = await getJson("/sources/routes");
    if (routes?.topics?.length) {
      const sec = el(doc, "section", { class: "nobs-src-routes" });
      sec.append(
        el(doc, "h2", { text: t("srcui.routes.title", "ru") }),
        el(doc, "p", {
          class: "nobs-src-muted",
          text: tf("srcui.routes.text", { claims: routes.claims, cost: routes.jev_cost_usd, ms: routes.jev_latency_ms_avg }),
        }),
      );
      const ul = el(doc, "ul", { class: "nobs-src-topic-list" });
      for (const tp of routes.topics) ul.append(el(doc, "li", { text: `${topicLabel(tp.id, tp.label)}: ${tp.claims}` }));
      sec.append(ul);
      root.append(sec);
    }
  } catch {
    // routes are optional
  }
  // The specialist's second opinions (shadow mode), disagreements first.
  try {
    const sp = await getJson("/sources/specialist");
    if (sp && Array.isArray(sp.opinions)) root.append(renderSpecialistSection(doc, sp));
  } catch {
    // optional
  }
  return { state, pick, draw };
}
