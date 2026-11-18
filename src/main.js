// web/src/main.js
import { withFrames } from "./frames.js?v=4d60deaed2";
import { computeOverlayState, pollRunStatus } from "./overlay.js?v=4d60deaed2";
import { wireFlagIconClick } from "./popup.js?v=4d60deaed2";
import { t } from "./i18n.js?v=4d60deaed2";
import { mergeDelta, visibleClaims, withVisibleClaims } from "./progress.js?v=4d60deaed2";

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
//
// Progressive delivery (spec §4.5): while a *streaming* run is pending or
// running, every /status body goes to `onProgress(body)` (frontier, counters)
// and the claims found so far are shown at once: the first time with
// GET /runs/{id}?provisional=1, then -- only when the status `rev` grew --
// with GET /runs/{id}/delta?since_rev=K, merged by id into a copy of the run
// (a new claims array, so the overlay's schedule cache is rebuilt). Each
// time `onRunProgress(run, changes)` is called ({first, added, changed,
// revised, removed}); the flag overlay starts with the first claim. At
// complete/failed the full run is fetched once and `onRunLoaded(run)` is
// called as before (the page updates what it already shows).
// `onStatus(body)` gets every /status body until then, whatever the run (the
// playback gate decides from it whether to show «Готовим агента…»).
export function bootstrapPlayerPage({
  player,
  fetchImpl,
  runId,
  pollIntervalMs,
  domRefs,
  onRunLoaded,
  onRunUpdated,
  onRunProgress,
  onProgress,
  onStatus,
  tagsPollIntervalMs = 5000,
}) {
  let flagLoopIntervalId = null;
  let latestRun = null;
  let stopPolling = null;
  let finished = false; // a terminal status was seen and the full run is being/has been fetched
  let stopped = false;
  let tagsTimer = null;
  let flagLoopStarted = false;
  let syncing = false; // a provisional / delta request is in flight

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

  // The overlay loop and the icon clicks: wired once, on the first chunk of
  // a streaming run or when a finished run loads.
  function ensureFlagLoop() {
    // Claim text, arguments and explanations are in the caption track's language.
    if (latestRun.caption_language) {
      domRefs.popupContainer.lang = latestRun.caption_language;
    }
    applyOverlayState();
    if (flagLoopStarted) return;
    flagLoopStarted = true;
    flagLoopIntervalId = setInterval(applyOverlayState, FLAG_LOOP_INTERVAL_MS);
    wireFlagIconClick(domRefs.flagIcon, domRefs.chainIcon, player, domRefs.popupContainer, currentOverlayState);
  }

  function startFlagLoop(loaded) {
    // Each finding once (no superseded claim, no repeat merged into another).
    const run = withVisibleClaims(loaded);
    latestRun = run;
    if (run.status === "failed" && run.error && domRefs.failedIndicator) {
      domRefs.failedIndicator.textContent = `${t("analysisFailed", run.caption_language)}: ${run.error}`;
    }
    ensureFlagLoop();
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
        .then((run) => (run && run.status === "complete" ? withFrames(fetchImpl, run) : run))
        .then((run) => {
          if (stopped) return;
          if (!run || run.status !== "complete" || run.tags_status === "running") {
            pollTags();
            return;
          }
          latestRun = withVisibleClaims(run);
          if (onRunUpdated) {
            try {
              onRunUpdated(latestRun);
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
  //
  // A streaming run shown live that then failed: ask for its provisional
  // view -- the plain one has no claims for a failed run -- so the claims
  // already on screen settle (unfinished checks come back as failed, grey
  // «?») instead of staying «проверяется» forever.
  function fetchFullRun(status) {
    const shownLive = latestRun !== null && latestRun.rev !== undefined;
    const url = status === "failed" && shownLive ? `/runs/${runId}?provisional=1` : `/runs/${runId}`;
    Promise.resolve()
      .then(() => fetchImpl(url))
      .then((r) => {
        if (!r.ok) throw new Error(`GET ${url} returned ${r.status}`);
        return r.json();
      })
      // Video frames (thumbnails, «На экране», screen marks): optional.
      .then((run) => (run && run.status === "complete" ? withFrames(fetchImpl, run) : run))
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

  function notify(callback, ...args) {
    if (!callback) return;
    try {
      callback(...args);
    } catch (err) {
      console.error("player callback failed", err);
    }
  }

  // A streaming run in progress: load its claims so far once, then only
  // what changed whenever the status rev grows. One request at a time.
  function syncLive(body) {
    if (syncing) return;
    // The provisional view of a new video's run can come before its captions
    // (caption_language null): take the language from the status once it is
    // known, so the list, the narrator and the progress line speak it.
    const language = body?.caption_language ?? null;
    if (latestRun && language && latestRun.caption_language !== language) {
      latestRun = { ...latestRun, caption_language: language };
      notify(onRunProgress, latestRun, { first: false, added: [], changed: [], revised: [], removed: [] });
    }
    const heldRev = latestRun ? Number(latestRun.rev) || 0 : null;
    if (heldRev !== null && !(Number(body.rev) > heldRev)) return;
    syncing = true;
    const url = heldRev === null ? `/runs/${runId}?provisional=1` : `/runs/${runId}/delta?since_rev=${heldRev}`;
    Promise.resolve()
      .then(() => fetchImpl(url))
      .then((r) => {
        if (!r || !r.ok) throw new Error(`GET ${url} returned ${r ? r.status : "nothing"}`);
        return r.json();
      })
      .then((data) => {
        if (stopped || finished) return;
        let changes;
        if (heldRev === null) {
          const claims = visibleClaims(data.claims ?? []);
          latestRun = { ...data, claims, rev: Number(data.rev) || 0 };
          changes = { first: true, added: claims, changed: [], revised: [], removed: [] };
        } else {
          const merged = mergeDelta(latestRun, data);
          latestRun = merged.run;
          changes = { first: false, added: merged.added, changed: merged.changed, revised: merged.revised, removed: merged.removed };
        }
        if (latestRun.claims.length) ensureFlagLoop();
        notify(onRunProgress, latestRun, changes);
      })
      .catch((err) => console.warn("Live claims update failed; retrying", err))
      .finally(() => {
        syncing = false;
      });
  }

  function handleStatus(status, body) {
    if (finished || stopped) return;
    // Every status body (the start gate and the auto-pause read it, spec §4.5).
    notify(onStatus, body);
    if (status === "pending" || status === "running") {
      if (body?.streaming) {
        notify(onProgress, body);
        syncLive(body);
      }
      if (!flagLoopStarted) domRefs.overlayContainer.dataset.mode = "processing";
      return;
    }
    if (status !== "complete" && status !== "failed") {
      return; // unknown status: keep polling
    }
    finished = true;
    haltPolling();
    fetchFullRun(status);
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
