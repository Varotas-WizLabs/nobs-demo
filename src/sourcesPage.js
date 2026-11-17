// web/src/sourcesPage.js
//
// «Индекс источников» (web/sources.html): every site the fact-checks used,
// how often, in which roles, how often what it said held up, and a 0-100
// score (backend: nobs.sources, /sources API). Local app: live from the API.
// Public demo (html[data-demo="1"]): a read-only snapshot, data/sources.json.
//
// The score is shown for reading only: it never decides a verdict.

import { EVIDENCE_LABELS, renderSpecialistSection } from "./specialist.js?v=99de0217ce";

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

export const KIND_LABELS = {
  primary_document: "первоисточник",
  official_data: "офиц. данные",
  peer_reviewed: "научная статья",
  news: "СМИ",
  reference: "справочник",
  other: "прочее",
  low: "низкое качество",
};

export const CONFIDENCE_LABELS = {
  insufficient: "мало данных",
  low: "низкая",
  medium: "средняя",
  high: "высокая",
};

export const ROLE_LABELS = { supports: "подтверждает", refutes: "опровергает", context: "контекст" };

export const STANCE_LABELS = { ...ROLE_LABELS, speaker_source: "источник спикера" };

function levelsText(counts) {
  const entries = Object.entries(counts ?? {});
  if (!entries.length) return "—";
  return entries.map(([k, n]) => `${EVIDENCE_LABELS[k] ?? k} ${n}`).join(", ");
}

/** The evidence breakdown of a card (nobs.sources.scorecard). */
export function renderEvidence(doc, card) {
  const bd = card?.evidence_breakdown;
  if (!bd || typeof bd !== "object") return null;
  const box = el(doc, "div", { class: "nobs-src-evidence" });
  box.append(el(doc, "h3", { text: "Уровень доказательств" }));
  const dl = el(doc, "dl", { class: "nobs-src-counts" });
  const pairs = [
    ["Сам источник (по использованиям)", levelsText(bd.own)],
    ["Чем подтверждался", levelsText(bd.corroborated_by)],
    ["Чем опровергался / искажения", levelsText(bd.contradicted_by)],
    ["Вес подтверждений / опровержений", `${bd.weight_corroborated ?? 0} / ${bd.weight_contradicted ?? 0}`],
    ["Живые записи / восстановленные", `${bd.live_uses ?? 0} / ${bd.reconstructed_uses ?? 0}`],
    ["Использований в научных утверждениях", bd.research_uses ?? 0],
  ];
  for (const [k, v] of pairs) dl.append(el(doc, "dt", { text: k }), el(doc, "dd", { text: String(v) }));
  box.append(dl);
  return box;
}

export const OUTCOME_LABELS = {
  corroborated: "подтвердилось",
  contradicted: "опровергнуто",
  distorted_original: "искажённый оригинал",
  corrected_later: "исправлено позже",
  unchecked: "не проверено",
};

export const FLAG_LABELS = { green: "верно", yellow: "неточно", red: "неверно", white: "не проверить" };

export const COLUMNS = [
  { key: "domain", label: "Источник", numeric: false },
  { key: "kind", label: "Тип", numeric: false },
  { key: "tier", label: "Уровень", numeric: true },
  { key: "uses", label: "Использований", numeric: true },
  { key: "videos", label: "Видео", numeric: true },
  { key: "score", label: "Оценка", numeric: true },
  { key: "confidence", label: "Уверенность", numeric: false },
  { key: "top_topics", label: "Темы", numeric: false, sortable: false },
];

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
  wrap.title = `90% интервал ${Math.round(row.low)}–${Math.round(row.high)}; доказательность ${row.evidence}`;
  return wrap;
}

function topicsText(row) {
  return (row.top_topics ?? []).map((t) => `${t.label || t.topic} (${t.uses})`).join(", ");
}

export function renderTable(doc, rows, { sortKey, sortDir, onSort, onPick }) {
  const table = el(doc, "table", { class: "nobs-src-table" });
  const head = el(doc, "tr");
  for (const col of COLUMNS) {
    const th = el(doc, "th", { scope: "col", class: col.numeric ? "is-num" : "" });
    if (col.sortable === false) {
      th.textContent = col.label;
    } else {
      const btn = el(doc, "button", { type: "button", class: "nobs-src-sort", "data-key": col.key, text: col.label });
      if (col.key === sortKey) {
        th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
        btn.textContent = `${col.label} ${sortDir === "asc" ? "↑" : "↓"}`;
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
      el(doc, "td", { text: KIND_LABELS[row.kind] ?? row.kind }),
      el(doc, "td", { class: "is-num", text: row.tier }),
      el(doc, "td", { class: "is-num", text: row.uses }),
      el(doc, "td", { class: "is-num", text: row.videos }),
      el(doc, "td", { class: "is-num" }, scoreCell(doc, row)),
      el(doc, "td", { class: `nobs-src-conf is-${row.confidence}`, text: CONFIDENCE_LABELS[row.confidence] ?? row.confidence }),
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
    ["Использований", card.uses],
    ["Видео", card.videos],
    ["Подтверждает / опровергает / контекст", `${card.supports} / ${card.refutes} / ${card.context}`],
    ["Подтвердилось", card.corroborated],
    ["Опровергнуто", card.contradicted],
    ["Искажённый оригинал", card.distorted],
    ["Исправлено позже", card.corrected],
    ["Не проверено", card.unchecked],
    ["Оценка (90% интервал)", `${Math.round(card.score)} (${Math.round(card.low)}–${Math.round(card.high)})`],
    ["Уверенность", `${CONFIDENCE_LABELS[card.confidence] ?? card.confidence} (доказательность ${card.evidence})`],
    ["Тренд (последние 10 проверок)", `${card.trend > 0 ? "+" : ""}${card.trend}`],
  ];
  for (const [k, v] of pairs) dl.append(el(doc, "dt", { text: k }), el(doc, "dd", { text: String(v) }));
  return dl;
}

export function renderDetail(doc, detail) {
  const box = el(doc, "section", { class: "nobs-src-detail", "aria-label": `Источник ${detail.source.domain}` });
  const s = detail.source;
  box.append(
    el(doc, "h2", { text: s.domain }),
    el(doc, "p", {
      class: "nobs-src-meta",
      text: [
        KIND_LABELS[s.kind] ?? s.kind,
        `уровень ${s.tier}`,
        s.owner_group ? `владелец: ${s.owner_group}` : null,
        s.country ? `страна: ${s.country}` : null,
        s.language ? `язык: ${s.language}` : null,
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
    box.append(el(doc, "h3", { text: "По темам" }));
    const t = el(doc, "table", { class: "nobs-src-table nobs-src-topic-table" });
    t.append(
      el(
        doc,
        "thead",
        {},
        el(doc, "tr", {}, ...["Тема", "Исп.", "Подтв.", "Опров.", "Оценка", "Уверенность"].map((h) => el(doc, "th", { text: h }))),
      ),
    );
    const tb = el(doc, "tbody");
    for (const c of detail.topics) {
      tb.append(
        el(
          doc,
          "tr",
          {},
          el(doc, "td", { text: c.label || c.topic }),
          el(doc, "td", { class: "is-num", text: c.uses }),
          el(doc, "td", { class: "is-num", text: c.corroborated }),
          el(doc, "td", { class: "is-num", text: c.contradicted + c.distorted }),
          el(doc, "td", { class: "is-num", text: Math.round(c.score) }),
          el(doc, "td", { text: CONFIDENCE_LABELS[c.confidence] ?? c.confidence }),
        ),
      );
    }
    t.append(tb);
    box.append(t);
  }
  box.append(el(doc, "h3", { text: "Что сильнее всего меняло оценку" }));
  if (detail.events?.length) {
    const ul = el(doc, "ul", { class: "nobs-src-events" });
    for (const e of detail.events) {
      ul.append(el(doc, "li", { text: `${e.delta > 0 ? "+" : ""}${e.delta} → ${e.score_after}: ${e.reason}` }));
    }
    box.append(ul);
  } else {
    box.append(el(doc, "p", { class: "nobs-src-muted", text: "Пока ни одной проверенной ссылки: оценка равна исходной для уровня." }));
  }
  box.append(el(doc, "h3", { text: "Последние использования" }));
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
      el(doc, "span", { class: `nobs-src-flag is-${u.flag}`, text: FLAG_LABELS[u.flag] ?? u.flag ?? "" }),
      " ",
      claim,
      el(doc, "div", {
        class: "nobs-src-use-meta",
        text: [
          `${STANCE_LABELS[u.stance] ?? ROLE_LABELS[u.role] ?? u.role}${u.role_from === "verdict" ? " (по вердикту)" : ""}`,
          `${OUTCOME_LABELS[u.outcome] ?? u.outcome}${u.support_level ? ` (${EVIDENCE_LABELS[u.support_level] ?? u.support_level})` : ""}`,
          u.evidence_level ? EVIDENCE_LABELS[u.evidence_level] ?? u.evidence_level : null,
          u.topic || null,
          u.reconstructed === 0 ? (u.via === "specialist" ? "запись специалиста" : "живая запись") : null,
          `прогон ${u.run_id}`,
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

const NOTE =
  "Оценка — апостериорное Beta-распределение с исходной оценкой по уровню источника (1: 90, 2: 75, 3: 50, 4: 33). " +
  "Новые проверки записывают все открытые источники с позицией (подтверждает / опровергает / контекст / источник спикера): " +
  "источник «подтвердился», если то же говорит независимый источник другого владельца; «опровергнут», если более сильный " +
  "или равный независимый источник говорит обратное; «искажённый оригинал» — если он неверно пересказывает исследование, на которое ссылается. " +
  "Исходы старых проверок восстановлены эвристикой по итоговому вердикту, поэтому их оценки завышены. " +
  "В научных утверждениях подтверждение весит по уровню доказательств: обзор/метаанализ 1.5, РКИ 1.3, когортное 1.0, " +
  "описание случая 0.7, пересказ в СМИ или мнение 0.5, препринт 0.4. Оценка никогда не решает вердикт.";

/**
 * Mount the page. `fetchImpl` answers /sources, /sources/{id} and
 * /sources/routes; in the demo the whole snapshot is data/sources.json.
 */
export async function mountSourcesPage(root, { fetchImpl = globalThis.fetch, demo } = {}) {
  const doc = root.ownerDocument;
  const isDemo = demo ?? doc.documentElement?.dataset.demo === "1";
  let snapshot = null;
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
  const status = el(doc, "p", { class: "nobs-src-muted", text: "Загрузка…" });
  root.append(status);
  let data;
  try {
    data = await getJson("/sources?limit=5000");
  } catch (err) {
    status.textContent = `Не удалось загрузить индекс: ${err?.message ?? err}`;
    return { state: null };
  }
  if (!data || !Array.isArray(data.sources)) {
    status.textContent = "Индекс источников пока пуст.";
    return { state: null };
  }
  status.remove();
  const state = { sortKey: "uses", sortDir: "desc", q: "", kind: "", tier: "", scoredOnly: false, picked: null };
  const summary = data.summary ?? {};
  root.append(
    el(doc, "p", {
      class: "nobs-src-summary",
      text: `Источников: ${summary.sources ?? data.sources.length}; использований: ${summary.uses ?? "—"}; с оценкой (достаточно данных): ${summary.scored ?? "—"}${summary.live_uses ? `; живых записей: ${summary.live_uses} (подтвердилось ${summary.live_outcomes?.corroborated ?? 0}, опровергнуто ${summary.live_outcomes?.contradicted ?? 0}, искажений ${summary.live_outcomes?.distorted_original ?? 0})` : ""}${isDemo ? " · снимок для демо" : ""}`,
    }),
    el(doc, "p", { class: "nobs-src-note", text: NOTE }),
  );
  const controls = el(doc, "div", { class: "nobs-src-controls" });
  const search = el(doc, "input", { type: "search", placeholder: "Поиск по домену", "aria-label": "Поиск по домену" });
  const kind = el(doc, "select", { "aria-label": "Тип" }, el(doc, "option", { value: "", text: "Все типы" }));
  for (const [k, v] of Object.entries(KIND_LABELS)) kind.append(el(doc, "option", { value: k, text: v }));
  const tier = el(doc, "select", { "aria-label": "Уровень" }, el(doc, "option", { value: "", text: "Все уровни" }));
  for (const t of [1, 2, 3, 4]) tier.append(el(doc, "option", { value: String(t), text: `Уровень ${t}` }));
  const scored = el(doc, "input", { type: "checkbox", id: "nobs-src-scored" });
  const scoredLabel = el(doc, "label", { for: "nobs-src-scored" }, scored, " только с оценкой");
  controls.append(search, kind, tier, scoredLabel);
  const tableWrap = el(doc, "div", { class: "nobs-src-table-wrap" });
  const count = el(doc, "p", { class: "nobs-src-muted" });
  const detailWrap = el(doc, "div", { class: "nobs-src-detail-wrap" });
  root.append(controls, count, tableWrap, detailWrap);

  const pick = async (id) => {
    state.picked = id;
    detailWrap.textContent = "";
    detailWrap.append(el(doc, "p", { class: "nobs-src-muted", text: "Загрузка…" }));
    try {
      const detail = await getJson(`/sources/${id}`);
      detailWrap.textContent = "";
      if (!detail) {
        detailWrap.append(el(doc, "p", { class: "nobs-src-muted", text: "Подробностей нет в этом снимке." }));
        return;
      }
      const view = renderDetail(doc, detail);
      detailWrap.append(view);
      view.scrollIntoView?.({ behavior: "smooth", block: "start" });
    } catch (err) {
      detailWrap.textContent = `Не удалось загрузить: ${err?.message ?? err}`;
    }
  };
  const draw = () => {
    const rows = sortRows(filterRows(data.sources, state), state.sortKey, state.sortDir);
    count.textContent = `Показано: ${Math.min(rows.length, 1000)} из ${rows.length}`;
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
        el(doc, "h2", { text: "Темы утверждений (маршрутизация, теневой режим)" }),
        el(doc, "p", {
          class: "nobs-src-muted",
          text: `Классифицировано утверждений: ${routes.claims}; Jev: $${routes.jev_cost_usd}, в среднем ${routes.jev_latency_ms_avg} мс на утверждение. Проверка пока не использует темы.`,
        }),
      );
      const ul = el(doc, "ul", { class: "nobs-src-topic-list" });
      for (const t of routes.topics) ul.append(el(doc, "li", { text: `${t.label}: ${t.claims}` }));
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
