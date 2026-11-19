// web/src/library.js
//
// The player page's library sidebar: every successfully completed analysis
// (GET /runs), newest first, each a link that switches the player to it.
// Built with DOM APIs and textContent only -- titles come from YouTube and
// are never parsed as HTML.
//
// The sidebar is collapsible and starts collapsed (a narrow rail with a
// toggle). The state lives on the root's data-collapsed, so it survives the
// periodic re-render.
//
// Folders (spec 2026-11-18, §7): a pluggable folder source
// (setFolderSource) turns the owner's video sets into folder entries
// (data-type="playlist") the viewer can enter and leave; the open folder is
// the `playlist` URL parameter. Without a source (the public demo) the list
// is flat. This module knows only the source and the parameter; the
// management links come from the source (pageHref, manage_href).

import { formatCost, formatDuration } from "./runStats.js?v=078ff1187e";
import { isCollapsed, libraryIcon, makePanelToggle, setCollapsed } from "./sidePanel.js?v=078ff1187e";
import { enableMenuSettings } from "./settings.js?v=078ff1187e";
import { t } from "./i18n.js?v=078ff1187e";
import { buildEffortBadge } from "./effort.js?v=078ff1187e";
import { VIDEO_ID_RE as YOUTUBE_ID } from "./youtubeId.js?v=078ff1187e";

const FLAG_ORDER = ["green", "yellow", "red", "white"];
const SVG_NS = "http://www.w3.org/2000/svg";

// ---- the folder source ----------------------------------------------------------------------------

let folderSource = null;
let folderPageHref = null;
const sourceListeners = new Set();

/**
 * Register (or clear, with null) the folder source: `fn()` resolves to
 * [{id, title, item_count, analysed_count, video_ids, manage_href?}].
 * `pageHref`: the folders' management page, linked from the heading.
 * Every started library refreshes at once.
 */
export function setFolderSource(fn, { pageHref = null } = {}) {
  folderSource = typeof fn === "function" ? fn : null;
  folderPageHref = folderSource ? pageHref || null : null;
  for (const listener of [...sourceListeners]) listener();
}

/** The open folder from a query string (`?playlist=N`), or null. */
export function playlistParam(search) {
  const value = new URLSearchParams(search ?? "").get("playlist");
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

/** Set (id) or drop (null) the `playlist` parameter on the current address, no reload. */
export function setPlaylistParam(win, id) {
  if (!win?.history?.replaceState || !win.location) return;
  const url = new URL(win.location.href);
  if (id == null) url.searchParams.delete("playlist");
  else url.searchParams.set("playlist", String(id));
  win.history.replaceState(win.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function folderIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "nobs-library-folder-icon");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

/**
 * The folder model of the list: which entries show at the top level or
 * inside folder `playlistId`. Pure, for tests.
 *
 * @returns {{folder: object|null, folders: object[], runs: object[], pinned: object|null, pinnedFolder: object|null}}
 */
export function libraryModel(runs, currentRunId, { folders = null, playlistId = null } = {}) {
  const all = runs ?? [];
  if (!Array.isArray(folders)) return { folder: null, folders: [], runs: all, pinned: null, pinnedFolder: null };
  const shown = folders
    .filter((f) => (f.video_ids?.length ?? 0) > 0 && Number(f.item_count ?? f.video_ids.length) > 0)
    .sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? ""), "ru"));
  const open = playlistId == null ? null : folders.find((f) => Number(f.id) === Number(playlistId)) ?? null;
  if (open) {
    const byVideo = new Map();
    for (const run of all) {
      if (!byVideo.has(run.video_id)) byVideo.set(run.video_id, []);
      byVideo.get(run.video_id).push(run);
    }
    const inside = [];
    for (const videoId of open.video_ids ?? []) inside.push(...(byVideo.get(videoId) ?? []));
    return { folder: open, folders: [], runs: inside, pinned: null, pinnedFolder: null };
  }
  const folderOf = new Map();
  for (const f of shown) for (const videoId of f.video_ids) if (!folderOf.has(videoId)) folderOf.set(videoId, f);
  let pinned = null;
  let pinnedFolder = null;
  const loose = [];
  for (const run of all) {
    const f = folderOf.get(run.video_id);
    if (!f) loose.push(run);
    else if (currentRunId != null && Number(run.run_id) === Number(currentRunId)) {
      pinned = run;
      pinnedFolder = f;
    }
  }
  return { folder: null, folders: shown, runs: loose, pinned, pinnedFolder };
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderItem(doc, run, currentRunId, { playlistId = null, inFolder = null } = {}) {
  const runId = Number(run.run_id);
  const link = doc.createElement("a");
  link.className = "nobs-library-item";
  link.href = `player.html?run_id=${runId}` + (playlistId != null ? `&playlist=${Number(playlistId)}` : "");
  link.dataset.runId = String(runId);
  if (runId === Number(currentRunId)) {
    link.setAttribute("aria-current", "page");
  }

  if (YOUTUBE_ID.test(run.video_id ?? "")) {
    const thumb = doc.createElement("img");
    thumb.className = "nobs-library-thumb";
    thumb.src = `https://i.ytimg.com/vi/${run.video_id}/mqdefault.jpg`;
    thumb.alt = "";
    thumb.loading = "lazy";
    link.appendChild(thumb);
  }

  const body = doc.createElement("div");
  body.className = "nobs-library-body";

  const title = doc.createElement("div");
  title.className = "nobs-library-title";
  title.textContent = run.title || run.video_id || t("lib.untitled", "en").replace("{id}", String(runId));
  body.appendChild(title);
  if (inFolder) {
    const where = doc.createElement("div");
    where.className = "nobs-library-in-folder";
    where.textContent = t("lib.inFolder", "ru").replace("{title}", inFolder.title ?? "");
    body.appendChild(where);
  }

  const meta = doc.createElement("div");
  meta.className = "nobs-library-meta";
  const when = formatWhen(run.created_at);
  const took = formatDuration(run.stats?.duration_sec);
  const cost = formatCost(run.stats?.cost_usd);
  meta.textContent = [`#${runId}`, when, `${run.claim_count ?? 0} claims`, took, cost].filter(Boolean).join(" · ");
  // Effort mode (src/effort.js): Light / Deep / «Deep готовится…».
  if (run.effort) meta.prepend(buildEffortBadge(doc, run.effort, { upgrading: Boolean(run.upgrading) }), " ");
  body.appendChild(meta);

  const flags = doc.createElement("div");
  flags.className = "nobs-library-flags";
  for (const flag of FLAG_ORDER) {
    const count = run.flags?.[flag] ?? 0;
    if (!count) continue;
    const chip = doc.createElement("span");
    chip.className = `nobs-library-flag nobs-library-flag-${flag}`;
    chip.textContent = String(count);
    chip.title = `${count} ${flag}`;
    flags.appendChild(chip);
  }
  body.appendChild(flags);

  link.appendChild(body);
  return link;
}

function renderFolder(doc, folder, currentRunId, onEnter) {
  const id = Number(folder.id);
  const link = doc.createElement("a");
  link.className = "nobs-library-item nobs-library-folder";
  link.dataset.type = "playlist";
  link.dataset.playlistId = String(id);
  link.href = currentRunId != null ? `player.html?run_id=${Number(currentRunId)}&playlist=${id}` : `player.html?playlist=${id}`;
  link.appendChild(folderIcon(doc));
  const body = doc.createElement("div");
  body.className = "nobs-library-body";
  const title = doc.createElement("div");
  title.className = "nobs-library-title";
  title.textContent = folder.title || `#${id}`;
  const meta = doc.createElement("div");
  meta.className = "nobs-library-meta";
  const total = Number(folder.item_count ?? folder.video_ids?.length ?? 0);
  meta.textContent = t("lib.analysedOf", "ru").replace("{n}", String(Number(folder.analysed_count ?? 0))).replace("{total}", String(total));
  body.append(title, meta);
  link.appendChild(body);
  link.addEventListener("click", (event) => {
    if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onEnter(id);
  });
  return link;
}

export function isLibraryCollapsed(root) {
  return isCollapsed(root);
}

export function setLibraryCollapsed(root, collapsed) {
  setCollapsed(root, collapsed);
  if (!collapsed) root.querySelector("[aria-current='page']")?.scrollIntoView?.({ block: "nearest" });
}

/**
 * Replace `root`'s contents with the library list.
 *
 * @param {HTMLElement} root
 * @param {object[]} runs  GET /runs `runs` entries
 * @param {number|string|null} currentRunId  highlighted with aria-current
 * @param {object} [options]
 * @param {object[]|null} [options.folders]  the folder source's folders (null: flat list)
 * @param {number|null} [options.playlistId]  the open folder
 * @param {string|null} [options.pageHref]  the folders' management page (heading link)
 * @param {Window} [options.win]  whose address keeps the open folder
 * @param {(id: number|null) => void} [options.onFolderChange]  after entering / leaving
 */
export function renderLibrary(root, runs, currentRunId, options = {}) {
  const { folders = null, pageHref = null, win = globalThis.window, onFolderChange = null } = options;
  let { playlistId = null } = options;
  const doc = root.ownerDocument;
  const known = Array.isArray(folders) && playlistId != null && folders.some((f) => Number(f.id) === Number(playlistId));
  if (Array.isArray(folders) && playlistId != null && !known) {
    // An unknown or deleted folder: the top level, and the address forgets it.
    playlistId = null;
    setPlaylistParam(win, null);
  }
  const goTo = (id) => {
    setPlaylistParam(win, id);
    renderLibrary(root, runs, currentRunId, { ...options, playlistId: id });
    onFolderChange?.(id);
  };
  const heading = doc.createElement("div");
  heading.className = "nobs-library-heading";
  const toggle = makePanelToggle(root, {
    contentId: "nobs-library-list",
    makeIcon: libraryIcon,
    showLabel: t("lib.show", "en"),
    hideLabel: t("lib.hide", "en"),
  });
  toggle.classList.add("nobs-library-toggle");
  toggle.addEventListener("click", () => {
    if (!isCollapsed(root)) root.querySelector("[aria-current='page']")?.scrollIntoView?.({ block: "nearest" });
  });
  const label = doc.createElement("span");
  label.className = "nobs-library-label";
  label.textContent = t("lib.label", "en");
  const newLink = doc.createElement("a");
  newLink.href = "index.html";
  newLink.className = "nobs-library-new";
  newLink.textContent = t("lib.new", "en");
  // Settings: an entry of the account menu (signed in only), not a gear here.
  enableMenuSettings(doc, () => doc.body?.dataset.lang || "en");
  // The public demo has no local submit page; its index is the invite-only
  // request page (request.html, src/publicRequest.js) instead.
  const demo = doc.documentElement?.dataset.demo === "1";
  let requestLink = null;
  if (demo) {
    requestLink = doc.createElement("a");
    requestLink.href = "index.html";
    requestLink.className = "nobs-library-request";
    requestLink.textContent = t("lib.request", "ru");
    requestLink.title = t("lib.requestTitle", "ru");
  }
  let foldersLink = null;
  if (!demo && pageHref && Array.isArray(folders)) {
    foldersLink = doc.createElement("a");
    foldersLink.href = pageHref;
    foldersLink.className = "nobs-library-folders-link";
    foldersLink.textContent = t("lib.playlists", "ru");
  }
  heading.append(...[toggle, label, foldersLink, demo ? requestLink : newLink].filter(Boolean));

  const list = doc.createElement("nav");
  list.className = "nobs-library-list";
  list.id = "nobs-library-list";
  list.setAttribute("aria-label", t("lib.listLabel", "en"));
  const model = libraryModel(runs, currentRunId, { folders, playlistId });
  if (model.folder) {
    const folder = model.folder;
    const back = doc.createElement("button");
    back.type = "button";
    back.className = "nobs-library-back";
    back.textContent = t("lib.back", "ru");
    back.addEventListener("click", () => goTo(null));
    const sub = doc.createElement("div");
    sub.className = "nobs-library-subheading";
    const subTitle = doc.createElement("span");
    subTitle.className = "nobs-library-subtitle";
    subTitle.textContent = folder.title || `#${folder.id}`;
    sub.appendChild(subTitle);
    if (folder.manage_href) {
      const manage = doc.createElement("a");
      manage.className = "nobs-library-manage";
      manage.href = folder.manage_href;
      manage.textContent = t("lib.manage", "ru");
      sub.appendChild(manage);
    }
    list.append(back, sub);
    if (!model.runs.length) {
      const empty = doc.createElement("p");
      empty.className = "nobs-library-empty";
      empty.textContent = t("lib.folderEmpty", "ru");
      list.appendChild(empty);
    }
    for (const run of model.runs) list.appendChild(renderItem(doc, run, currentRunId, { playlistId: folder.id }));
  } else if (!model.runs.length && !model.folders.length && !model.pinned) {
    const empty = doc.createElement("p");
    empty.className = "nobs-library-empty";
    empty.textContent = t("lib.empty", "en");
    list.appendChild(empty);
  } else {
    // The open video never disappears: when it sits in a folder it is also
    // pinned here, with the folder's name.
    if (model.pinned) list.appendChild(renderItem(doc, model.pinned, currentRunId, { inFolder: model.pinnedFolder }));
    for (const folder of model.folders) list.appendChild(renderFolder(doc, folder, currentRunId, goTo));
    for (const run of model.runs) list.appendChild(renderItem(doc, run, currentRunId));
  }

  root.replaceChildren(heading, list);
  setCollapsed(root, isCollapsed(root));
}

/**
 * Load the library now and refresh it every `refreshIntervalMs`, so a run
 * that finishes (here or in another tab) shows up without a reload.
 * Returns a stop function.
 */
export function startLibrary({ root, fetchImpl, currentRunId, refreshIntervalMs = 15000, win = globalThis.window }) {
  let lastJson = null;
  let stopped = false;
  let lastFolders = null;

  async function loadFolders() {
    const source = folderSource;
    if (!source) return null;
    try {
      const folders = await source();
      lastFolders = Array.isArray(folders) ? folders : [];
    } catch {
      // keep the last folders on a failed refresh
    }
    return lastFolders;
  }

  async function refresh() {
    try {
      const [response, folders] = await Promise.all([fetchImpl("/runs"), loadFolders()]);
      if (!response.ok || stopped) return;
      const body = await response.json();
      const runs = body.runs ?? [];
      const pageHref = folderSource ? folderPageHref : null;
      const playlistId = folders ? playlistParam(win?.location?.search) : null;
      const json = JSON.stringify([runs, folders, playlistId, pageHref]);
      if (json === lastJson) return; // unchanged: keep the DOM (and scroll) as is
      lastJson = json;
      renderLibrary(root, runs, currentRunId, {
        folders,
        playlistId,
        pageHref,
        win,
        onFolderChange: (id) => {
          lastJson = JSON.stringify([runs, folders, id, pageHref]);
        },
      });
    } catch {
      // The library is a convenience: a failed refresh keeps the last list.
    }
  }

  const onSource = () => {
    lastFolders = null;
    if (!stopped) refresh();
  };
  sourceListeners.add(onSource);
  refresh();
  const intervalId = setInterval(refresh, refreshIntervalMs);
  return () => {
    stopped = true;
    sourceListeners.delete(onSource);
    clearInterval(intervalId);
  };
}
