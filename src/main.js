// web/src/main.js
import { computeOverlayState, pollRunStatus } from "./overlay.js?v=4dd68439c6";
import { wireFlagIconClick } from "./popup.js?v=4dd68439c6";
import { t } from "./i18n.js?v=4dd68439c6";

const FLAG_LOOP_INTERVAL_MS = 500;

// bootstrapPlayerPage wires the control bar/overlay/popups together once the
// YouTube IFrame API reports onReady. It drives polling through Task 4's
// `pollRunStatus`, which hits the lightweight GET /runs/{runId}/status
// endpoint every pollIntervalMs -- not the full run resource -- so a
// pending/running run never pulls claims/relations over the wire on every
// tick. Per the "a run that is not complete must never be treated as having
// claims to render" constraint, the overlay only flips into a processing
// state while status is pending/running. Once the status flips away from
// pending/running to complete/failed, polling stops and the full
// /runs/{runId} resource is fetched exactly once (retried via polling if
// that fetch fails), seeding a loop that recomputes the flag/chain
// overlay state from the player's current playback position every
// FLAG_LOOP_INTERVAL_MS.
//
// `player` exposes getCurrentTime()/pauseVideo()/playVideo() (and whatever
// buildControlBar already wired up). `domRefs` is
// {flagIcon, chainIcon, popupContainer, overlayContainer, failedIndicator?};
// for a failed run, failedIndicator shows the reason the backend stored.
// `onRunLoaded(run)` (optional) is called once with the full run when it
// reaches complete/failed -- e.g. to build the claim list under the player.
// A complete run is shown at once while its presentation tags may still be
// computed (`tags_status: "running"`): the run is then re-fetched every
// `tagsPollIntervalMs` until the tags are done, and `onRunUpdated(run)` is
// called once with the tagged run (the overlay's popups use it too).
export function bootstrapPlayerPage({
  player,
  fetchImpl,
  runId,
  pollIntervalMs,
  domRefs,
  onRunLoaded,
  onRunUpdated,
  tagsPollIntervalMs = 5000,
}) {
  let flagLoopIntervalId = null;
  let latestRun = null;
  let stopPolling = null;
  let finished = false; // a terminal status was seen and the full run is being/has been fetched
  let stopped = false;
  let tagsTimer = null;

  function currentOverlayState() {
    return {
      ...computeOverlayState(latestRun, player.getCurrentTime()),
      claims: latestRun.claims ?? [],
      language: latestRun.caption_language ?? "en",
    };
  }

  function applyOverlayState() {
    const state = computeOverlayState(latestRun, player.getCurrentTime());
    domRefs.overlayContainer.dataset.mode = state.mode;
    domRefs.overlayContainer.dataset.flag = state.flagColor ?? "";
    domRefs.chainIcon.style.display = state.showChain ? "block" : "none";
  }

  function startFlagLoop(run) {
    latestRun = run;
    // Claim text, arguments and explanations are in the caption track's language.
    if (run.caption_language) {
      domRefs.popupContainer.lang = run.caption_language;
    }
    if (run.status === "failed" && run.error && domRefs.failedIndicator) {
      domRefs.failedIndicator.textContent = `${t("analysisFailed", run.caption_language)}: ${run.error}`;
    }
    applyOverlayState();
    flagLoopIntervalId = setInterval(applyOverlayState, FLAG_LOOP_INTERVAL_MS);
    wireFlagIconClick(domRefs.flagIcon, domRefs.chainIcon, player, domRefs.popupContainer, currentOverlayState);
    if (onRunLoaded) {
      try {
        onRunLoaded(run);
      } catch (err) {
        console.error("onRunLoaded failed", err);
      }
    }
  }

  function pollTags() {
    tagsTimer = setTimeout(() => {
      tagsTimer = null;
      if (stopped) return;
      Promise.resolve()
        .then(() => fetchImpl(`/runs/${runId}`))
        .then((r) => (r.ok ? r.json() : null))
        .then((run) => {
          if (stopped) return;
          if (!run || run.status !== "complete" || run.tags_status === "running") {
            pollTags();
            return;
          }
          latestRun = run;
          if (onRunUpdated) {
            try {
              onRunUpdated(run);
            } catch (err) {
              console.error("onRunUpdated failed", err);
            }
          }
        })
        .catch(() => {
          if (!stopped) pollTags();
        });
    }, tagsPollIntervalMs);
  }

  function startPolling() {
    stopPolling = pollRunStatus(runId, fetchImpl, pollIntervalMs, handleStatus);
  }

  function haltPolling() {
    if (stopPolling) {
      stopPolling();
      stopPolling = null;
    }
  }

  // Fetch the full run once. If the fetch fails (transient server error,
  // network), go back to polling so a later tick retries instead of leaving
  // the page stuck.
  function fetchFullRun() {
    Promise.resolve()
      .then(() => fetchImpl(`/runs/${runId}`))
      .then((r) => {
        if (!r.ok) throw new Error(`GET /runs/${runId} returned ${r.status}`);
        return r.json();
      })
      .then((run) => {
        if (stopped) return;
        if (run.status !== "complete" && run.status !== "failed") {
          throw new Error(`run ${runId} unexpectedly ${run.status}`);
        }
        startFlagLoop(run);
        if (run.status === "complete" && run.tags_status === "running") pollTags();
      })
      .catch((err) => {
        console.warn("Failed to load run; retrying", err);
        if (stopped) return;
        finished = false;
        startPolling();
      });
  }

  function handleStatus(status) {
    if (finished || stopped) return;
    if (status === "pending" || status === "running") {
      domRefs.overlayContainer.dataset.mode = "processing";
      return;
    }
    if (status !== "complete" && status !== "failed") {
      return; // unknown status: keep polling
    }
    finished = true;
    haltPolling();
    fetchFullRun();
  }

  startPolling();

  function stop() {
    stopped = true;
    haltPolling();
    if (tagsTimer !== null) {
      clearTimeout(tagsTimer);
      tagsTimer = null;
    }
    if (flagLoopIntervalId !== null) {
      clearInterval(flagLoopIntervalId);
      flagLoopIntervalId = null;
    }
  }

  return { stop };
}
