// web/src/overlay.js
import { findActiveClaim, findRelationsInvolvingClaim } from "./claimSync.js?v=8887b231d7";

export function computeOverlayState(run, currentTimeSec) {
  if (run.status !== "complete") {
    return {
      mode: run.status === "failed" ? "failed" : "processing",
      flagColor: null,
      showChain: false,
      activeClaim: null,
      activeRelations: [],
    };
  }

  const activeClaim = findActiveClaim(run.claims, currentTimeSec);
  const activeRelations = activeClaim ? findRelationsInvolvingClaim(run.relations, activeClaim.id) : [];

  return {
    mode: "flag",
    flagColor: activeClaim?.flag ?? null,
    showChain: activeRelations.length > 0,
    activeClaim,
    activeRelations,
  };
}

// Poll GET /runs/{runId}/status every intervalMs, calling onStatus(status)
// for each well-formed response. The next poll is scheduled only after the
// current request settles, so slow responses never overlap. Error responses
// (!ok), bodies without a string `status`, and network/parse failures are
// skipped and polling simply continues. Returns a stop function.
export function pollRunStatus(runId, fetchImpl, intervalMs, onStatus) {
  let stopped = false;
  let timeoutId = null;

  function schedule() {
    if (stopped) return;
    timeoutId = setTimeout(tick, intervalMs);
  }

  function tick() {
    timeoutId = null;
    Promise.resolve()
      .then(() => fetchImpl(`/runs/${runId}/status`))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => {
        if (!stopped && j && typeof j.status === "string") {
          onStatus(j.status);
        }
      })
      .catch((err) => {
        console.warn("Run status poll failed; retrying", err);
      })
      .finally(schedule);
  }

  schedule();

  return () => {
    stopped = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}
