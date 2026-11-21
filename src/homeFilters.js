// web/src/homeFilters.js
//
// The home page's filters. The scrolling chips row holds two facets, set
// apart by a thin rule: the kind (All, Deep, Light) and the verdict mix
// (mostly supported / many doubts). The other facets — Recent (finished in
// the last 7 days) and one entry per caption language present — sit in a
// Filters menu anchored at the row's right end. One filter is on at a time,
// like a video site's category chips; the ids are stable for the address
// (?chip=…) and tests.
//
// The verdict-mix chips count only checked claims (green, yellow, red);
// «white» (not checked) is left out of the shares. Colour is never the only
// signal: every chip has a text label.

import { t } from "./i18n.js?v=78dbe39118";
import { th } from "./stringsHome.js?v=78dbe39118";

export const RECENT_DAYS = 7;
// Shares of the checked claims (green + yellow + red).
export const SUPPORTED_SHARE = 0.6;
export const DOUBTFUL_SHARE = 0.4;

function checked(run) {
  const f = run?.flags ?? {};
  return (f.green ?? 0) + (f.yellow ?? 0) + (f.red ?? 0);
}

/** The language a run's chip uses: its caption language's base ("en-US" → "en"). */
export function runLanguage(run) {
  return String(run?.caption_language ?? "").split(/[-_]/)[0].toLowerCase() || null;
}

const TESTS = {
  all: () => true,
  deep: (run) => run.effort === "deep",
  light: (run) => run.effort !== "deep",
  supported: (run) => checked(run) > 0 && (run.flags?.green ?? 0) / checked(run) >= SUPPORTED_SHARE,
  doubtful: (run) => checked(run) > 0 && ((run.flags?.yellow ?? 0) + (run.flags?.red ?? 0)) / checked(run) >= DOUBTFUL_SHARE,
};

/** Whether `run` passes the chip `id` ("lang:xx" for a language). `now`: ms. */
export function matchesChip(run, id, now = Date.now()) {
  if (!id || id === "all") return true;
  if (id.startsWith("lang:")) return runLanguage(run) === id.slice(5);
  if (id === "recent") {
    const at = Date.parse(run?.created_at ?? "");
    return Number.isFinite(at) && now - at <= RECENT_DAYS * 86400000;
  }
  const test = TESTS[id];
  return test ? test(run) : true;
}

/** The runs that pass the chip. */
export function filterRuns(runs, id, now = Date.now()) {
  return (runs ?? []).filter((run) => matchesChip(run, id, now));
}

function languageName(code, lang) {
  try {
    const names = new Intl.DisplayNames([lang], { type: "language" });
    const name = names.of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
  } catch {
    // an old browser or an odd code: the code itself
  }
  return code.toUpperCase();
}

// The facets shown in the chips row; the rest go in the Filters menu.
export const ROW_GROUPS = ["kind", "verdict"];
// The Filters menu's sections, in order.
export const MENU_GROUPS = ["date", "lang"];

/**
 * The filters to offer for these runs: [{id, label, count, group, dot?,
 * hint?}], only those that narrow the list (All always). Languages: only
 * when there are two or more, most common first.
 */
export function chipsFor(runs, lang = "ru", now = Date.now()) {
  const list = runs ?? [];
  const chips = [{ id: "all", label: t("home.chip.all", lang), count: list.length, group: "kind" }];
  const add = (id, label, group, extra = {}) => {
    const count = filterRuns(list, id, now).length;
    if (count > 0 && count < list.length) chips.push({ id, label, count, group, ...extra });
  };
  add("deep", t("home.chip.deep", lang), "kind");
  add("light", t("home.chip.light", lang), "kind");
  add("supported", t("home.chip.supported", lang), "verdict", { dot: "green" });
  add("doubtful", t("home.chip.doubtful", lang), "verdict", { dot: "red" });
  add("recent", t("home.chip.recent", lang), "date");
  const langs = new Map();
  for (const run of list) {
    const code = runLanguage(run);
    if (code) langs.set(code, (langs.get(code) ?? 0) + 1);
  }
  if (langs.size > 1) {
    for (const [code] of [...langs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      // The chip shows the bare language name; its tooltip says "Language: …".
      const name = languageName(code, lang);
      add(`lang:${code}`, name, "lang", { hint: th("home.chip.lang", { name }, lang) });
    }
  }
  return chips;
}

const inRow = (chip) => !chip.group || ROW_GROUPS.includes(chip.group);

/**
 * Draw the row's chips into `root` (a toolbar of toggle buttons; a thin
 * rule between facets). Chips of the menu's facets are left out here (see
 * renderFilterMenu) but still count as known. `onChange(id)` after a
 * click; ArrowLeft/ArrowRight move between chips. Returns the selected id
 * (falls back to "all" when `selected` is not offered).
 */
export function renderChips(root, chips, selected, onChange, lang = "ru") {
  const doc = root.ownerDocument;
  const known = chips.some((c) => c.id === selected) ? selected : "all";
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", t("home.chips", lang));
  root.replaceChildren();
  const row = chips.filter(inRow);
  // With a menu filter on, no row chip is pressed: All keeps the tab stop.
  const stop = row.some((c) => c.id === known) ? known : row[0]?.id;
  let lastGroup = null;
  for (const chip of row) {
    if (lastGroup !== null && chip.group !== lastGroup) {
      const sep = doc.createElement("span");
      sep.className = "nobs-hp-chips-sep";
      sep.setAttribute("aria-hidden", "true");
      root.append(sep);
    }
    lastGroup = chip.group;
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "nobs-hp-chip";
    b.dataset.chip = chip.id;
    b.setAttribute("aria-pressed", String(chip.id === known));
    b.tabIndex = chip.id === stop ? 0 : -1;
    if (chip.dot) {
      const dot = doc.createElement("span");
      dot.className = `nobs-hp-chip-dot nobs-hp-dot-${chip.dot}`;
      dot.setAttribute("aria-hidden", "true");
      b.append(dot);
    }
    b.append(doc.createTextNode(chip.label));
    b.title = `${chip.hint ?? chip.label}: ${chip.count}`;
    if (chip.hint) b.setAttribute("aria-label", chip.hint);
    b.addEventListener("click", () => onChange?.(chip.id));
    root.append(b);
  }
  root.onkeydown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const buttons = [...root.querySelectorAll("button")];
    const i = buttons.indexOf(doc.activeElement);
    if (i < 0) return;
    e.preventDefault();
    let next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : i + (e.key === "ArrowRight" ? 1 : -1);
    next = (next + buttons.length) % buttons.length;
    buttons.forEach((b, k) => (b.tabIndex = k === next ? 0 : -1));
    buttons[next].focus();
    buttons[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  return known;
}

// How far one arrow click scrolls: this share of the visible width.
export const CHIP_SCROLL_SHARE = 0.8;

/**
 * Overflow arrows for the chips row: wraps `scroller` in a
 * .nobs-hp-chipbar and adds a back and a forward arrow, each set over a
 * fade and shown only while the row can scroll that way. The arrows are
 * pointer helpers (tabindex -1); keyboard users move along the toolbar
 * with the arrow keys, which scrolls the focused chip into view.
 * Also adds the (empty) .nobs-hp-filters slot at the bar's right end for
 * renderFilterMenu. Returns { update, bar, filters } — call update after
 * the chips are redrawn.
 */
export function mountChipScroller(scroller, lang = "ru", win = scroller.ownerDocument.defaultView) {
  const doc = scroller.ownerDocument;
  let track = scroller.parentElement;
  if (!track?.classList.contains("nobs-hp-chips-track")) {
    const outer = doc.createElement("div");
    outer.className = "nobs-hp-chipbar";
    track = doc.createElement("div");
    track.className = "nobs-hp-chips-track";
    scroller.before(outer);
    track.append(scroller);
    outer.append(track);
  }
  const bar = track.parentElement;
  let filters = bar.querySelector(".nobs-hp-filters");
  if (!filters) {
    filters = doc.createElement("div");
    filters.className = "nobs-hp-filters";
    filters.hidden = true;
    bar.append(filters);
  }
  const make = (dir) => {
    const edge = doc.createElement("div");
    edge.className = `nobs-hp-chips-edge nobs-hp-chips-edge-${dir}`;
    edge.dataset.edge = dir;
    edge.hidden = true;
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "nobs-hp-chips-arrow";
    b.tabIndex = -1;
    b.setAttribute("aria-label", t(dir === "start" ? "home.chips.back" : "home.chips.more", lang));
    b.setAttribute("aria-controls", scroller.id || "");
    b.innerHTML =
      '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
      `<path d="${dir === "start" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    b.addEventListener("click", () => {
      const by = Math.max(1, Math.round(scroller.clientWidth * CHIP_SCROLL_SHARE));
      const reduce = win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      scroller.scrollBy({ left: dir === "start" ? -by : by, behavior: reduce ? "auto" : "smooth" });
    });
    edge.append(b);
    track.append(edge);
    return edge;
  };
  track.querySelectorAll(".nobs-hp-chips-edge").forEach((e) => e.remove());
  bar.hidden = scroller.hidden;
  const start = make("start");
  const end = make("end");
  function update() {
    const max = scroller.scrollWidth - scroller.clientWidth;
    const at = Math.abs(scroller.scrollLeft);
    start.hidden = scroller.hidden || !(at > 1);
    end.hidden = scroller.hidden || !(at < max - 1);
    // Where the arrows are not drawn (touch, phones) the row masks its
    // edges instead; these say which edge has more chips past it.
    track.toggleAttribute("data-more-start", !start.hidden);
    track.toggleAttribute("data-more-end", !end.hidden);
  }
  scroller.addEventListener("scroll", update, { passive: true });
  win?.addEventListener?.("resize", update);
  if (win?.ResizeObserver) new win.ResizeObserver(update).observe(scroller);
  update();
  return { update, bar, filters };
}

const SLIDERS_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
  '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * The Filters control at the row's right end: a chip-height button
 * (sliders icon + "Filters") that opens a menu of the facets not in the
 * row (Recent, the languages), one radio-like item each. Picking an item
 * calls `onChange(id)`; picking the one already on calls `onChange("all")`.
 * While one of its filters is on, the button is filled like a pressed chip
 * and names it. Keyboard: Enter / Space / ArrowDown open the menu on the
 * checked (or first) item, arrows / Home / End move, Escape closes back to
 * the button, Tab closes. Hidden when there is nothing to put in it.
 */
export function renderFilterMenu(wrap, chips, selected, onChange, lang = "ru") {
  const doc = wrap.ownerDocument;
  const items = MENU_GROUPS.flatMap((g) => chips.filter((c) => c.group === g));
  const active = items.find((c) => c.id === selected) ?? null;
  wrap.hidden = items.length === 0;
  let button = wrap.querySelector(".nobs-hp-filters-button");
  let menu = wrap.querySelector(".nobs-hp-filters-menu");
  if (!button) {
    button = doc.createElement("button");
    button.type = "button";
    button.className = "nobs-hp-filters-button";
    button.id = "home-filters-button";
    button.setAttribute("aria-haspopup", "menu");
    menu = doc.createElement("div");
    menu.className = "nobs-hp-filters-menu";
    menu.id = "home-filters-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-labelledby", button.id);
    menu.hidden = true;
    button.setAttribute("aria-controls", menu.id);
    wrap.append(button, menu);
  }
  const close = ({ focus = false } = {}) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    wrap.dataset.open = "false";
    if (focus) button.focus();
  };
  const menuItems = () => [...menu.querySelectorAll('[role="menuitemradio"]')];
  const open = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    wrap.dataset.open = "true";
    const list = menuItems();
    (list.find((i) => i.getAttribute("aria-checked") === "true") ?? list[0])?.focus();
  };
  wrap._close = close;

  const label = t("home.filters", lang);
  button.innerHTML = SLIDERS_ICON;
  const text = doc.createElement("span");
  text.className = "nobs-hp-filters-label";
  text.textContent = active ? active.label : label;
  button.append(text);
  button.dataset.active = String(Boolean(active));
  button.setAttribute("aria-label", active ? `${label}: ${active.hint ?? active.label}` : label);
  button.title = active ? `${label}: ${active.hint ?? active.label}` : label;
  button.setAttribute("aria-expanded", String(!menu.hidden));

  menu.replaceChildren();
  for (const g of MENU_GROUPS) {
    const group = items.filter((c) => c.group === g);
    if (!group.length) continue;
    const section = doc.createElement("div");
    section.className = "nobs-hp-filters-group";
    section.setAttribute("role", "group");
    const head = doc.createElement("div");
    head.className = "nobs-hp-filters-heading";
    head.id = `home-filters-${g}`;
    head.textContent = t(`home.filters.${g}`, lang);
    section.setAttribute("aria-labelledby", head.id);
    section.append(head);
    for (const chip of group) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "nobs-hp-filters-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(chip.id === selected));
      item.tabIndex = -1;
      item.dataset.chip = chip.id;
      item.innerHTML = `<span class="nobs-hp-filters-check">${CHECK_ICON}</span>`;
      const name = doc.createElement("span");
      name.className = "nobs-hp-filters-name";
      name.textContent = chip.label;
      const count = doc.createElement("span");
      count.className = "nobs-hp-filters-count";
      count.textContent = String(chip.count);
      item.append(name, count);
      item.title = `${chip.hint ?? chip.label}: ${chip.count}`;
      if (chip.hint) item.setAttribute("aria-label", `${chip.hint}, ${chip.count}`);
      item.addEventListener("click", () => {
        close();
        onChange?.(chip.id === selected ? "all" : chip.id);
      });
      section.append(item);
    }
    menu.append(section);
  }

  button.onclick = () => (menu.hidden ? open() : close());
  button.onkeydown = (e) => {
    if (e.key === "ArrowDown" && menu.hidden) {
      e.preventDefault();
      open();
    }
  };
  menu.onkeydown = (e) => {
    const list = menuItems();
    const i = list.indexOf(doc.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close({ focus: true });
    } else if (e.key === "Tab") {
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) && list.length) {
      e.preventDefault();
      const next =
        e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next].focus();
    }
  };
  if (!wrap._outside) {
    wrap._outside = (e) => {
      if (!menu.hidden && !wrap.contains(e.target)) close();
    };
    doc.addEventListener("pointerdown", wrap._outside);
  }
  return active?.id ?? null;
}
