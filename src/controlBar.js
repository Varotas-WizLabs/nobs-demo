// YouTube IFrame API player states (YT.PlayerState), duplicated here so this
// module stays testable without the real API loaded.

import { seekTarget } from "./settings.js?v=99de0217ce";
import { t } from "./i18n.js?v=99de0217ce";
import { claimState, isUnchecked } from "./progress.js?v=99de0217ce";
import { canFullscreen } from "./mobile.js?v=99de0217ce";
export const PLAYER_STATE = Object.freeze({
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
});

// True when the player is playing or about to (buffering mid-playback).
export function isPlayerActive(player) {
  const state = player.getPlayerState();
  return state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING;
}

// Seek bar resolution: the range input runs 0..SEEK_STEPS, so a long video
// still seeks in fine increments (1 hour -> 3.6s steps).
const SEEK_STEPS = 1000;
const PROGRESS_INTERVAL_MS = 250;

const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
  volume: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
  muted: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>',
  // A head speaking (sound waves from the mouth): the flag narrator, distinct
  // from the volume speaker next to it.
  voice: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M9 13c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm6.76-9.64-1.68 1.69c.84 1.18.84 2.71 0 3.89l1.68 1.69c2.02-2.02 2.02-5.07 0-7.27zM20.07 2l-1.63 1.63c2.77 3.02 2.77 7.56 0 10.74L20.07 16c3.9-3.89 3.91-9.95 0-14z"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 0h2v5h-5v-2h3z"/></svg>',
};

function makeButton(className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  return button;
}

// buildControlBar creates a custom control bar for a YouTube IFrame player.
//
// `player` is any object exposing playVideo(), pauseVideo(), getPlayerState(),
// seekTo(seconds, allowSeekAhead), setVolume(volume), getVolume(), mute(), unMute(),
// isMuted(), getDuration(), getCurrentTime(). `container` is the DOM element the control
// bar elements are appended to (and the element fullscreen is requested on).
//
// Play/pause decides what to do from player.getPlayerState() at click time (never a
// cached boolean), so clicks on the video surface, popups pausing/resuming, buffering
// and the video ending can't knock it out of step. The caller forwards the IFrame API's
// onStateChange events to the returned setPlayerState() so the button glyph follows the
// real player. The seek bar shows playback progress (refreshed on a timer, skipped while
// the user drags it).
//
// Note: no quality-control button is included here on purpose — the YouTube IFrame API does
// not support controlling playback quality, so a quality button would be non-functional.
function formatClock(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// The commentator menu opens on a double click of the narrator button; a
// single click waits this long to be sure it is not the first of two.
export const DBLCLICK_MS = 250;
// Holding the button this long (touch, mouse) opens the menu too.
export const LONG_PRESS_MS = 500;
/** A contextmenu this soon after the menu opened is the same gesture (ignored). */
export const CONTEXTMENU_AFTER_OPEN_MS = 700;

// `options.onVoiceToggle()` (optional) is called when the flag-narrator
// button is clicked. That button sits right after the volume control and is
// hidden until setVoiceState({available: true, ...}) shows it.
//
// `options.onVoiceMenu()` (optional): the commentator menu. With it, a click
// toggles only after DBLCLICK_MS without a second click; a double click, a
// long press (LONG_PRESS_MS), a right click, or ArrowUp / Alt+ArrowDown /
// the ContextMenu key on the focused button open the menu instead and never
// toggle. `options.onVoiceGesture()` runs at once on every click (still
// inside the user gesture, so the page can unlock audio there).
export function buildControlBar(player, container, { onVoiceToggle, onVoiceMenu, onVoiceGesture } = {}) {
  const bar = document.createElement("div");
  bar.className = "nobs-control-bar";

  const playPause = makeButton("nobs-play-pause");
  function setPlayerState(state) {
    const active = state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING;
    playPause.innerHTML = active ? ICONS.pause : ICONS.play;
    playPause.setAttribute("aria-label", active ? "Pause" : "Play");
    updateProgress();
  }
  playPause.addEventListener("click", () => {
    if (isPlayerActive(player)) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  });

  const seekBar = document.createElement("input");
  seekBar.type = "range";
  seekBar.min = "0";
  seekBar.max = String(SEEK_STEPS);
  seekBar.step = "1";
  seekBar.value = "0";
  seekBar.className = "nobs-seek-bar";
  seekBar.setAttribute("aria-label", "Seek");

  // Playback time next to the timeline: "12:34 / 41:20".
  const time = document.createElement("span");
  time.className = "nobs-time";
  time.setAttribute("aria-live", "off");
  time.textContent = "0:00 / 0:00";
  let lastTimeText = "";
  function renderTime(current, duration) {
    const text = `${formatClock(current)} / ${formatClock(duration)}`;
    if (text !== lastTimeText) {
      lastTimeText = text;
      time.textContent = text;
    }
  }
  let dragging = false;
  seekBar.addEventListener("pointerdown", () => {
    dragging = true;
  });
  const endDrag = () => {
    dragging = false;
  };
  seekBar.addEventListener("pointerup", endDrag);
  seekBar.addEventListener("pointercancel", endDrag);
  seekBar.addEventListener("change", endDrag);
  seekBar.addEventListener("input", () => {
    const duration = player.getDuration();
    // Before metadata loads getDuration() is 0; a seek then would jump to 0.
    if (!(duration > 0)) return;
    player.seekTo((Number(seekBar.value) / SEEK_STEPS) * duration, true);
    renderTime((Number(seekBar.value) / SEEK_STEPS) * duration, duration);
  });

  // Flag markers on the timeline: one per claim, at its span, in its flag's
  // colour; clicking one seeks to the claim's start and plays. Laid out in
  // percent of the duration, so they wait until the duration is known.
  const seekWrap = document.createElement("div");
  seekWrap.className = "nobs-seek-wrap";
  const markerLayer = document.createElement("div");
  markerLayer.className = "nobs-seek-markers";
  // A second layer above the flags: presentation-tag marks outside any flag
  // (small diamonds) and ad-insert segments (a hatched band), each clickable
  // to seek -- a distinct look so they never read as flags.
  const tagLayer = document.createElement("div");
  tagLayer.className = "nobs-seek-tagmarks";
  // Under the flags, while a streaming run is analysed: how far the claims
  // are found ("extracted", a light band), which spans are fully checked
  // ("verified", darker bands, with a gap at a failed chunk) and the rest
  // still ahead of the analysis (hatched). Hidden for a finished run.
  const frontierLayer = document.createElement("div");
  frontierLayer.className = "nobs-seek-frontier";
  frontierLayer.setAttribute("aria-hidden", "true");
  frontierLayer.hidden = true;
  seekWrap.append(seekBar, frontierLayer, markerLayer, tagLayer);
  let frontier = null;
  let frontierLaidOut = false;
  let markerClaims = null;
  let markersLaidOut = false;
  let markerLang = "en";
  // One marker element per claim, kept across updates (keyed by claim id):
  // a claim that gets its verdict is recoloured in place, never redrawn.
  const markerEls = new Map();
  const markerClaim = new WeakMap();
  let timelineItems = null;
  let timelineLaidOut = false;

  function layoutTimelineItems() {
    if (!timelineItems || timelineLaidOut) return;
    const duration = player.getDuration();
    if (!(duration > 0)) return;
    timelineLaidOut = true;
    tagLayer.replaceChildren();
    for (const item of timelineItems) {
      const mark = document.createElement("button");
      mark.type = "button";
      mark.className = item.kind === "sponsored" ? "nobs-seek-segment" : "nobs-seek-tagmark";
      mark.dataset.kind = item.kind;
      if (item.tier) mark.dataset.tier = item.tier;
      // An ad segment's source: a SponsorBlock-only unconfirmed one is drawn fainter.
      if (item.source) mark.dataset.source = item.source;
      const start = Math.min(Math.max(item.start_sec / duration, 0), 1);
      const end = Math.min(Math.max((item.end_sec ?? item.start_sec) / duration, start), 1);
      mark.style.left = `${(start * 100).toFixed(3)}%`;
      if (item.kind === "sponsored") mark.style.width = `${((end - start) * 100).toFixed(3)}%`;
      mark.title = item.title ?? item.label ?? "";
      mark.setAttribute("aria-label", item.label ?? item.title ?? "");
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        player.seekTo(seekTarget(item.start_sec), true);
        player.playVideo();
        updateProgress();
      });
      tagLayer.appendChild(mark);
    }
  }

  function setTimelineItems(items) {
    timelineItems = [...(items ?? [])].sort((a, b) => a.start_sec - b.start_sec);
    timelineLaidOut = false;
    layoutTimelineItems();
  }

  function markerKey(claim) {
    return claim.id != null ? `id:${claim.id}` : `at:${claim.start_sec}:${claim.end_sec}:${claim.text ?? ""}`;
  }

  // A short ring pulse on a marker whose shown verdict changed (revised).
  function pulse(marker) {
    marker.classList.remove("is-revised");
    void marker.offsetWidth; // restart the animation
    marker.classList.add("is-revised");
  }

  function layoutMarkers() {
    if (!markerClaims || markersLaidOut) return;
    const duration = player.getDuration();
    if (!(duration > 0)) return;
    markersLaidOut = true;
    const keep = new Set();
    const ordered = [];
    for (const claim of markerClaims) {
      const key = markerKey(claim);
      if (keep.has(key)) continue;
      keep.add(key);
      const state = claimState(claim);
      let marker = markerEls.get(key);
      if (!marker) {
        marker = document.createElement("button");
        marker.type = "button";
        marker.className = "nobs-seek-marker";
        marker.addEventListener("click", (event) => {
          event.stopPropagation();
          const target = markerClaim.get(marker);
          if (!target) return;
          player.seekTo(seekTarget(target.start_sec), true);
          player.playVideo();
          updateProgress();
        });
        marker.addEventListener("animationend", () => marker.classList.remove("is-revised"));
        markerEls.set(key, marker);
      } else {
        const before = markerClaim.get(marker);
        const wasDone = before && claimState(before) === "done";
        if (wasDone && state === "done" && (before.flag ?? "") !== (claim.flag ?? "")) pulse(marker);
      }
      markerClaim.set(marker, claim);
      // pending: hollow grey with a pulse; checking: grey with an arc;
      // done: its flag colour (fades over); failed: grey «?».
      marker.dataset.flag = claim.flag ?? "";
      marker.dataset.state = state;
      if (claim.revised_from_flag) marker.dataset.revised = claim.revised_from_flag;
      else delete marker.dataset.revised;
      const start = Math.min(Math.max(claim.start_sec / duration, 0), 1);
      const end = Math.min(Math.max(claim.end_sec / duration, start), 1);
      marker.style.left = `${(start * 100).toFixed(3)}%`;
      marker.style.width = `${((end - start) * 100).toFixed(3)}%`;
      let label = `${formatClock(claim.start_sec)} ${claim.text ?? ""}`;
      if (isUnchecked(claim)) label = `${formatClock(claim.start_sec)} ${t("verdict.pending", markerLang)}: ${claim.text ?? ""}`;
      else if (state === "failed") label = `${formatClock(claim.start_sec)} ${t("verdict.failed", markerLang)}: ${claim.text ?? ""}`;
      marker.title = label;
      marker.setAttribute("aria-label", label);
      ordered.push(marker);
    }
    for (const [key, marker] of markerEls) {
      if (!keep.has(key)) {
        marker.remove();
        markerEls.delete(key);
      }
    }
    const children = [...markerLayer.children];
    if (children.length !== ordered.length || ordered.some((m, i) => children[i] !== m)) markerLayer.append(...ordered);
  }

  // `options.lang`: the run's language, for the labels of claims still
  // being checked. Markers are updated in place (see layoutMarkers).
  function setMarkers(claims, { lang } = {}) {
    if (lang) markerLang = lang;
    markerClaims = [...(claims ?? [])].sort((a, b) => a.start_sec - b.start_sec);
    markersLaidOut = false;
    layoutMarkers();
  }

  function band(className, from, to, duration) {
    const node = document.createElement("div");
    node.className = className;
    const start = Math.min(Math.max(from / duration, 0), 1);
    const end = Math.min(Math.max(to / duration, start), 1);
    node.style.left = `${(start * 100).toFixed(3)}%`;
    node.style.width = `${((end - start) * 100).toFixed(3)}%`;
    return node;
  }

  function layoutFrontier() {
    if (frontierLaidOut) return;
    if (!frontier) {
      frontierLaidOut = true;
      frontierLayer.hidden = true;
      frontierLayer.replaceChildren();
      return;
    }
    const duration = player.getDuration() > 0 ? player.getDuration() : Number(frontier.durationSec);
    if (!(duration > 0)) return;
    frontierLaidOut = true;
    const until = Math.min(Math.max(Number(frontier.processedUntil) || 0, 0), duration);
    const nodes = [band("nobs-frontier-extracted", 0, until, duration)];
    for (const [from, to] of frontier.readyRanges ?? []) {
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) nodes.push(band("nobs-frontier-verified", from, to, duration));
    }
    if (until < duration) nodes.push(band("nobs-frontier-ahead", until, duration, duration));
    frontierLayer.replaceChildren(...nodes);
    frontierLayer.hidden = false;
  }

  // The analysis frontier of a streaming run: `processedUntil` (seconds the
  // claims are found up to), `readyRanges` ([[from, to], ...] fully checked)
  // and `durationSec` (used until the player knows the duration). null
  // removes the bands (the run is finished).
  function setFrontier(next) {
    frontier = next ? { ...next } : null;
    frontierLaidOut = false;
    layoutFrontier();
  }

  function updateProgress() {
    if (dragging) return;
    const duration = player.getDuration();
    if (!(duration > 0)) return;
    layoutMarkers();
    layoutTimelineItems();
    layoutFrontier();
    const fraction = Math.min(Math.max(player.getCurrentTime() / duration, 0), 1);
    seekBar.value = String(Math.round(fraction * SEEK_STEPS));
    renderTime(player.getCurrentTime(), duration);
  }

  // Volume: an icon; clicking it opens a vertical slider above it. Sliding
  // to 0 mutes, sliding up unmutes. The icon shows "muted" when silent.
  const mute = makeButton("nobs-mute");
  mute.setAttribute("aria-haspopup", "true");
  mute.setAttribute("aria-expanded", "false");
  const volumePop = document.createElement("div");
  volumePop.className = "nobs-volume-pop";
  volumePop.hidden = true;
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = String(player.getVolume());
  volume.className = "nobs-volume";
  volume.setAttribute("orient", "vertical");
  volume.setAttribute("aria-label", "Volume");
  volume.setAttribute("aria-orientation", "vertical");
  const volumeWrap = document.createElement("div");
  volumeWrap.className = "nobs-volume-wrap";
  volumePop.append(volume);
  volumeWrap.append(volumePop, mute);

  let mutedNow = player.isMuted();
  function renderMuted(muted) {
    mutedNow = muted;
    const silent = muted || Number(volume.value) === 0;
    mute.innerHTML = silent ? ICONS.muted : ICONS.volume;
    mute.setAttribute("aria-label", silent ? "Volume (muted)" : "Volume");
  }
  function setPopOpen(open) {
    volumePop.hidden = !open;
    mute.setAttribute("aria-expanded", String(open));
  }
  mute.addEventListener("click", (event) => {
    event.stopPropagation();
    setPopOpen(volumePop.hidden);
  });
  volume.addEventListener("input", () => {
    const level = Number(volume.value);
    player.setVolume(level);
    if (level === 0 && !mutedNow) {
      player.mute();
      renderMuted(true);
    } else if (level > 0 && mutedNow) {
      player.unMute();
      renderMuted(false);
    } else {
      renderMuted(mutedNow);
    }
  });
  // A click anywhere else closes the slider.
  document.addEventListener("click", (event) => {
    if (!volumeWrap.contains(event.target)) setPopOpen(false);
  });

  // Flag narrator toggle (src/voice.js), next to the volume control. Hidden
  // until the page knows a voice exists for this run (setVoiceState).
  const voice = makeButton("nobs-voice-toggle");
  voice.innerHTML = ICONS.voice;
  voice.hidden = true;
  voice.setAttribute("aria-pressed", "false");
  let toggleTimer = null;
  let pressTimer = null;
  let suppressClick = false;
  let menuByClick = false;
  let menuOpenedAt = -Infinity;
  function cancelToggle() {
    if (toggleTimer !== null) {
      clearTimeout(toggleTimer);
      toggleTimer = null;
    }
  }
  function cancelPress() {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }
  function openMenu() {
    cancelToggle();
    menuOpenedAt = Date.now();
    onVoiceMenu?.();
  }
  voice.addEventListener("click", (event) => {
    event.stopPropagation();
    try {
      onVoiceGesture?.();
    } catch {
      // the page's unlock must never block the toggle
    }
    if (!onVoiceMenu) {
      onVoiceToggle?.();
      return;
    }
    if (suppressClick) {
      // The click ending a long press: the menu is already open.
      suppressClick = false;
      return;
    }
    if (toggleTimer !== null) {
      // Second click within the window: a double click.
      menuByClick = true;
      openMenu();
      return;
    }
    menuByClick = false;
    toggleTimer = setTimeout(() => {
      toggleTimer = null;
      onVoiceToggle?.();
    }, DBLCLICK_MS);
  });
  if (onVoiceMenu) {
    voice.setAttribute("aria-haspopup", "menu");
    voice.setAttribute("aria-expanded", "false");
    voice.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelToggle();
      if (!menuByClick) openMenu();
      menuByClick = false;
    });
    voice.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelPress();
      // Android Chrome fires contextmenu after a long press that has already
      // opened the menu: a second openMenu() would toggle it shut again.
      if (suppressClick || Date.now() - menuOpenedAt < CONTEXTMENU_AFTER_OPEN_MS) return;
      openMenu();
    });
    voice.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      cancelPress();
      suppressClick = false;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressClick = true;
        openMenu();
      }, LONG_PRESS_MS);
    });
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) voice.addEventListener(type, cancelPress);
    voice.addEventListener("keydown", (event) => {
      if (event.key === "ArrowUp" || event.key === "ContextMenu" || (event.key === "ArrowDown" && event.altKey)) {
        event.preventDefault();
        event.stopPropagation();
        openMenu();
      }
    });
  }
  /** The commentator menu opened / closed (aria-expanded on the button). */
  function setVoiceMenuOpen(open) {
    if (onVoiceMenu) voice.setAttribute("aria-expanded", String(Boolean(open)));
  }
  // `disabled`: shown but not usable (no voice for this run's language in
  // this browser); the title says why.
  function setVoiceState({ available = false, on = false, title = "", label = title, disabled = false } = {}) {
    // aria-disabled, not the disabled attribute: a disabled button shows no
    // tooltip in some browsers. The click handler ignores it (the page checks).
    voice.hidden = !available && !disabled;
    voice.setAttribute("aria-disabled", String(Boolean(disabled)));
    voice.setAttribute("aria-pressed", String(Boolean(on) && !disabled));
    voice.title = title;
    voice.setAttribute("aria-label", label);
  }

  const fullscreen = makeButton("nobs-fullscreen");
  fullscreen.innerHTML = ICONS.fullscreen;
  fullscreen.setAttribute("aria-label", "Fullscreen");
  // No Fullscreen API for a div (iPhone Safari): the container fills the
  // window instead ("nobs-pseudo-fs", styles.css); the same button or
  // Escape leaves it.
  function setPseudoFullscreen(on) {
    container.classList.toggle("nobs-pseudo-fs", on);
    document.documentElement.classList.toggle("nobs-pseudo-fs-open", on);
    fullscreen.setAttribute("aria-pressed", String(on));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && container.classList.contains("nobs-pseudo-fs")) setPseudoFullscreen(false);
  });
  fullscreen.addEventListener("click", () => {
    const current = document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
    const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
    if (current === container && exit) {
      exit.call(document);
    } else if (container.classList.contains("nobs-pseudo-fs")) {
      setPseudoFullscreen(false);
    } else if (canFullscreen(container)) {
      // The browser may refuse (no user activation, iframe policy); that is
      // not an error worth surfacing as an unhandled rejection.
      const request = container.requestFullscreen ?? container.webkitRequestFullscreen;
      Promise.resolve(request.call(container)).catch(() => {});
    } else {
      setPseudoFullscreen(true);
    }
  });

  setPlayerState(player.getPlayerState());
  renderMuted(player.isMuted());

  const progressIntervalId = setInterval(updateProgress, PROGRESS_INTERVAL_MS);
  function stop() {
    clearInterval(progressIntervalId);
    cancelToggle();
    cancelPress();
  }

  bar.append(playPause, seekWrap, time, volumeWrap, voice, fullscreen);
  container.appendChild(bar);

  return {
    playPause, seekBar, time, mute, volume, volumePop, voice, fullscreen, setPlayerState, updateProgress, setMarkers,
    upsertMarkers: setMarkers, setFrontier, setTimelineItems, setVoiceState, setVoiceMenuOpen, stop,
  };
}

// Run `callback` once the YouTube IFrame API is ready. The API calls
// window.onYouTubeIframeAPIReady exactly once, when its widget script loads; a
// deferred module script can be assigned after that has already happened (e.g.
// with a warm cache), so also check YT.loaded and fire immediately in that case.
export function whenYouTubeApiReady(win, callback) {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    callback();
  };
  const previous = win.onYouTubeIframeAPIReady;
  win.onYouTubeIframeAPIReady = function () {
    if (typeof previous === "function") previous();
    fire();
  };
  if (win.YT && win.YT.loaded) {
    fire();
  }
}

// Resolve the YouTube video id to play from player.html's query string.
//
// Every link into player.html that the app produces (the submit page's
// existing-run links and its redirects after submitting a URL or
// triggering a fresh run) only ever carries `run_id` -- `video_id` is not
// appended anywhere. So when `video_id` is absent, we resolve it from
// `run_id` via GET /runs/{run_id} before constructing the player. A direct
// `video_id` query param, if ever supplied, is honored as-is and skips the
// network round trip.
export async function resolveVideoId(params, fetchImpl) {
  const directVideoId = params.get("video_id");
  if (directVideoId) {
    return directVideoId;
  }

  const runId = params.get("run_id");
  if (!runId) {
    throw new Error("player.html requires a video_id or run_id query parameter");
  }

  const response = await fetchImpl(`/runs/${runId}`);
  if (!response.ok) {
    throw new Error(`Failed to resolve video id for run ${runId}: ${response.status}`);
  }
  const run = await response.json();
  return run.video_id;
}
