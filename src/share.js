// web/src/share.js
//
// The "share" button next to "download" in the right panel: a small popup
// with the public link to this analysis, ready to copy. The link points at
// the static public demo (GitHub Pages) and carries `solo=1`, which shows
// only this video (the library of other analyses is hidden).
//
// On the local app the link is the demo's address; the page asks the demo
// whether this run is published there and says so if not yet. Inside the
// demo itself the link is the current page's own address.

import { t } from "./i18n.js?v=f7e5408037";

export const PUBLIC_PLAYER = "https://varotas-wizlabs.github.io/nobs-demo/player.html";

/** Whether the page was opened as a single-video link (`?solo=1`). */
export function isSolo(search) {
  return new URLSearchParams(search).get("solo") === "1";
}

/** The public single-video link for `runId`. `demoHref`: the demo page's own URL when inside the demo. */
export function shareUrl(runId, { demoHref = null } = {}) {
  const base = demoHref ? demoHref.split(/[?#]/)[0] : PUBLIC_PLAYER;
  return `${base}?run_id=${encodeURIComponent(runId)}&solo=1`;
}

/** Whether the public demo has this run (its data file exists). null when it cannot tell. */
export async function isPublished(runId, fetchImpl = fetch) {
  try {
    const base = PUBLIC_PLAYER.slice(0, PUBLIC_PLAYER.lastIndexOf("/") + 1);
    const response = await fetchImpl(`${base}data/runs/${encodeURIComponent(runId)}.json`, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return null;
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A "share" icon: three linked dots. */
export function shareIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "18", height: "18", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) {
    svg.setAttribute(k, v);
  }
  for (const [cx, cy] of [[18, 5], [6, 12], [18, 19]]) {
    const c = doc.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", "3");
    svg.appendChild(c);
  }
  for (const d of ["m8.6 13.5 6.8 4", "m15.4 6.5-6.8 4"]) {
    const p = doc.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

async function copyText(doc, input, text) {
  try {
    await doc.defaultView.navigator.clipboard.writeText(text);
    return true;
  } catch {
    input.select();
    try {
      return doc.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/**
 * The share control: a button and its popup. `getRunId()` gives the current
 * run; `demo` is true inside the public demo. Returns the wrapper element.
 */
export function buildShareControl(doc, { getRunId, lang = "en", demo = false, fetchImpl = fetch }) {
  const wrap = doc.createElement("div");
  wrap.className = "nobs-share";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "nobs-side-toggle nobs-share-button";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.title = t("share.button", lang);
  button.setAttribute("aria-label", button.title);
  button.appendChild(shareIcon(doc));

  const pop = doc.createElement("div");
  pop.className = "nobs-share-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("share.title", lang));
  pop.hidden = true;
  const title = doc.createElement("p");
  title.className = "nobs-share-title";
  title.textContent = t("share.title", lang);
  const row = doc.createElement("div");
  row.className = "nobs-share-row";
  const input = doc.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.className = "nobs-share-url";
  input.setAttribute("aria-label", t("share.title", lang));
  const copy = doc.createElement("button");
  copy.type = "button";
  copy.className = "nobs-share-copy";
  copy.textContent = t("share.copy", lang);
  row.append(input, copy);
  const note = doc.createElement("small");
  note.className = "nobs-share-note";
  pop.append(title, row, note);
  wrap.append(button, pop);

  const close = () => {
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    const runId = getRunId();
    input.value = shareUrl(runId, { demoHref: demo ? doc.defaultView.location.href : null });
    copy.textContent = t("share.copy", lang);
    note.textContent = t("share.hint", lang);
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    input.focus();
    input.select();
    if (!demo) {
      isPublished(runId, fetchImpl).then((published) => {
        if (pop.hidden) return;
        if (published === false) note.textContent = t("share.notPublished", lang);
      });
    }
  };
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (pop.hidden) open();
    else close();
  });
  copy.addEventListener("click", async () => {
    const ok = await copyText(doc, input, input.value);
    copy.textContent = t(ok ? "share.copied" : "share.copyFailed", lang);
  });
  doc.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) close();
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  return wrap;
}
