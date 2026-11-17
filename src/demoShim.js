// web/src/demoShim.js
//
// Loaded (as a classic script, before the modules) only in the static public
// demo built by scripts/build_demo.py. It turns the player into a read-only
// viewer of pre-exported analyses: every API GET the page makes is answered
// from the JSON files under data/, and anything else (POST, unknown paths) is
// refused locally -- the demo talks to no backend and accepts nothing.
(function () {
  const realFetch = window.fetch.bind(window);
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

  window.fetch = function demoFetch(input, init) {
    const requestMethod = typeof input === "object" && input !== null ? input.method : undefined;
    const method = String(init?.method ?? requestMethod ?? "GET").toUpperCase();
    const url = typeof input === "string" ? input : String(input?.url ?? "");
    let m;
    // The flag narrator's texts (exported by build_demo.py). POST (start a
    // generation) answers like GET: whatever was exported is all there is.
    if ((m = url.match(/^\/runs\/(\d+)\/voice-texts(?:\?(.*))?$/)) && (method === "GET" || method === "POST")) {
      const style = new URLSearchParams(m[2] ?? "").get("style") ?? "casual";
      const none = { run_id: Number(m[1]), style, status: "none", texts: {} };
      if (style !== "casual") return Promise.resolve(json(none));
      return realFetch(`data/runs/${m[1]}.voice-casual.json`)
        .then((r) => (r.ok ? r.json() : none))
        .catch(() => none)
        .then((body) => json(body));
    }
    if (method !== "GET") return Promise.resolve(json({ detail: "read-only demo" }, 405));
    // No local Silero voice here; the player uses in-browser voices.
    if (url === "/voice/health") return Promise.resolve(json({ ok: false }));
    // No local engines either (Carmit, Pocket): Hebrew uses the browser's voice.
    if (url === "/voice/engines") return Promise.resolve(json({}));
    if (url === "/runs") return realFetch("data/runs.json");
    // Every demo run is complete: its status carries the progressive-delivery
    // fields as a finished run has them (files exported before they existed
    // lack them), and its delta never has anything new.
    if ((m = url.match(/^\/runs\/(\d+)\/status$/))) {
      return realFetch(`data/runs/${m[1]}.status.json`).then((r) =>
        r.ok ? r.json().then((d) => json({ ...completeProgress(d), ...d })) : r,
      );
    }
    if ((m = url.match(/^\/runs\/(\d+)\/delta(?:\?(.*))?$/))) {
      const runId = Number(m[1]);
      const since = Number(new URLSearchParams(m[2] ?? "").get("since_rev") ?? 0) || 0;
      return realFetch(`data/runs/${runId}.status.json`)
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
      return realFetch(`data/runs/${m[1]}.events.json`)
        .then((r) => r.json())
        .then((d) => json({ events: (d.events ?? []).filter((e) => e.id > after) }));
    }
    if ((m = url.match(/^\/runs\/(\d+)\/captions$/))) return realFetch(`data/runs/${m[1]}.captions.json`);
    if ((m = url.match(/^\/runs\/(\d+)\/scoops$/))) return realFetch(`data/runs/${m[1]}.scoops.json`);
    if ((m = url.match(/^\/runs\/(\d+)(?:\?.*)?$/))) return realFetch(`data/runs/${m[1]}.json`);
    if (url.startsWith("/")) return Promise.resolve(json({ detail: "not in the demo" }, 404));
    return realFetch(input, init);
  };
  document.documentElement.dataset.demo = "1";
})();
