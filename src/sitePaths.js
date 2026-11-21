// web/src/sitePaths.js
//
// Clean URLs: every public page lives in its own folder as index.html
// (skeptium.com/player/, /account/, /watch/, ...; the home is the site root).
// The old <name>.html addresses are tiny redirect stubs that forward to the
// folder with the query and the fragment intact (they must keep working).
//
// Links between pages are relative, resolved from the site root, so they work
// from a page at the root (the home, the local app's pages) and from a page in
// a folder (player/, brand/), wherever the site is served (127.0.0.1:8742/,
// skeptium.com/, a copy under a sub-path).

// The site root is the folder above this module (<root>/src/sitePaths.js).
const SITE_ROOT = new URL("../", import.meta.url);

/** Site-root-relative folder of each public page. */
export const PAGES = Object.freeze({
  home: "./",
  player: "player/",
  watch: "watch/",
  account: "account/",
  commentators: "commentators/",
  sources: "sources/",
  trust: "trust/",
  privacy: "privacy/",
  terms: "terms/",
  brand: "brand/",
});

function currentDoc() {
  return typeof document === "undefined" ? undefined : document;
}

/**
 * "../" per folder between the page and the site root ("" on a page at the root, "../" on
 * /player/ or /player/index.html), so relative links work from every page. "" when the page
 * is not under the root (another origin, tests).
 */
export function rootPrefix(doc = currentDoc(), root = SITE_ROOT) {
  let page;
  try {
    page = new URL(doc?.baseURI ?? doc?.location?.href ?? "");
  } catch {
    return "";
  }
  const base = new URL(root);
  if (page.origin !== base.origin || !page.pathname.startsWith(base.pathname)) return "";
  const depth = page.pathname.slice(base.pathname.length).split("/").length - 1;
  return "../".repeat(Math.max(0, depth));
}

/** A site-root-relative path ("account/", "data/x.json", "./") as an href for this page. */
export function siteHref(doc, path, root = SITE_ROOT) {
  const p = String(path ?? "");
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(p)) return p;
  const prefix = rootPrefix(doc ?? currentDoc(), root);
  if (p === "" || p === "./") return prefix || "./";
  if (p.startsWith("./?") || p.startsWith("./#")) return (prefix || "./") + p.slice(2);
  return prefix + p;
}

/** The href of a public page (PAGES key) for this page, with an optional "?query" / "#hash". */
export function pageHref(name, suffix = "", doc = currentDoc(), root = SITE_ROOT) {
  const folder = PAGES[name];
  if (!folder) throw new Error(`unknown page ${name}`);
  return siteHref(doc, folder + String(suffix ?? ""), root);
}

/**
 * The site root of an absolute page address: "https://skeptium.com/" for
 * https://skeptium.com/player/?run_id=5, for https://skeptium.com/player.html?run_id=5
 * (an old link) and for https://skeptium.com/. A page folder is one of PAGES.
 */
export function siteRootOf(href) {
  const u = new URL(String(href));
  u.search = "";
  u.hash = "";
  let path = u.pathname.replace(/[^/]*$/, ""); // drop the file name (player.html, index.html)
  for (const folder of Object.values(PAGES)) {
    if (folder !== "./" && path.endsWith(`/${folder}`)) {
      path = path.slice(0, -folder.length);
      break;
    }
  }
  u.pathname = path;
  return u.toString();
}

/** True when `pathname` is the page `name` (its folder, its index.html or its old .html stub). */
export function isPagePath(pathname, name) {
  const folder = PAGES[name];
  if (!folder || folder === "./") return false;
  const base = folder.slice(0, -1);
  return new RegExp(`/${base}(?:\\.html|/|/index\\.html)$`).test(String(pathname ?? ""));
}
