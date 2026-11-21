// web/src/demoShim.js
//
// Loaded (as a classic script, before the modules) only in the static public
// demo built by scripts/build_demo.py. It turns the player into a read-only
// viewer of pre-exported analyses: every API GET the page makes is answered
// from the JSON files under data/, and anything else (POST, unknown paths) is
// refused locally -- the demo talks to no backend and accepts nothing.
(function () {
  const realFetch = window.fetch.bind(window);
  // The site root: the folder above this script (<root>/src/demoShim.js). The data
  // files (data/...) are fetched from there, whichever page folder (player/,
  // watch/, sources/...) loaded the shim.
  const SITE_ROOT = (() => {
    try {
      return new URL("../", document.currentScript.src).href;
    } catch {
      return "";
    }
  })();
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  // The /status fields of a complete run with nothing left to deliver.
  const completeProgress = (d) => ({
    streaming: false,
    phase: null,
    duration_sec: d?.duration_sec ?? null,
    processed_until_sec: d?.duration_sec ?? null,
    verified_until_sec: d?.duration_sec ?? null,
    ready_ranges: d?.duration_sec != null ? [[0, d.duration_sec]] : [],
    rev: 0,
    claims_so_far: d?.claim_count ?? 0,
    pending_count: 0,
    chunks_total: 0,
    chunks_done: 0,
    eta_first_chunk_sec: null,
    resume_at: null,
    refine_status: null,
  });

  // A run just published by the public request queue (the request page
  // opens player/?run_id=N&v=<time>): GitHub Pages lets files be cached
  // ~10 min and its servers update one by one, so with `v` every data file
  // is asked for with that cache-busting query, and the run's own files
  // are retried for a while on a 404 (not every server has them yet).
  // An Unlisted / Private analysis opened through watch/ (accounts, spec
  // 2026-11-18-accounts §2a): player/?run_id=N&solo=1&watch=1, with the
  // manifest {run_id, files: {"N.json": <signed URL>, …}, expires_at, back}
  // that watch/ put in sessionStorage. That run's data files come from
  // the signed Storage URLs (never from data/: they are not on this site).
  // An expired manifest, or a signed URL the bucket refuses, goes back to
  // watch/ (it checks access again and signs anew) -- at most once a
  // minute, so a refused link cannot loop.
  const query = new URLSearchParams(window.location.search);
  const watch = (() => {
    const runId = query.get("run_id");
    if (query.get("watch") !== "1" || !/^\d{1,10}$/.test(runId ?? "")) return null;
    try {
      const m = JSON.parse(window.sessionStorage.getItem(`nobs.watch.${runId}`) || "null");
      return m && String(m.run_id) === runId && m.files && typeof m.files === "object" ? m : null;
    } catch {
      return null;
    }
  })();
  function watchBack() {
    const key = `nobs.watch.bounce.${watch.run_id}`;
    try {
      const last = Number(window.sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 60000) return;
      window.sessionStorage.setItem(key, String(Date.now()));
      const back = new URL(String(watch.back ?? ""), window.location.href);
      if (back.origin === window.location.origin && /\/watch(?:\.html|\/|\/index\.html)$/.test(back.pathname)) window.location.replace(back.toString());
    } catch {
      // no way back: the page shows what it could load
    }
  }
  function watchFetch(path) {
    const name = path.slice("data/runs/".length);
    const signed = Object.prototype.hasOwnProperty.call(watch.files, name) ? watch.files[name] : null;
    if (typeof signed !== "string" || !/^https:\/\//.test(signed)) return Promise.resolve(json({ detail: "not in this analysis" }, 404));
    const expires = Date.parse(watch.expires_at ?? "");
    if (Number.isFinite(expires) && Date.now() >= expires) {
      watchBack();
      return Promise.resolve(json({ detail: "link expired" }, 404));
    }
    return realFetch(signed).then((r) => {
      if (r.status === 400 || r.status === 401 || r.status === 403) watchBack();
      return r;
    });
  }

  const freshParam = watch ? null : query.get("v");
  const fresh = freshParam && /^\d{1,16}$/.test(freshParam) ? freshParam : null;
  function dataFetch(path, tries = fresh ? 8 : 1) {
    if (watch && path.startsWith(`data/runs/${watch.run_id}.`)) return watchFetch(path);
    const file = SITE_ROOT + path;
    const url = fresh ? `${file}?v=${fresh}${tries < 8 ? `-${tries}` : ""}` : file;
    return realFetch(url).then((r) =>
      r.status === 404 && tries > 1 ? new Promise((ok) => setTimeout(ok, 4000)).then(() => dataFetch(path, tries - 1)) : r,
    );
  }

  window.fetch = function demoFetch(input, init) {
    const requestMethod = typeof input === "object" && input !== null ? input.method : undefined;
    const method = String(init?.method ?? requestMethod ?? "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url ?? "");
    // Absolute URLs (the public request queue Worker, the published data
    // the request page waits for, YouTube) are real requests.
    if (!url.startsWith("/")) return realFetch(input, init);
    let m;
    // The flag narrator's texts (exported by build_demo.py), per commentator:
    // «душнила» (style casual or dushnila) from voice-casual.json, another
    // built-in persona from voice-<id>.json (only exported once the owner
    // reviewed it), anything else has none. POST (start a generation)
    // answers like GET: whatever was exported is all there is. A file of the
    // older format (texts only) gets its claim items added.
    if ((m = url.match(/^\/runs\/(\d+)\/voice-texts(?:\?(.*))?$/)) && (method === "GET" || method === "POST")) {
      const style = new URLSearchParams(m[2] ?? "").get("style") ?? "casual";
      const none = { run_id: Number(m[1]), style, status: "none", texts: {}, items: [] };
      const file = style === "casual" || style === "dushnila" ? "casual" : style !== "normal" && /^[a-z][a-z0-9-]{1,31}$/.test(style) ? style : null;
      if (!file) return Promise.resolve(json(none));
      return dataFetch(`data/runs/${m[1]}.voice-${file}.json`)
        .then((r) => (r.ok ? r.json() : none))
        .catch(() => none)
        .then((body) => {
          const texts = body?.texts && typeof body.texts === "object" ? body.texts : {};
          const items = Array.isArray(body?.items)
            ? body.items
            : Object.entries(texts).map(([id, text]) => ({ kind: "claim", claim_id: Number(id), at_sec: null, text }));
          return json({ ...body, style, texts, items });
        });
    }
    // The commentator profiles (read-only here; the management page shows
    // them without any way to change them).
    if (url === "/commentators" || url === "/commentators?all=1") {
      if (method !== "GET") return Promise.resolve(json({ detail: "read-only demo" }, 405));
      return dataFetch("data/commentators.json");
    }
    if (url === "/commentators/meta" && method === "GET") return dataFetch("data/commentators-meta.json");
    if (method !== "GET") return Promise.resolve(json({ detail: "read-only demo" }, 405));
    // No local Silero voice here; the player uses in-browser voices.
    if (url === "/voice/health") return Promise.resolve(json({ ok: false }));
    // No local engines either (Carmit, Pocket): Hebrew uses the browser's voice.
    if (url === "/voice/engines") return Promise.resolve(json({}));
    if (url === "/runs") return dataFetch("data/runs.json");
    // The home page's instant search (claims' text; src/homeSearch.js).
    if (url === "/search-index") return dataFetch("data/search-index.json");
    // Which finding filters the player offers, as the owner set them at build time.
    if (url === "/ui-config") return dataFetch("data/ui-config.json");
    // Every demo run is complete: its status carries the progressive-delivery
    // fields as a finished run has them (files exported before they existed
    // lack them), and its delta never has anything new.
    if ((m = url.match(/^\/runs\/(\d+)\/status$/))) {
      return dataFetch(`data/runs/${m[1]}.status.json`).then((r) =>
        r.ok ? r.json().then((d) => json({ ...completeProgress(d), ...d })) : r,
      );
    }
    if ((m = url.match(/^\/runs\/(\d+)\/delta(?:\?(.*))?$/))) {
      const runId = Number(m[1]);
      const since = Number(new URLSearchParams(m[2] ?? "").get("since_rev") ?? 0) || 0;
      return dataFetch(`data/runs/${runId}.status.json`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
        .then((d) => {
          const progress = { ...completeProgress(d), ...d };
          return json({
            run_id: runId,
            rev: Math.max(Number(progress.rev) || 0, since),
            since_rev: since,
            streaming: Boolean(progress.streaming),
            status: progress.status ?? "complete",
            phase: null,
            processed_until_sec: progress.processed_until_sec,
            verified_until_sec: progress.verified_until_sec,
            ready_ranges: progress.ready_ranges,
            claims: [],
            relations: [],
            chunks: [],
          });
        });
    }
    if ((m = url.match(/^\/runs\/(\d+)\/events(?:\?after=(\d+))?$/))) {
      const after = Number(m[2] ?? 0);
      return dataFetch(`data/runs/${m[1]}.events.json`)
        .then((r) => r.json())
        .then((d) => json({ events: (d.events ?? []).filter((e) => e.id > after) }));
    }
    if ((m = url.match(/^\/runs\/(\d+)\/captions$/))) return dataFetch(`data/runs/${m[1]}.captions.json`);
    if ((m = url.match(/^\/runs\/(\d+)\/scoops$/))) return dataFetch(`data/runs/${m[1]}.scoops.json`);
    // Effort modes: a run's effort and its video's served run (build_demo.py
    // writes one for every exported run and for each run a deep one replaced).
    if ((m = url.match(/^\/runs\/(\d+)\/served$/))) return dataFetch(`data/runs/${m[1]}.served.json`);
    // Video frames: observations and a small set of evidence thumbnails (data/frames/).
    if ((m = url.match(/^\/runs\/(\d+)\/frames$/))) return dataFetch(`data/runs/${m[1]}.frames.json`);
    if ((m = url.match(/^\/runs\/(\d+)(?:\?.*)?$/))) return dataFetch(`data/runs/${m[1]}.json`);
    if (url.startsWith("/")) return Promise.resolve(json({ detail: "not in the demo" }, 404));
    return realFetch(input, init);
  };
  document.documentElement.dataset.demo = "1";
})();
