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

import { t } from "./i18n.js?v=392e705d28";
import { connText, signalLabel, tf, tl } from "./stringsSources.js?v=392e705d28";

// Labels of data values, in the interface language at draw time.
export const kindLabel = (k) => tl(`trustui.kind.${k}`, k);
export const statusLabel = (k) => tl(`trustui.status.${k}`, k);
export const measureLabel = (k) => tl(`trustui.measure.${k}`, k);

// Short names for the compact chips of the sources page.
export const SHORT_NAMES = {
  nobs_registry: "Skeptium",
  wp_rsp: "WP:RSP",
  iffy: "Iffy.news",
  lin2023: "Lin 2023",
  tranco: "Tranco",
  wayback_age: "Wayback",
  google_factcheck: "Fact Check",
  google_safebrowsing: "Safe Browsing",
};

const KIND_ORDER = ["internal", "free_list", "free_api", "keyed_api", "paid"];

/** The anti-bias rules shown on the page. */
export function rules() {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => t(`trustui.rule.${n}`, "ru"));
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
    href ? el(doc, "a", { class: "nobs-trust-name", href, target: "_blank", rel: "noopener noreferrer", text: connText(c, "name") }) : el(doc, "span", { class: "nobs-trust-name", text: connText(c, "name") }),
    el(doc, "span", { class: `nobs-trust-chip is-${c.status}`, text: statusLabel(c.status) }),
    el(doc, "span", { class: `nobs-trust-chip is-measure${c.in_prior ? "" : " is-faint"}`, text: measureLabel(c.measures) }),
  );
  if (c.kind !== "internal") {
    const on = Boolean(c.enabled);
    // Enabled but not active (sync blocked, key gone): it does not count.
    const counts = on && c.in_effect !== false;
    head.append(el(doc, "span", {
      class: `nobs-trust-chip ${counts ? "is-on" : "is-off"}`,
      text: counts ? tf("trustui.inPrior", { w: Number(c.weight).toFixed(2) }) : on ? t("trustui.onNotInEffect", "ru") : t("trustui.notInScore", "ru"),
    }));
  }
  card.append(head);
  const dl = el(doc, "dl", { class: "nobs-src-counts nobs-trust-facts" });
  const sync = c.sync;
  const pairs = [
    [t("trustui.f.coverage", "ru"), connText(c, "coverage")],
    [
      t("trustui.f.domains", "ru"),
      c.kind === "internal"
        ? tf("trustui.f.domainsInternal", { n: c.domains })
        : c.domains
          ? `${c.domains}${c.registry_hits != null ? tf("trustui.f.registryHits", { n: c.registry_hits }) : ""}`
          : "—",
    ],
    [t("trustui.f.lastSync", "ru"), sync ? `${fmtDate(sync.synced_at)}${sync.status && sync.status !== "ok" ? ` — ${sync.status}: ${sync.message ?? ""}` : ""}` : c.syncable ? t("trustui.f.neverSynced", "ru") : "—"],
    [t("trustui.f.judgement", "ru"), connText(c, "judgement")],
    [t("trustui.f.bias", "ru"), connText(c, "bias")],
    [t("trustui.f.license", "ru"), connText(c, "license")],
    [t("trustui.f.attribution", "ru"), connText(c, "attribution")],
    [t("trustui.f.cadence", "ru"), connText(c, "cadence")],
  ];
  if (c.key_env?.length) {
    pairs.push([
      t("trustui.f.key", "ru"),
      `${c.key_env.join(t("trustui.f.keyOr", "ru"))}${c.key_present === true ? t("trustui.f.keySet", "ru") : c.key_present === false ? t("trustui.f.keyUnset", "ru") : ""}`,
    ]);
  }
  if (c.would_add) pairs.push([t("trustui.f.wouldAdd", "ru"), connText(c, "would_add")]);
  if (c.notes) pairs.push([t("trustui.f.notes", "ru"), connText(c, "notes")]);
  for (const [k, v] of pairs) if (v) dl.append(el(doc, "dt", { text: k }), el(doc, "dd", { text: String(v) }));
  card.append(dl);

  if (editable && c.kind !== "internal") {
    const controls = el(doc, "div", { class: "nobs-trust-controls" });
    if (c.can_enable) {
      const id = `nobs-trust-en-${c.id}`;
      const box = el(doc, "input", { type: "checkbox", id, name: "enabled", checked: Boolean(c.enabled), disabled: !canToggle(c) });
      const label = el(doc, "label", { for: id }, box, t("trustui.toggle", "ru"));
      const range = el(doc, "input", { type: "range", min: "0", max: "1", step: "0.05", value: String(c.weight ?? 0.5), name: "weight", "aria-label": tf("trustui.weightAria", { name: connText(c, "name") }) });
      const out = el(doc, "output", { text: Number(c.weight ?? 0.5).toFixed(2) });
      range.addEventListener("input", () => {
        out.textContent = Number(range.value).toFixed(2);
      });
      range.addEventListener("change", () => onChange?.(c.id, { weight: Number(range.value) }));
      box.addEventListener("change", () => onChange?.(c.id, { enabled: box.checked }));
      controls.append(label, el(doc, "span", { class: "nobs-trust-weight" }, t("trustui.weight", "ru"), range, " ", out));
      if (!canToggle(c)) controls.append(el(doc, "small", { class: "nobs-src-muted", text: t("trustui.onlyActive", "ru") }));
    } else {
      controls.append(el(doc, "small", { class: "nobs-src-muted", text: c.in_prior ? "" : t("trustui.displayOnly", "ru") }));
    }
    if (c.syncable) {
      const btn = el(doc, "button", { type: "button", class: "nobs-trust-sync", text: t("trustui.sync", "ru") });
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
  const box = el(doc, "section", { class: "nobs-trust-lookup-result", "aria-label": tf("trustui.lookupAria", { domain: view.domain }) });
  box.append(el(doc, "h3", { text: view.domain }));
  if (view.disagreement) {
    // "halved": the external connectors that count disagree among
    // themselves; a split only against our own score is shown, never applied.
    const tail = view.prior?.halved ? t("trustui.halved", "ru") : "";
    box.append(el(doc, "p", { class: "nobs-trust-disagree", role: "note", text: `${tf("trustui.disagree", { span: view.span })}${tail}` }));
  }
  const odd = outliers(view);
  const table = el(doc, "table", { class: "nobs-src-table nobs-trust-table" });
  table.append(el(doc, "thead", {}, el(doc, "tr", {}, ...["connector", "measures", "value", "norm", "inScore", ""].map((h) => el(doc, "th", { text: h ? t(`trustui.th.${h}`, "ru") : "" })))));
  const tb = el(doc, "tbody");
  for (const r of view.rows ?? []) {
    const sig = r.signal;
    const tr = el(doc, "tr", { class: `${sig ? "" : "is-empty"}${odd.has(r.connector) ? " is-outlier" : ""}`.trim() || null, "data-connector": r.connector });
    const link = sig && safeHref(sig.url);
    const action = el(doc, "td");
    if (link) action.append(el(doc, "a", { href: link, target: "_blank", rel: "noopener noreferrer", text: t("trustui.source", "ru") }));
    if (editable && r.connector === "wayback_age" && onLazy) {
      const b = el(doc, "button", { type: "button", class: "nobs-trust-lazy", text: sig ? t("trustui.refresh", "ru") : t("trustui.check", "ru") });
      b.addEventListener("click", () => onLazy(r.connector, view.domain, b));
      action.append(" ", b);
    }
    tr.append(
      el(doc, "td", { text: connText(r, "name") }),
      el(doc, "td", { text: measureLabel(r.measures) }),
      el(doc, "td", { text: sig ? signalLabel(sig.label) : r.status === "needs_key" ? t("trustui.needsKey", "ru") : t("trustui.noData", "ru") }),
      el(doc, "td", { class: "is-num", text: sig && typeof sig.norm === "number" ? sig.norm.toFixed(2) : "—" }),
      el(doc, "td", { text:
          r.kind === "internal"
            ? t("trustui.isTheScore", "ru")
            : !r.in_prior
              ? t("trustui.noByNature", "ru")
              : r.enabled
                ? tf("trustui.yesWeight", { w: Number(r.weight).toFixed(2) })
                : t("trustui.noOff", "ru"),
      }),
      action,
    );
    tb.append(tr);
  }
  table.append(tb);
  box.append(el(doc, "div", { class: "nobs-src-table-wrap nobs-trust-table-wrap" }, table));
  const p = view.prior;
  if (p) {
    const parts = (p.parts ?? []).filter((x) => x.pseudo > 0);
    const lines = [`${tf("trustui.prior.tier", { tier: p.tier, tierMean: p.tier_mean, mean: p.mean })}${p.changed ? "" : t("trustui.prior.unchanged", "ru")}`];
    for (const x of parts) lines.push(tf("trustui.prior.part", { connector: x.connector, norm: x.norm.toFixed(2), pseudo: x.pseudo, share: Math.round(x.share * 100) }));
    if (p.popularity_scaled) lines.push(t("trustui.prior.popularity", "ru"));
    const ul = el(doc, "ul", { class: "nobs-trust-prior" });
    for (const l of lines) ul.append(el(doc, "li", { text: l }));
    box.append(el(doc, "h4", { text: t("trustui.prior.title", "ru") }), ul);
  }
  return box;
}

/** The compact row of connector chips for a domain (the sources page card). */
export function renderTrustRow(doc, entry) {
  if (!entry) return null;
  const box = el(doc, "div", { class: "nobs-trust-row" });
  box.append(el(doc, "h3", {}, t("trustui.row.title", "ru"), el(doc, "a", { href: "trust.html", class: "nobs-trust-more", text: t("trustui.row.more", "ru") })));
  const signals = (entry.signals ?? []).filter((s) => s.connector !== "nobs_registry");
  if (!signals.length) {
    box.append(el(doc, "p", { class: "nobs-src-muted", text: t("trustui.row.none", "ru") }));
    return box;
  }
  const ul = el(doc, "ul", { class: "nobs-trust-chips" });
  for (const s of signals) {
    const li = el(doc, "li", { class: `nobs-trust-chip${s.enabled ? " is-on" : ""}`, title: `${measureLabel(s.measures)}${s.enabled ? t("trustui.row.inPrior", "ru") : t("trustui.row.notInScore", "ru")}` });
    li.append(el(doc, "b", { text: SHORT_NAMES[s.connector] ?? connText(s, "name") }), `: ${signalLabel(s.label)}`);
    ul.append(li);
  }
  box.append(ul);
  if (entry.disagreement) box.append(el(doc, "p", { class: "nobs-trust-disagree", text: tf("trustui.disagree", { span: entry.span }) }));
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
  const status = el(doc, "p", { class: "nobs-src-muted", text: t("trustui.loading", "ru") });
  root.append(status);
  let data;
  try {
    data = await getJson("/trust/connectors");
  } catch (err) {
    status.textContent = tf("trustui.loadFailed", { err: err?.message ?? err });
    return { state: null };
  }
  if (data?.unavailable) {
    // build_demo.py could not export the snapshot (server without /trust).
    status.textContent = t("trustui.unavailable", "ru");
    return { state: null };
  }
  status.remove();
  const summaryEl = el(doc, "p", { class: "nobs-src-summary" });
  const message = el(doc, "p", { class: "nobs-trust-message", role: "status", "aria-live": "polite" });
  const rulesList = el(doc, "ul", { class: "nobs-src-note nobs-trust-rules" });
  for (const r of rules()) rulesList.append(el(doc, "li", { text: r }));

  // The domain lookup box.
  const lookupSec = el(doc, "section", { class: "nobs-trust-lookup" });
  const form = el(doc, "form", { class: "nobs-src-controls", role: "search" });
  const input = el(doc, "input", { type: "search", placeholder: t("trustui.domainPlaceholder", "ru"), "aria-label": t("trustui.domainAria", "ru"), name: "domain", list: isDemo ? "nobs-trust-domains" : null });
  const go = el(doc, "button", { type: "submit", text: t("trustui.show", "ru") });
  form.append(input, go);
  const result = el(doc, "div", { class: "nobs-trust-lookup-wrap" });
  lookupSec.append(el(doc, "h2", { text: t("trustui.lookupTitle", "ru") }), form);
  if (isDemo) {
    const dl = el(doc, "datalist", { id: "nobs-trust-domains" });
    for (const d of Object.keys((await loadSnapshot()).lookups ?? {}).sort()) dl.append(el(doc, "option", { value: d }));
    lookupSec.append(dl, el(doc, "p", { class: "nobs-src-muted", text: t("trustui.demoDomains", "ru") }));
  }
  lookupSec.append(result);

  const list = el(doc, "div", { class: "nobs-trust-list" });
  root.append(summaryEl, el(doc, "h2", { text: t("trustui.rulesTitle", "ru") }), rulesList, message, lookupSec, el(doc, "h2", { text: t("trustui.connectors", "ru") }), list);

  const showLookup = async (domain) => {
    const d = String(domain ?? "").trim();
    if (!d) return;
    result.textContent = "";
    result.append(el(doc, "p", { class: "nobs-src-muted", text: t("trustui.loading", "ru") }));
    try {
      const view = await getJson(`/trust/lookup?domain=${encodeURIComponent(d)}`);
      result.textContent = "";
      if (!view) {
        result.append(el(doc, "p", { class: "nobs-src-muted", text: isDemo ? t("trustui.notInDemo", "ru") : t("trustui.notDomain", "ru") }));
        return;
      }
      result.append(renderLookup(doc, view, { editable: !isDemo, onLazy: lazy }));
    } catch (err) {
      result.textContent = tf("trustui.failed", { err: err?.message ?? err });
    }
  };
  const lazy = async (cid, domain, btn) => {
    btn.disabled = true;
    try {
      await send(`/trust/lookup/${encodeURIComponent(cid)}?domain=${encodeURIComponent(domain)}`, "POST");
      await showLookup(domain);
    } catch (err) {
      message.textContent = tf("trustui.requestFailed", { err: err?.message ?? err });
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
      tf("trustui.summary", {
        n: s.connectors ?? data.connectors?.length ?? 0,
        active: by.active ?? 0,
        needsKey: by.needs_key ?? 0,
        candidate: by.candidate ?? 0,
        paid: by.paid_not_subscribed ?? 0,
      }) +
      (by.disabled ? tf("trustui.summaryDisabled", { n: by.disabled }) : "") +
      tf("trustui.summarySignals", { signals: s.signals ?? "—", enabled: s.enabled?.length ? s.enabled.join(", ") : t("trustui.noneDefault", "ru") }) +
      (isDemo ? t("trustui.demoReadOnly", "ru") : "");
    list.textContent = "";
    for (const [kind, items] of groupByKind(data.connectors)) {
      const sec = el(doc, "section", { class: "nobs-trust-group" });
      sec.append(el(doc, "h3", { text: kindLabel(kind) }));
      for (const c of items) sec.append(renderConnector(doc, c, { editable: !isDemo, onChange: change, onSync: sync }));
      list.append(sec);
    }
  };
  const reload = async () => {
    data = await getJson("/trust/connectors");
    draw();
  };
  const change = async (cid, patch) => {
    message.textContent = t("trustui.saving", "ru");
    try {
      const r = await send(`/trust/connectors/${encodeURIComponent(cid)}`, "PUT", patch);
      message.textContent = tf("trustui.saved", { sources: r.rescored?.sources ?? "—", priors: r.rescored?.external_priors ?? 0 });
    } catch (err) {
      message.textContent = tf("trustui.notSaved", { err: err?.message ?? err });
    }
    await reload().catch(() => {});
  };
  const sync = async (cid, btn) => {
    btn.disabled = true;
    message.textContent = tf("trustui.syncing", { id: cid });
    try {
      const r = await send(`/trust/connectors/${encodeURIComponent(cid)}/sync`, "POST");
      message.textContent = r.status === "ok" ? tf("trustui.syncDone", { n: r.domains }) : tf("trustui.syncFailed", { status: r.status, message: r.message ?? "" });
    } catch (err) {
      message.textContent = tf("trustui.failed", { err: err?.message ?? err });
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
