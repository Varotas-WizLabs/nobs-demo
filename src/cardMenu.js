// web/src/cardMenu.js
//
// The «More» button of a home card (the vertical ellipsis on the right of
// the title's first line) and the small menu it opens: Copy link, Share
// (only where the browser can share) and Open video (the original, in a new
// tab). A card is one link, so the button sits beside it, not inside it:
// homePage.js wraps the two in .nobs-hp-item. One menu serves the whole
// page; on a phone it is a sheet from the bottom with a scrim, on wider
// screens a popover under the button (styles.css .nobs-hp-cardmenu).
//
// The link is the public one (src/share.js): on the public site the page's
// own player/, in the local app the public site's address.

import { t } from "./i18n.js?v=1cfdace93f";
import { shareUrl } from "./share.js?v=1cfdace93f";
import { PAGES, siteRootOf } from "./sitePaths.js?v=1cfdace93f";
import { VIDEO_ID_RE } from "./youtubeId.js?v=1cfdace93f";

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(doc, paths, { filled = false } = {}) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "24", height: "24", "aria-hidden": "true", focusable: "false" })) {
    svg.setAttribute(k, v);
  }
  for (const d of paths) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    if (filled) p.setAttribute("fill", "currentColor");
    else {
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "1.8");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
    }
    svg.append(p);
  }
  return svg;
}

/** Three dots, one above the other. */
const DOTS = ["M12 4.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM12 10.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM12 16a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5z"];
const LINK = ["M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1", "M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"];
const SHARE = ["M12 15V4", "M8 8l4-4 4 4", "M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"];
const OPEN = ["M14 4h6v6", "M20 4l-9 9", "M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"];

/** The «More» button of the card for `run`. */
export function moreButton(doc, run, lang = "ru") {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = "nobs-hp-more";
  b.dataset.runId = String(Number(run.run_id));
  b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-expanded", "false");
  const label = `${t("home.more", lang)}: ${run.title || run.video_id || `#${run.run_id}`}`;
  b.setAttribute("aria-label", label);
  b.title = t("home.more", lang);
  b.append(icon(doc, DOTS, { filled: true }));
  return b;
}

/** The public link to a run's analysis: the site's own player on the public site. */
export function cardLink(run, doc) {
  const demo = doc?.documentElement?.dataset.demo === "1";
  const href = doc?.defaultView?.location?.href;
  return shareUrl(Number(run.run_id), { demoHref: demo && href ? new URL(PAGES.player, siteRootOf(href)).href : null });
}

/** The original video's address, or "" when the id is not a video id. */
export function videoUrl(run) {
  return VIDEO_ID_RE.test(run?.video_id ?? "") ? `https://www.youtube.com/watch?v=${run.video_id}` : "";
}

async function copy(win, doc, text) {
  try {
    await win.navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = doc.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    doc.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = doc.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * The page's card menu. `findRun(id)` gives the run of a card. Clicks on any
 * .nobs-hp-more inside `roots` open it. Returns {open, close, isOpen, menu}.
 */
export function mountCardMenu({ doc = globalThis.document, win = doc?.defaultView, roots = [], findRun, lang = "ru" }) {
  const scrim = doc.createElement("div");
  scrim.className = "nobs-hp-cardmenu-scrim";
  scrim.hidden = true;
  const menu = doc.createElement("div");
  menu.className = "nobs-hp-cardmenu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const status = doc.createElement("p");
  status.className = "nobs-hp-cardmenu-status";
  status.setAttribute("role", "status");

  const item = (cls, paths, key) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = `nobs-hp-cardmenu-item ${cls}`;
    b.setAttribute("role", "menuitem");
    b.tabIndex = -1;
    const text = doc.createElement("span");
    text.textContent = t(key, lang);
    b.append(icon(doc, paths), text);
    return b;
  };
  const copyItem = item("nobs-hp-cardmenu-copy", LINK, "home.more.copy");
  const shareItem = item("nobs-hp-cardmenu-share", SHARE, "home.more.share");
  const openItem = doc.createElement("a");
  openItem.className = "nobs-hp-cardmenu-item nobs-hp-cardmenu-open";
  openItem.setAttribute("role", "menuitem");
  openItem.tabIndex = -1;
  openItem.target = "_blank";
  openItem.rel = "noopener noreferrer";
  const openText = doc.createElement("span");
  openText.textContent = t("home.more.open", lang);
  openItem.append(icon(doc, OPEN), openText);
  menu.append(copyItem, shareItem, openItem, status);
  doc.body.append(scrim, menu);

  let current = null; // {run, button}
  const items = () => [...menu.querySelectorAll(".nobs-hp-cardmenu-item")].filter((n) => !n.hidden);

  function place(button) {
    // Under the button, its right edge on the button's (styles.css turns it
    // into a bottom sheet on a phone and ignores these).
    const r = button.getBoundingClientRect?.();
    if (!r) return;
    const top = r.bottom + 4;
    const right = Math.max(8, (win?.innerWidth ?? r.right) - r.right);
    menu.style.setProperty("--menu-top", `${Math.round(top)}px`);
    menu.style.setProperty("--menu-right", `${Math.round(right)}px`);
  }

  function open(button) {
    const run = findRun(Number(button.dataset.runId));
    if (!run) return;
    if (current) close(false);
    current = { run, button };
    status.textContent = "";
    shareItem.hidden = typeof win?.navigator?.share !== "function";
    const video = videoUrl(run);
    openItem.hidden = !video;
    if (video) openItem.href = video;
    else openItem.removeAttribute("href");
    place(button);
    scrim.hidden = false;
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    doc.addEventListener("keydown", onKey, true);
    items()[0]?.focus();
  }

  function close(restore = true) {
    if (!current) return;
    const { button } = current;
    current = null;
    menu.hidden = true;
    scrim.hidden = true;
    button.setAttribute("aria-expanded", "false");
    doc.removeEventListener("keydown", onKey, true);
    if (restore && button.isConnected) button.focus();
  }

  function onKey(e) {
    const list = items();
    const i = list.indexOf(doc.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      list[(i + step + list.length) % list.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      list[e.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  copyItem.addEventListener("click", async () => {
    if (!current) return;
    const ok = await copy(win, doc, cardLink(current.run, doc));
    status.textContent = t(ok ? "home.more.copied" : "share.copyFailed", lang);
    if (ok) win?.setTimeout?.(() => close(), 900);
  });
  shareItem.addEventListener("click", async () => {
    if (!current) return;
    const { run } = current;
    close();
    try {
      await win.navigator.share({ title: run.title || "Skeptium", url: cardLink(run, doc) });
    } catch {
      // dismissed: nothing to do
    }
  });
  openItem.addEventListener("click", () => close(false));
  scrim.addEventListener("click", () => close());
  doc.addEventListener("click", (e) => {
    if (current && !menu.contains(e.target) && !current.button.contains(e.target)) close(false);
  });
  win?.addEventListener?.("resize", () => close(false));

  for (const root of roots) {
    root?.addEventListener("click", (e) => {
      const button = e.target.closest?.(".nobs-hp-more");
      if (!button || !root.contains(button)) return;
      e.preventDefault();
      if (current?.button === button) close();
      else open(button);
    });
  }
  return { open, close, isOpen: () => Boolean(current), menu };
}
