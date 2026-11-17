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
    if (url === "/runs") return realFetch("data/runs.json");
    if ((m = url.match(/^\/runs\/(\d+)\/status$/))) return realFetch(`data/runs/${m[1]}.status.json`);
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
