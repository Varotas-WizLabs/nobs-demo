// web/src/trustPage.js
//
// «Сигналы доверия» (web/trust.html): every connector NOBS checks a source
// against -- ours and external, free and paid, active and only planned --
// with whose judgement it is, its licence and known bias, and the owner's
// switch whether it may move the score's prior (backend:
// nobs.sources.connectors, /trust API). Local app: live, with toggles,
// weights and «Синхронизировать». Public demo (html[data-demo="1"]): a
// read-only snapshot, data/trust.json.
//
// Anti-bias rules (shown on the page): signals are listed per connector and
// never silently merged; external ones are OFF until enabled; only the prior
// moves, capped; popularity never counts as reliability; disagreement is
// flagged and widens the prior; verdicts are never touched.

export const KIND_LABELS = {
  internal: "Наши данные",
  free_list: "Бесплатные списки",
  free_api: "Бесплатные API (по запросу)",
  keyed_api: "Нужен ключ",
  paid: "Платные",
};

export const STATUS_LABELS = {
  active: "активен",
  needs_key: "нужен ключ",
  candidate: "кандидат",
  paid_not_subscribed: "платный — нет подписки",
  disabled: "отключён",
};

export const MEASURE_LABELS = {
  reliability: "надёжность",
  misinformation_flag: "флаг дезинформации",
  popularity: "популярность (не надёжность)",
  domain_age: "возраст домена",
  fact_checks: "фактчеки",
  safety: "безопасность (фишинг, вредоносное ПО)",
  scholarly_index: "научный индекс",
  retraction: "отзыв статей",
  bias: "политический крен (не надёжность)",
  traffic_seo: "трафик / SEO (не надёжность)",
};

// Short names for the compact chips of the sources page.
export const SHORT_NAMES = {
  nobs_registry: "NOBS",
  wp_rsp: "WP:RSP",
  iffy: "Iffy.news",
  lin2023: "Lin 2023",
  tranco: "Tranco",
  wayback_age: "Wayback",
  google_factcheck: "Fact Check",
  google_safebrowsing: "Safe Browsing",
};

const KIND_ORDER = ["internal", "free_list", "free_api", "keyed_api", "paid"];

export const RULES = [
  "Каждый коннектор показан отдельной строкой; ничего не сливается молча.",
  "Внешние коннекторы по умолчанию НЕ влияют на оценку — только после включения здесь.",
  "Включённые коннекторы сдвигают только исходную оценку (приор) источника, но не вердикт утверждения.",
  "Вклад ограничен: все внешние вместе — не больше силы исходной оценки уровня, одно суждение — не больше трети приора; наши собственные проверки быстро перевешивают.",
  "Коннекторы, несущие одно и то же суждение (Iffy и Lin 2023 оба включают MBFC), делят одну треть на двоих — одно мнение не входит дважды.",
  "Включённый коннектор действует, только пока он активен: если синхронизацию заблокировали или пропал ключ, он перестаёт влиять на оценку.",
  "Популярность (Tranco) никогда не считается надёжностью: она может только ослабить приор для неизвестных доменов, не сдвигая среднее.",
  "Если рейтинги внешних коннекторов расходятся (разброс ≥ 0.4), домен помечается, а их вклад уменьшается вдвое. Расхождение с нашей собственной оценкой только помечается и в приор не идёт.",
  "Одинаковые правила для всех доменов; отсутствие в «чёрном списке» не считается плюсом; «нет данных» — это не середина.",
];

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

function fmtDate(iso) {
  if (!iso) return "—";
  return String(iso).replace("T", " ").slice(0, 16);
}

function safeHref(url) {
  const u = String(url ?? "");
  return /^https?:\/\//.test(u) || /^[a-z]+\.html(#.*)?$/.test(u) ? u : null;
}

/** Group connectors by kind in the fixed order. */
export function groupByKind(connectors) {
  const groups = new Map(KIND_ORDER.map((k) => [k, []]));
  for (const c of connectors ?? []) {
    if (!groups.has(c.kind)) groups.set(c.kind, []);
    groups.get(c.kind).push(c);
  }
  return [...groups.entries()].filter(([, list]) => list.length);
}

/** Can the owner switch this connector into the prior right now? */
export function canToggle(c) {
  return Boolean(c.can_enable) && c.status === "active";
}

/** One connector card. `editable`: the local app (not the demo). */
export function renderConnector(doc, c, { editable = false, onChange, onSync } = {}) {
  const card = el(doc, "article", { class: `nobs-trust-card is-${c.status}`, "data-id": c.id });
  const head = el(doc, "div", { class: "nobs-trust-card-head" });
  const href = safeHref(c.url);
  head.append(
    href ? el(doc, "a", { class: "nobs-trust-name", href, target: "_blank", rel: "noopener noreferrer", text: c.name }) : el(doc, "span", { class: "nobs-trust-name", text: c.name }),
    el(doc, "span", { class: `nobs-trust-chip is-${c.status}`, text: STATUS_LABELS[c.status] ?? c.status }),
    el(doc, "span", { class: `nobs-trust-chip is-measure${c.in_prior ? "" : " is-faint"}`, text: MEASURE_LABELS[c.measures] ?? c.measures }),
  );
  if (c.kind !== "internal") {
    const on = Boolean(c.enabled);
    // Enabled but not active (sync blocked, key gone): it does not count.
    const counts = on && c.in_effect !== false;
    head.append(el(doc, "span", {
      class: `nobs-trust-chip ${counts ? "is-on" : "is-off"}`,
      text: counts ? `влияет на приор, вес ${Number(c.weight).toFixed(2)}` : on ? "включён, но не действует: коннектор не активен" : "не влияет на оценку",
    }));
  }
  card.append(head);
  const dl = el(doc, "dl", { class: "nobs-src-counts nobs-trust-facts" });
  const sync = c.sync;
  const pairs = [
    ["Покрытие", c.coverage],
    ["Доменов в базе", c.kind === "internal" ? `${c.domains} источников с оценкой` : c.domains ? `${c.domains}${c.registry_hits != null ? ` (из них наших источников: ${c.registry_hits})` : ""}` : "—"],
    ["Последняя синхронизация", sync ? `${fmtDate(sync.synced_at)}${sync.status && sync.status !== "ok" ? ` — ${sync.status}: ${sync.message ?? ""}` : ""}` : c.syncable ? "ещё не синхронизирован" : "—"],
    ["Чьё суждение", c.judgement],
    ["Известные перекосы", c.bias],
    ["Лицензия", c.license],
    ["Атрибуция", c.attribution],
    ["Обновление", c.cadence],
  ];
  if (c.key_env?.length) {
    pairs.push(["Ключ (.env)", `${c.key_env.join(" или ")}${c.key_present === true ? " — задан" : c.key_present === false ? " — не задан" : ""}`]);
  }
  if (c.would_add) pairs.push(["Что добавит", c.would_add]);
  if (c.notes) pairs.push(["Заметка", c.notes]);
  for (const [k, v] of pairs) if (v) dl.append(el(doc, "dt", { text: k }), el(doc, "dd", { text: String(v) }));
  card.append(dl);

  if (editable && c.kind !== "internal") {
    const controls = el(doc, "div", { class: "nobs-trust-controls" });
    if (c.can_enable) {
      const id = `nobs-trust-en-${c.id}`;
      const box = el(doc, "input", { type: "checkbox", id, name: "enabled", checked: Boolean(c.enabled), disabled: !canToggle(c) });
      const label = el(doc, "label", { for: id }, box, " влияет на оценку (приор)");
      const range = el(doc, "input", { type: "range", min: "0", max: "1", step: "0.05", value: String(c.weight ?? 0.5), name: "weight", "aria-label": `Вес: ${c.name}` });
      const out = el(doc, "output", { text: Number(c.weight ?? 0.5).toFixed(2) });
      range.addEventListener("input", () => {
        out.textContent = Number(range.value).toFixed(2);
      });
      range.addEventListener("change", () => onChange?.(c.id, { weight: Number(range.value) }));
      box.addEventListener("change", () => onChange?.(c.id, { enabled: box.checked }));
      controls.append(label, el(doc, "span", { class: "nobs-trust-weight" }, "вес ", range, " ", out));
      if (!canToggle(c)) controls.append(el(doc, "small", { class: "nobs-src-muted", text: "Включить можно только активный коннектор." }));
    } else {
      controls.append(el(doc, "small", { class: "nobs-src-muted", text: c.in_prior ? "" : "Не влияет на оценку надёжности по своей природе — только показ." }));
    }
    if (c.syncable) {
      const btn = el(doc, "button", { type: "button", class: "nobs-trust-sync", text: "Синхронизировать" });
      btn.addEventListener("click", () => onSync?.(c.id, btn));
      controls.append(btn);
    }
    card.append(controls);
  }
  return card;
}

/** The connectors whose reliability value is far (>= 0.2) from the median
 * of the others: marked in the lookup when the domain is disagreeing. */
export function outliers(view) {
  const vals = (view?.rows ?? [])
    .filter((r) => r.signal && typeof r.signal.norm === "number")
    .map((r) => [r.connector, r.signal.norm]);
  if (vals.length < 2 || !view.disagreement) return new Set();
  const sorted = vals.map(([, v]) => v).sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const out = new Set();
  for (const [id, v] of vals) if (Math.abs(v - mid) >= 0.2) out.add(id);
  if (!out.size) {
    // two values: both are the disagreement
    for (const [id] of vals) out.add(id);
  }
  return out;
}

/** The per-domain view: every connector side by side + the prior. */
export function renderLookup(doc, view, { editable = false, onLazy } = {}) {
  const box = el(doc, "section", { class: "nobs-trust-lookup-result", "aria-label": `Сигналы для ${view.domain}` });
  box.append(el(doc, "h3", { text: view.domain }));
  if (view.disagreement) {
    // "halved": the external connectors that count disagree among
    // themselves; a split only against our own score is shown, never applied.
    const tail = view.prior?.halved ? " Внешний вклад в приор уменьшен вдвое." : "";
    box.append(el(doc, "p", { class: "nobs-trust-disagree", role: "note", text: `Рейтинги расходятся (разброс ${view.span}).${tail}` }));
  }
  const odd = outliers(view);
  const table = el(doc, "table", { class: "nobs-src-table nobs-trust-table" });
  table.append(el(doc, "thead", {}, el(doc, "tr", {}, ...["Коннектор", "Что измеряет", "Значение", "Норм. 0–1", "В оценке", ""].map((h) => el(doc, "th", { text: h })))));
  const tb = el(doc, "tbody");
  for (const r of view.rows ?? []) {
    const sig = r.signal;
    const tr = el(doc, "tr", { class: `${sig ? "" : "is-empty"}${odd.has(r.connector) ? " is-outlier" : ""}`.trim() || null, "data-connector": r.connector });
    const link = sig && safeHref(sig.url);
    const action = el(doc, "td");
    if (link) action.append(el(doc, "a", { href: link, target: "_blank", rel: "noopener noreferrer", text: "источник" }));
    if (editable && r.connector === "wayback_age" && onLazy) {
      const b = el(doc, "button", { type: "button", class: "nobs-trust-lazy", text: sig ? "обновить" : "проверить" });
      b.addEventListener("click", () => onLazy(r.connector, view.domain, b));
      action.append(" ", b);
    }
    tr.append(
      el(doc, "td", { text: r.name }),
      el(doc, "td", { text: MEASURE_LABELS[r.measures] ?? r.measures }),
      el(doc, "td", { text: sig ? sig.label : r.status === "needs_key" ? "нужен ключ" : "нет данных" }),
      el(doc, "td", { class: "is-num", text: sig && typeof sig.norm === "number" ? sig.norm.toFixed(2) : "—" }),
      el(doc, "td", { text: r.kind === "internal" ? "это и есть оценка" : !r.in_prior ? "нет (по природе)" : r.enabled ? `да, вес ${Number(r.weight).toFixed(2)}` : "нет (выключен)" }),
      action,
    );
    tb.append(tr);
  }
  table.append(tb);
  box.append(el(doc, "div", { class: "nobs-src-table-wrap nobs-trust-table-wrap" }, table));
  const p = view.prior;
  if (p) {
    const parts = (p.parts ?? []).filter((x) => x.pseudo > 0);
    const lines = [`Исходная оценка уровня ${p.tier}: ${p.tier_mean} → с включёнными коннекторами: ${p.mean}${p.changed ? "" : " (без изменений)"}`];
    for (const x of parts) lines.push(`${x.connector}: значение ${x.norm.toFixed(2)}, ${x.pseudo} псевдонаблюдений, доля приора ${Math.round(x.share * 100)}%`);
    if (p.popularity_scaled) lines.push("Нет в Tranco top-1M: сила приора ×0.75 (среднее не меняется).");
    const ul = el(doc, "ul", { class: "nobs-trust-prior" });
    for (const l of lines) ul.append(el(doc, "li", { text: l }));
    box.append(el(doc, "h4", { text: "Приор оценки этого домена" }), ul);
  }
  return box;
}

/** The compact row of connector chips for a domain (the sources page card). */
export function renderTrustRow(doc, entry) {
  if (!entry) return null;
  const box = el(doc, "div", { class: "nobs-trust-row" });
  box.append(el(doc, "h3", {}, "Сигналы доверия ", el(doc, "a", { href: "trust.html", class: "nobs-trust-more", text: "(все коннекторы)" })));
  const signals = (entry.signals ?? []).filter((s) => s.connector !== "nobs_registry");
  if (!signals.length) {
    box.append(el(doc, "p", { class: "nobs-src-muted", text: "Внешних данных об этом домене нет (это не середина шкалы, а «не знаем»)." }));
    return box;
  }
  const ul = el(doc, "ul", { class: "nobs-trust-chips" });
  for (const s of signals) {
    const li = el(doc, "li", { class: `nobs-trust-chip${s.enabled ? " is-on" : ""}`, title: `${MEASURE_LABELS[s.measures] ?? s.measures}${s.enabled ? " · влияет на приор" : " · не влияет на оценку"}` });
    li.append(el(doc, "b", { text: SHORT_NAMES[s.connector] ?? s.name }), `: ${s.label}`);
    ul.append(li);
  }
  box.append(ul);
  if (entry.disagreement) box.append(el(doc, "p", { class: "nobs-trust-disagree", text: `Рейтинги расходятся (разброс ${entry.span}).` }));
  return box;
}

/**
 * Mount the page. `fetchImpl` answers /trust/*; in the demo the whole
 * snapshot is data/trust.json and nothing can be changed.
 */
export async function mountTrustPage(root, { fetchImpl = globalThis.fetch, demo } = {}) {
  const doc = root.ownerDocument;
  const isDemo = demo ?? doc.documentElement?.dataset.demo === "1";
  let snapshot = null;
  const loadSnapshot = async () => {
    if (!snapshot) {
      const r = await fetchImpl("data/trust.json");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      snapshot = await r.json();
    }
    return snapshot;
  };
  const getJson = async (path) => {
    if (isDemo) {
      const snap = await loadSnapshot();
      const [p, q] = path.split("?");
      if (p === "/trust/connectors") return snap;
      if (p === "/trust/lookup") return snap.lookups?.[new URLSearchParams(q).get("domain")?.trim().toLowerCase().replace(/^www\./, "")] ?? null;
      return null;
    }
    const r = await fetchImpl(path);
    if (r.status === 422) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  const send = async (path, method, body) => {
    const r = await fetchImpl(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.detail ?? `HTTP ${r.status}`);
    return data;
  };

  root.textContent = "";
  const status = el(doc, "p", { class: "nobs-src-muted", text: "Загрузка…" });
  root.append(status);
  let data;
  try {
    data = await getJson("/trust/connectors");
  } catch (err) {
    status.textContent = `Не удалось загрузить коннекторы: ${err?.message ?? err}`;
    return { state: null };
  }
  if (data?.unavailable) {
    // build_demo.py could not export the snapshot (server without /trust).
    status.textContent = "В этой сборке демо снимка сигналов доверия нет.";
    return { state: null };
  }
  status.remove();
  const summaryEl = el(doc, "p", { class: "nobs-src-summary" });
  const message = el(doc, "p", { class: "nobs-trust-message", role: "status", "aria-live": "polite" });
  const rules = el(doc, "ul", { class: "nobs-src-note nobs-trust-rules" });
  for (const r of RULES) rules.append(el(doc, "li", { text: r }));

  // The domain lookup box.
  const lookupSec = el(doc, "section", { class: "nobs-trust-lookup" });
  const form = el(doc, "form", { class: "nobs-src-controls", role: "search" });
  const input = el(doc, "input", { type: "search", placeholder: "Домен, например meduza.io", "aria-label": "Домен", name: "domain", list: isDemo ? "nobs-trust-domains" : null });
  const go = el(doc, "button", { type: "submit", text: "Показать сигналы" });
  form.append(input, go);
  const result = el(doc, "div", { class: "nobs-trust-lookup-wrap" });
  lookupSec.append(el(doc, "h2", { text: "Сигналы для домена" }), form);
  if (isDemo) {
    const dl = el(doc, "datalist", { id: "nobs-trust-domains" });
    for (const d of Object.keys((await loadSnapshot()).lookups ?? {}).sort()) dl.append(el(doc, "option", { value: d }));
    lookupSec.append(dl, el(doc, "p", { class: "nobs-src-muted", text: "В демо — только домены из индекса источников этого снимка." }));
  }
  lookupSec.append(result);

  const list = el(doc, "div", { class: "nobs-trust-list" });
  root.append(summaryEl, el(doc, "h2", { text: "Правила против перекоса" }), rules, message, lookupSec, el(doc, "h2", { text: "Коннекторы" }), list);

  const showLookup = async (domain) => {
    const d = String(domain ?? "").trim();
    if (!d) return;
    result.textContent = "";
    result.append(el(doc, "p", { class: "nobs-src-muted", text: "Загрузка…" }));
    try {
      const view = await getJson(`/trust/lookup?domain=${encodeURIComponent(d)}`);
      result.textContent = "";
      if (!view) {
        result.append(el(doc, "p", { class: "nobs-src-muted", text: isDemo ? "Этого домена нет в снимке демо." : "Это не похоже на домен." }));
        return;
      }
      result.append(renderLookup(doc, view, { editable: !isDemo, onLazy: lazy }));
    } catch (err) {
      result.textContent = `Не удалось: ${err?.message ?? err}`;
    }
  };
  const lazy = async (cid, domain, btn) => {
    btn.disabled = true;
    try {
      await send(`/trust/lookup/${encodeURIComponent(cid)}?domain=${encodeURIComponent(domain)}`, "POST");
      await showLookup(domain);
    } catch (err) {
      message.textContent = `Запрос не удался: ${err?.message ?? err}`;
      btn.disabled = false;
    }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    showLookup(input.value);
  });

  const draw = () => {
    const s = data.summary ?? {};
    const by = s.by_status ?? {};
    summaryEl.textContent =
      `Коннекторов: ${s.connectors ?? data.connectors?.length ?? 0} — активных ${by.active ?? 0}, нужен ключ ${by.needs_key ?? 0}, кандидатов ${by.candidate ?? 0}, платных без подписки ${by.paid_not_subscribed ?? 0}` +
      `${by.disabled ? `, отключённых ${by.disabled}` : ""}; сигналов в базе: ${s.signals ?? "—"}; влияют на оценку: ${s.enabled?.length ? s.enabled.join(", ") : "ни один (по умолчанию)"}` +
      `${isDemo ? " · снимок для демо, только чтение" : ""}`;
    list.textContent = "";
    for (const [kind, items] of groupByKind(data.connectors)) {
      const sec = el(doc, "section", { class: "nobs-trust-group" });
      sec.append(el(doc, "h3", { text: KIND_LABELS[kind] ?? kind }));
      for (const c of items) sec.append(renderConnector(doc, c, { editable: !isDemo, onChange: change, onSync: sync }));
      list.append(sec);
    }
  };
  const reload = async () => {
    data = await getJson("/trust/connectors");
    draw();
  };
  const change = async (cid, patch) => {
    message.textContent = "Сохраняю и пересчитываю оценки…";
    try {
      const r = await send(`/trust/connectors/${encodeURIComponent(cid)}`, "PUT", patch);
      message.textContent = `Сохранено. Пересчитано источников: ${r.rescored?.sources ?? "—"}, с изменённым приором: ${r.rescored?.external_priors ?? 0}.`;
    } catch (err) {
      message.textContent = `Не сохранено: ${err?.message ?? err}`;
    }
    await reload().catch(() => {});
  };
  const sync = async (cid, btn) => {
    btn.disabled = true;
    message.textContent = `Синхронизация ${cid}…`;
    try {
      const r = await send(`/trust/connectors/${encodeURIComponent(cid)}/sync`, "POST");
      message.textContent = r.status === "ok" ? `Готово: ${r.domains} доменов.` : `Не удалось (${r.status}): ${r.message ?? ""}`;
    } catch (err) {
      message.textContent = `Не удалось: ${err?.message ?? err}`;
    }
    await reload().catch(() => {});
  };
  draw();
  const initial = new URLSearchParams(doc.defaultView?.location?.search ?? "").get("domain");
  if (initial) {
    input.value = initial;
    await showLookup(initial);
  }
  return { draw, showLookup, get data() { return data; } };
}
