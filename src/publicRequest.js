// web/src/publicRequest.js
//
// «Разобрать новое видео»: the public page (request.html; the public demo's
// index.html) where a visitor with an invite code asks for a new analysis.
//
// 1. The video id is read from the link; a video the site already has opens
//    at once (its run list, GET /runs -- the demo shim answers it from
//    data/runs.json), so nothing is queued and no use is spent.
// 2. Otherwise POST {url, code, mode} to the queue Worker (workers/nobs-queue),
//    which files a request the owner's NOBS server picks up. `mode`: Light or
//    Deep (src/effort.js); Deep on a video the site has only in Light is filed
//    too (the deep upgrade), and the light version opens meanwhile.
// 3. The page waits, polling GET /status every 10 s: queued, processing N %,
//    done (then it waits until the published run's data is on the site --
//    GitHub Pages caches ~10 min, so its URLs get a cache-busting query --
//    and opens it), failed (with the reason).
// The pending request is kept in localStorage, so a reload keeps waiting.
// The invite code may come in the link's fragment (#code=…, never sent to a
// server); it pre-fills the field and is remembered for this visitor.

import { interfaceLanguageOf, t } from "./i18n.js?v=4219fdb83d";
import { VIDEO_ID_RE, extractVideoId, youtubeVideoId } from "./youtubeId.js?v=4219fdb83d";

export const WORKER_URL = "https://nobs-queue.iopuki-6fa.workers.dev";
export const POLL_MS = 10000;
const PENDING_KEY = "nobs.queue.pending";
const CODE_KEY = "nobs.queue.code";
/** The 11-character YouTube id of a link, or null (src/youtubeId.js: the
 * shared rules of the backend and the queue Worker). */
export function parseVideoId(url) {
  return extractVideoId(url);
}

/** The invite code in a location hash ("#code=NOBS-…"), or null. */
export function codeFromHash(hash) {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  const code = (params.get("code") ?? "").trim();
  return code && code.length <= 40 ? code : null;
}

/** The newest complete run of a video in a GET /runs list, or null. */
export function findExistingRun(runs, videoId) {
  return findExistingEntry(runs, videoId)?.run_id ?? null;
}

/** The GET /runs entry of a video (its served run), or null. */
export function findExistingEntry(runs, videoId) {
  const match = (runs ?? []).filter((r) => r.video_id === videoId);
  if (!match.length) return null;
  return match.reduce((a, b) => (Number(b.run_id) > Number(a.run_id) ? b : a));
}

/**
 * Whether a video already on the site opens at once for the chosen mode:
 * yes, unless Deep was chosen and the site has only a light version with no
 * deep pass under way (then the request is filed: the deep upgrade).
 */
export function opensExisting(entry, mode) {
  if (!entry) return false;
  if (mode !== "deep") return true;
  return entry.effort === "deep" || Boolean(entry.upgrading);
}

export function withParam(url, name, value) {
  const u = new URL(url);
  u.searchParams.set(name, String(value));
  return u.toString();
}

export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** The page language: the interface language when one was chosen
 * (src/uiLang.js), else Russian (the site's audience), English with ?lang=en. */
export function pickLang(loc) {
  const chosen = interfaceLanguageOf();
  if (chosen) return chosen;
  const q = new URLSearchParams(loc?.search ?? "").get("lang");
  return q === "en" ? "en" : "ru";
}

/** The visitor-facing text of a Worker error code. */
export function errorText(code, lang) {
  const known = ["bad_url", "clip", "bad_code", "code_used_up", "rate_limited", "no_code", "network", "forbidden_origin"];
  return t(`request.error.${known.includes(code) ? code : "other"}`, lang);
}

/** The waiting screen's line for a /status answer. */
export function statusText(status, lang) {
  if (!status) return t("request.status.sending", lang);
  if (status.status === "queued") return t(status.server_online === false ? "request.status.offline" : "request.status.queued", lang);
  if (status.status === "processing") {
    if (status.progress === 100) return t("request.status.publishing", lang);
    const line = t("request.status.processing", lang).replace("{pct}", String(status.progress ?? 0));
    return status.server_online === false ? `${line} ${t("request.status.offlineShort", lang)}` : line;
  }
  if (status.status === "done") return t("request.status.publishing", lang);
  const reasons = ["too_long", "unavailable", "no_captions"];
  return t(`request.failed.${reasons.includes(status.reason) ? status.reason : "error"}`, lang);
}

function storageGet(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    // blocked storage: this page still works, a reload forgets
  }
}

/**
 * Wire the page. `els`: {form, url, code, button, status, elapsed, waiting,
 * cancel, error}. Returns {submit, resume, state} for tests.
 */
export function mountRequestPage({
  doc = globalThis.document,
  els,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  location = globalThis.location,
  history = globalThis.history,
  navigate = (href) => {
    globalThis.location.href = href;
  },
  schedule = (fn, ms) => setTimeout(fn, ms),
  now = () => Date.now(),
  workerUrl = WORKER_URL,
  lang = "ru",
  getEffort = () => "light",
} = {}) {
  const state = { pending: storageGet(storage, PENDING_KEY), last: null, timer: null, ticker: null };

  // The code: from the link's fragment (then removed from the address bar), else remembered.
  const fromHash = codeFromHash(location?.hash);
  if (fromHash) {
    storageSet(storage, CODE_KEY, fromHash);
    try {
      history?.replaceState?.(null, "", `${location.pathname}${location.search}`);
    } catch {
      // ignore
    }
  }
  const savedCode = fromHash ?? storageGet(storage, CODE_KEY);
  if (savedCode && els.code) els.code.value = savedCode;

  const showError = (text) => {
    els.error.textContent = text ?? "";
    els.error.hidden = !text;
  };

  const showWaiting = (on) => {
    els.waiting.hidden = !on;
    els.form.hidden = on;
  };

  const renderStatus = () => {
    els.status.textContent = statusText(state.last, lang);
    if (state.pending?.started_at && els.elapsed) {
      els.elapsed.textContent = t("request.elapsed", lang).replace("{time}", formatElapsed(now() - state.pending.started_at));
    }
  };

  function stopWaiting() {
    state.pending = null;
    storageSet(storage, PENDING_KEY, null);
  }

  async function waitForPublished(playerUrl, runId) {
    const dataUrl = withParam(new URL(`data/runs/${runId}.json`, playerUrl).toString(), "cb", now());
    try {
      const r = await fetchImpl(dataUrl, { cache: "no-store" });
      if (r.ok) {
        stopWaiting();
        navigate(withParam(playerUrl, "v", now()));
        return true;
      }
    } catch {
      // not yet (or offline): try again
    }
    return false;
  }

  async function poll() {
    if (!state.pending) return;
    let status = null;
    try {
      const r = await fetchImpl(`${workerUrl}/status?issue=${encodeURIComponent(state.pending.issue)}`, { cache: "no-store" });
      status = await r.json();
      if (!r.ok) status = null;
    } catch {
      status = null;
    }
    if (status) {
      state.last = status;
      if (status.title && els.video) els.video.textContent = status.title;
      showError("");
    } else {
      showError(t("request.error.statusRetry", lang));
    }
    renderStatus();
    if (status?.status === "done" && status.player_url && status.run_id != null) {
      if (await waitForPublished(status.player_url, status.run_id)) return;
    }
    if (status?.status === "failed") {
      stopWaiting();
      els.status.textContent = statusText(status, lang);
      els.again.hidden = false;
      return;
    }
    state.timer = schedule(poll, POLL_MS);
  }

  function startTicker() {
    const tick = () => {
      if (!state.pending) return;
      renderStatus();
      state.ticker = schedule(tick, 1000);
    };
    tick();
  }

  function resume() {
    if (!state.pending) return false;
    showWaiting(true);
    els.again.hidden = true;
    if (els.video) els.video.textContent = state.pending.title || state.pending.video_id || "";
    renderStatus();
    startTicker();
    poll();
    return true;
  }

  async function submit() {
    showError("");
    const url = els.url.value.trim();
    const { id: videoId, reason } = youtubeVideoId(url);
    if (!videoId) {
      // A clip id is not a video id (the queue cannot resolve clips).
      const code = reason === "clip" ? "clip" : "bad_url";
      showError(errorText(code, lang));
      return code;
    }
    els.button.disabled = true;
    try {
      const mode = getEffort() === "deep" ? "deep" : "light";
      // Already on the site: open it at once (Deep chosen and only a light
      // version there: the request is filed -- the deep upgrade).
      try {
        const r = await fetchImpl("/runs");
        if (r.ok) {
          const entry = findExistingEntry((await r.json()).runs, videoId);
          if (opensExisting(entry, mode)) {
            navigate(`player.html?run_id=${Number(entry.run_id)}`);
            return "existing";
          }
        }
      } catch {
        // the list is a shortcut only
      }
      const code = els.code.value.trim();
      if (!code) {
        showError(errorText("no_code", lang));
        return "no_code";
      }
      let response;
      let body = null;
      try {
        response = await fetchImpl(`${workerUrl}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}`, code, mode }),
        });
        body = await response.json().catch(() => null);
      } catch {
        showError(errorText("network", lang));
        return "network";
      }
      if (!response.ok || !body?.issue) {
        const code_ = body?.error ?? "other";
        showError(errorText(code_, lang));
        return code_;
      }
      storageSet(storage, CODE_KEY, code);
      state.pending = { issue: body.issue, video_id: videoId, started_at: now() };
      state.last = { status: "queued", server_online: body.server_online };
      storageSet(storage, PENDING_KEY, state.pending);
      resume();
      return "queued";
    } finally {
      els.button.disabled = false;
    }
  }

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  els.cancel?.addEventListener("click", () => {
    stopWaiting();
    showWaiting(false);
  });
  els.again?.addEventListener("click", () => {
    els.again.hidden = true;
    showWaiting(false);
  });

  return { submit, resume, state, poll };
}

/** The «ready analyses» list under the form: links to the newest runs. */
export function renderRecent(root, runs, lang, limit = 12) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  for (const run of (runs ?? []).slice(0, limit)) {
    const a = doc.createElement("a");
    a.className = "nobs-request-recent-item";
    a.href = `player.html?run_id=${Number(run.run_id)}`;
    if (VIDEO_ID_RE.test(run.video_id ?? "")) {
      const img = doc.createElement("img");
      img.src = `https://i.ytimg.com/vi/${run.video_id}/mqdefault.jpg`;
      img.alt = "";
      img.loading = "lazy";
      a.appendChild(img);
    }
    const span = doc.createElement("span");
    span.textContent = run.title || run.video_id || `#${run.run_id}`;
    a.appendChild(span);
    root.appendChild(a);
  }
  root.hidden = !root.children.length;
  return root.children.length;
}
