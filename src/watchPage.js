// web/src/watchPage.js
//
// watch.html?v=<video id>&t=<share token> (spec 2026-11-18-accounts §2a): the
// address of an Unlisted or Private analysis. Its files are not on the public
// site; they sit in a private Supabase Storage bucket, and get_run_access()
// hands out signed URLs to the owner (signed in) or to whoever has the
// Unlisted token. Outcomes:
//   public            -> the public player (the video is effectively Public);
//   owner/token+files -> the manifest {run_id, files, expires_at, back} goes to
//                        sessionStorage (nobs.watch.<run_id>) and the player
//                        opens with watch=1: src/demoShim.js then fetches the
//                        run's data files from the signed URLs;
//   pending           -> «Разбор готовится, обновите через минуту»;
//   not_found         -> «Видео не найдено или доступ закрыт» + «Войти».
// On the local server (no accounts config) the video's run comes straight
// from the local run list.

import { t } from "./i18n.js?v=4d60deaed2";
import { loadAccountsConfig } from "./accountsConfig.js?v=4d60deaed2";
import { createAccountsClient } from "./accountsClient.js?v=4d60deaed2";

export const WATCH_KEY_PREFIX = "nobs.watch.";
const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,120}$/;

/** {videoId, token} from watch.html's query (token null unless 32 hex). */
export function parseWatchParams(search) {
  const q = new URLSearchParams(search ?? "");
  const v = (q.get("v") ?? "").trim();
  const token = (q.get("t") ?? "").trim().toLowerCase();
  return { videoId: VIDEO_RE.test(v) ? v : null, token: TOKEN_RE.test(token) ? token : null };
}

/** The manifest for the shim, or null if the answer is not usable. */
export function watchManifest(access, back) {
  const runId = Number(access?.run_id);
  if (!Number.isInteger(runId) || runId <= 0 || !access?.files || typeof access.files !== "object") return null;
  const files = {};
  for (const [name, url] of Object.entries(access.files)) {
    if (FILE_RE.test(name) && name.startsWith(`${runId}.`) && typeof url === "string" && /^https:\/\//.test(url)) files[name] = url;
  }
  if (!Object.keys(files).length) return null;
  return { run_id: runId, video_id: access.video_id ?? null, files, expires_at: access.expires_at ?? null, back };
}

function publicTarget(access) {
  const url = String(access?.player_url ?? "");
  if (/^https:\/\/varotas-wizlabs\.github\.io\/nobs-demo\//.test(url)) return url;
  const runId = Number(access?.run_id);
  return Number.isInteger(runId) && runId > 0 ? `player.html?run_id=${runId}&solo=1` : null;
}

/**
 * Run the page. Returns the outcome ("public", "watch", "pending",
 * "not_found", "bad_link", "error", "local", "local_missing") for tests.
 */
export async function runWatchPage({
  doc = globalThis.document,
  root,
  lang = "ru",
  location = globalThis.location,
  storage = globalThis.sessionStorage,
  config,
  client,
  createClient,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  replace = (url) => globalThis.location.replace(url),
} = {}) {
  const say = (key, { signIn = false, refresh = false } = {}) => {
    const p = doc.createElement("p");
    p.className = "nobs-watch-message";
    p.textContent = t(key, lang);
    const parts = [p];
    const actions = doc.createElement("div");
    actions.className = "nobs-account-actions";
    if (signIn) {
      const a = doc.createElement("a");
      a.className = "nobs-account-open";
      // back to this video after sign-in (account.html accepts only a same-origin watch.html)
      const params = new URLSearchParams();
      if (lang === "en") params.set("lang", "en");
      if (location?.href) params.set("next", String(location.href));
      const q = params.toString();
      a.href = q ? `account.html?${q}` : "account.html";
      a.textContent = t("watch.signIn", lang);
      actions.append(a);
    }
    if (refresh) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "nobs-secondary";
      b.textContent = t("watch.refresh", lang);
      b.addEventListener("click", () => location.reload?.());
      actions.append(b);
    }
    if (actions.children.length) parts.push(actions);
    root.replaceChildren(...parts);
  };

  const { videoId, token } = parseWatchParams(location?.search);
  if (!videoId) {
    say("watch.badLink");
    return "bad_link";
  }
  say("watch.checking");

  let c = client;
  if (!c) {
    const cfg = config !== undefined ? config : await loadAccountsConfig({ fetchImpl });
    c = cfg ? createAccountsClient(cfg, { createClient: createClient ?? globalThis.supabase?.createClient }) : null;
  }

  if (!c) {
    // The local server: its own run list knows every video.
    try {
      const r = await fetchImpl("/runs");
      const runs = r.ok ? (await r.json()).runs ?? [] : [];
      const match = runs.filter((run) => run.video_id === videoId);
      if (match.length) {
        const best = match.reduce((a, b) => (Number(b.run_id) > Number(a.run_id) ? b : a));
        replace(`player.html?run_id=${Number(best.run_id)}`);
        return "local";
      }
    } catch {
      // fall through
    }
    say("watch.notFound");
    return "local_missing";
  }

  await c.session(); // a signed-in owner's session is loaded before asking
  const r = await c.runAccess(videoId, token);
  if (r.error === "not_found") {
    say("watch.notFound", { signIn: true });
    return "not_found";
  }
  if (r.error) {
    say("watch.error", { refresh: true });
    return "error";
  }
  const access = r.data ?? {};
  if (access.access === "public") {
    const target = publicTarget(access);
    if (target) {
      replace(target);
      return "public";
    }
    say("watch.pending", { refresh: true });
    return "pending";
  }
  if (access.pending) {
    say("watch.pending", { refresh: true });
    return "pending";
  }
  const manifest = watchManifest(access, String(location?.href ?? ""));
  if (!manifest) {
    say("watch.pending", { refresh: true });
    return "pending";
  }
  try {
    storage.setItem(`${WATCH_KEY_PREFIX}${manifest.run_id}`, JSON.stringify(manifest));
  } catch {
    say("watch.error", { refresh: true });
    return "error";
  }
  replace(`player.html?run_id=${manifest.run_id}&solo=1&watch=1`);
  return "watch";
}
