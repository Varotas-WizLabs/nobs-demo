// web/src/overlay.js
import { findActiveClaim, findRelationsInvolvingClaim } from "./claimSync.js?v=71942d6165";
import { claimState, isUnchecked } from "./progress.js?v=71942d6165";

// The overlay's state at `currentTimeSec`. A complete run shows its flags; a
// streaming run that is still pending/running shows the claims it has so far
// (spec §4.5): a claim still being checked shows the grey "pending" flag, a
// claim whose check failed the grey "failed" one. With no claims yet it is
// "processing"; a failed run is "failed".
export function computeOverlayState(run, currentTimeSec) {
  const live = (run.status === "pending" || run.status === "running") && (run.claims ?? []).length > 0;
  if (run.status !== "complete" && !live) {
    return {
      mode: run.status === "failed" ? "failed" : "processing",
      flagColor: null,
      showChain: false,
      activeClaim: null,
      activeRelations: [],
    };
  }

  const activeClaim = findActiveClaim(run.claims, currentTimeSec);
  const activeRelations = activeClaim ? findRelationsInvolvingClaim(run.relations ?? [], activeClaim.id) : [];
  let flagColor = activeClaim?.flag ?? null;
  if (activeClaim && isUnchecked(activeClaim)) flagColor = "pending";
  else if (activeClaim && claimState(activeClaim) === "failed") flagColor = "failed";

  return {
    mode: "flag",
    flagColor,
    showChain: activeRelations.length > 0,
    activeClaim,
    activeRelations,
  };
}

// Poll GET /runs/{runId}/status every intervalMs, calling onStatus(status,
// body) for each well-formed response (body: the whole /status answer, with
// a streaming run's frontier and rev). The next poll is scheduled only after the
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
          onStatus(j.status, j);
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
