// web/src/playbackGate.js
//
// Progressive delivery, the viewer's side of the frontier (spec 2026-11-17
// §4.5, step 5):
//
// * The start gate «Готовим агента…»: a layer over the video (inside
//   #player-container, so fullscreen too) while a new streaming run prepares
//   its first chunk. A checklist (captions, topics, the first two minutes:
//   found / checked), a bar from the server's ETA and the time waited. Ready
//   when the checks reach 1:30 (everything said before then has a verdict),
//   the first chunk is done, or 150 s passed. «▶ Смотреть, когда будет
//   готово» keeps the click's user activation and starts the video by itself
//   when ready; without it the button turns into «Смотреть ▶».
//   «Начать сейчас — метки догонят» starts at once.
// * Auto-pause at the frontier: while the run is analysed, playback that
//   reaches the checked part's end (3 s before it) pauses with «Агент
//   догоняет — проверяем 2 утверждения впереди… ~20 с» and the button
//   «Смотреть дальше без меток»; it plays on by itself once the checks are
//   20 s ahead (only a pause the gate made; never while a popup is open or
//   the narrator holds the video). A play started elsewhere while held (the
//   narrator's or a popup's resume) is paused again on the next tick; the
//   viewer's own Play (or the button) turns the auto-pause off until the next
//   seek. A seek past the frontier is allowed: the position is reported at
//   once (POST /runs/{id}/playhead; every 5 s otherwise) so the analysis
//   jumps there, and the pause says «Анализируем этот фрагмент ~40 с».
// * The subscription limit (phase 'throttled') is said as it is:
//   «Лимит подписки, продолжим в HH:MM».
// * A chunk whose extraction failed (`failed_ranges`; re-extracted in the
//   final pass) is never waited for: playback goes through it with the note
//   «Этот фрагмент не удалось разобрать, повторим в конце».
//
// Pure helpers first (tested on their own), then the controller.

import { formatTimecode } from "./claimSync.js?v=6b72ee8b93";
import { labelLanguage, t } from "./i18n.js?v=6b72ee8b93";
import { isUnchecked } from "./progress.js?v=6b72ee8b93";

export const TICK_MS = 500;
// The start gate opens when the checks reach this far (or after the wait).
export const GATE_READY_SEC = 90;
export const GATE_MAX_WAIT_SEC = 150;
// Auto-pause this long before the checked part ends; resume once the checks
// are this far ahead (hysteresis).
export const PAUSE_MARGIN_SEC = 3;
export const RESUME_AHEAD_SEC = 20;
// The start gate is not shown when the checks are already this far ahead.
export const JOIN_AHEAD_SEC = 90;
export const PLAYHEAD_EVERY_MS = 5000;
// A jump of the position this much beyond the playback's own progress is a seek
// (forward), or this much back; a narrator rewind (a few seconds) is not.
export const SEEK_FORWARD_SEC = 5;
export const SEEK_BACK_SEC = 15;
// Rough time of one round of parallel checks, for the «~20 с» estimate.
const ROUND_SEC = 20;
const POOL = 8;
const ANALYSE_SEC = 40;

const PLAYING = 1;
const BUFFERING = 3;

/** A streaming run still being analysed. */
export function isLiveStreaming(status) {
  return Boolean(status?.streaming) && (status.status === "pending" || status.status === "running");
}

function num(value) {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}

function spans(list) {
  return (list ?? []).filter((r) => Array.isArray(r) && r.length === 2);
}

/** The failed chunk's span [start, end] at `position`, or null. */
export function failedRangeAt(status, position) {
  if (!isLiveStreaming(status)) return null;
  const at = Number(position) || 0;
  return spans(status.failed_ranges).find(([start, end]) => start <= at && at < end) ?? null;
}

/**
 * How far from `position` everything is checked (or cannot be until the
 * final pass): the verified frontier when the position is before it,
 * extended through the verified spans that touch it (a chunk checked out of
 * order, after a seek) and through the spans of chunks whose extraction
 * failed (nothing to wait for there: they are retried at the end).
 * `position` itself when nothing at the position is checked; Infinity once
 * the run is complete.
 */
export function readyUntil(status, position) {
  if (!status) return position;
  if (status.status === "complete") return Infinity;
  let covered = Math.max(0, Number(position) || 0);
  const verified = num(status.verified_until_sec);
  if (verified !== null && verified >= covered) covered = verified;
  const ranges = [...spans(status.ready_ranges), ...spans(status.failed_ranges)]
    .sort((a, b) => a[0] - b[0]);
  for (const [start, end] of ranges) {
    if (start <= covered + 0.5 && end > covered) covered = end;
  }
  return covered;
}

/** The end of the video (Infinity while it is not known). */
function videoEnd(status) {
  const d = num(status?.duration_sec);
  return d !== null && d > 0 ? d : Infinity;
}

/**
 * Whether a page opening this run at `position` shows the start gate: a
 * streaming run still being analysed whose checks are not yet 90 s ahead of
 * the position (nor at the end of the video), and whose first chunk did not
 * fail (then there is nothing to wait for).
 */
export function startGateNeeded(status, position = 0) {
  if (!isLiveStreaming(status)) return false;
  if (status.first_chunk?.status === "failed") return false;
  const target = Math.min(position + JOIN_AHEAD_SEC, videoEnd(status));
  return readyUntil(status, position) < target;
}

/** The start gate may open: the checks are 90 s in (or at the end of a
 * shorter video), the first chunk is done or failed, the run is no longer
 * being analysed, or the viewer waited long enough. */
export function gateReady(status, waitedSec = 0) {
  if (waitedSec >= GATE_MAX_WAIT_SEC) return true;
  if (!isLiveStreaming(status)) return true;
  const chunk = status.first_chunk?.status;
  if (chunk === "verified" || chunk === "failed") return true;
  return readyUntil(status, 0) >= Math.min(GATE_READY_SEC, videoEnd(status));
}

/** The gate's checklist from a /status body. */
export function gateChecklist(status) {
  const chunk = status?.first_chunk ?? null;
  const captions = Number(status?.chunks_total) > 0;
  const found = Number(chunk?.claims) || 0;
  const verified = Number(chunk?.verified) || 0;
  const extracted = chunk !== null && chunk.status !== "queued" && chunk.status !== "extracting";
  return {
    captions,
    topics: Boolean(status?.topics_ready),
    extracted,
    found,
    verified,
    firstChunkDone: chunk?.status === "verified",
    firstChunkEnd: num(chunk?.end_sec) ?? 120,
  };
}

/** "HH:MM" (local time) of an ISO timestamp; "" when unreadable. */
export function clockTime(iso) {
  const date = new Date(iso ?? "");
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function fill(text, values) {
  return Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text);
}

function plural(lang, n, base) {
  const ru = String(labelLanguage(lang) ?? "").toLowerCase().startsWith("ru");
  if (!ru) return t(`${base}.${n === 1 ? "one" : "many"}`, lang);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return t(`${base}.one`, lang);
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t(`${base}.few`, lang);
  return t(`${base}.many`, lang);
}

/** The subscription-limit line, or null when the run is not throttled. */
export function throttledLine(status, lang = "en") {
  if (status?.phase !== "throttled") return null;
  const at = clockTime(status.resume_at);
  return at ? fill(t("gate.throttled", lang), { time: at }) : t("gate.throttledNoTime", lang);
}

/**
 * What the auto-pause says at `position`: the subscription limit; «Анализируем
 * этот фрагмент ~40 с» when the position is past what is extracted (a seek);
 * else «Агент догоняет — проверяем N утверждений впереди… ~S с» (the claims
 * still being checked from the position to where playback resumes).
 */
export function frontierMessage(status, claims, position, lang = "en") {
  const limit = throttledLine(status, lang);
  if (limit) return { kind: "throttled", text: limit };
  // Inside a failed chunk (not at its end, where the next part is what is
  // waited for): nothing is waited for here, it is retried at the end.
  const failed = failedRangeAt(status, position);
  if (failed && failed[1] > position + PAUSE_MARGIN_SEC) return { kind: "failed", text: t("gate.failedChunk", lang) };
  const processed = num(status?.processed_until_sec) ?? 0;
  const ready = readyUntil(status, position);
  const nearby = (claims ?? []).filter(
    (c) => isUnchecked(c) && c.end_sec >= position - PAUSE_MARGIN_SEC && c.start_sec <= position + RESUME_AHEAD_SEC
  );
  if (position >= processed && ready <= position + 0.5 && nearby.length === 0) {
    return { kind: "analysing", text: fill(t("gate.analysing", lang), { sec: ANALYSE_SEC }) };
  }
  const n = nearby.length;
  if (n === 0) return { kind: "catching", text: t("gate.catchingUp", lang) };
  const sec = Math.ceil(n / POOL) * ROUND_SEC;
  return {
    kind: "catching",
    text: fill(t("gate.catchingClaims", lang), { n, claims: plural(lang, n, "progress.claims"), sec }),
  };
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The gate for one run on the player page.
 *
 *   player       getCurrentTime(), getPlayerState(), playVideo(), pauseVideo()
 *   container    #player-container (the gate layer and the toast go in it)
 *   lang()       the language to speak
 *   postPlayhead(sec)  reports the viewer's position (POST /runs/{id}/playhead)
 *   isBusy()     true while a popup is open or the narrator holds the video:
 *                the gate then never resumes playback by itself
 *   now()        ms clock (tests)
 *
 * Feed it every /status body with update(status) and the claims shown with
 * setClaims(claims); call viewerPlay() when the viewer presses Play (capture
 * phase, before the control bar plays), onPlayerState(state) from the
 * player's onStateChange, finish() when the run completes or fails.
 */
export function createPlaybackGate({
  player,
  container,
  lang = () => "en",
  postPlayhead = () => {},
  isBusy = () => false,
  now = () => Date.now(),
  setIntervalImpl = (fn, ms) => setInterval(fn, ms),
  clearIntervalImpl = (id) => clearInterval(id),
  doc = container.ownerDocument,
}) {
  let status = null;
  let claims = [];
  let decided = false; // the start gate was shown or skipped
  let gateShownAt = null; // ms; null when the start gate is not up
  let armed = false; // «Смотреть, когда будет готово» pressed
  let held = false; // the auto-pause holds the video
  let override = false; // the viewer chose to watch on without the checks
  let finished = false;
  let lastTime = null;
  let lastTickAt = null;
  let lastPosted = null;
  let lastPostAt = -Infinity;
  let ownPlayUntil = 0; // ms: a PLAYING state before this is our own playVideo()
  let timer = null;
  let noticeShown = false; // the failed-chunk note is up (not a hold)

  // ---- DOM ----
  const gate = el(doc, "div", "nobs-gate");
  gate.hidden = true;
  gate.dataset.mode = "preparing";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-live", "polite");
  const card = el(doc, "div", "nobs-gate-card");
  const title = el(doc, "div", "nobs-gate-title");
  const list = el(doc, "ul", "nobs-gate-checklist");
  const bar = el(doc, "div", "nobs-gate-bar");
  const barFill = el(doc, "div", "nobs-gate-bar-fill");
  bar.appendChild(barFill);
  const meta = el(doc, "div", "nobs-gate-meta");
  const limit = el(doc, "div", "nobs-gate-limit");
  limit.hidden = true;
  const primary = el(doc, "button", "nobs-gate-primary");
  primary.type = "button";
  const skip = el(doc, "button", "nobs-gate-skip");
  skip.type = "button";
  card.append(title, list, bar, meta, limit, primary, skip);
  gate.appendChild(card);

  const toast = el(doc, "div", "nobs-gate-toast");
  toast.hidden = true;
  toast.setAttribute("role", "status");
  const toastText = el(doc, "span", "nobs-gate-toast-text");
  const toastButton = el(doc, "button", "nobs-gate-toast-button");
  toastButton.type = "button";
  toast.append(toastText, toastButton);
  container.append(gate, toast);

  primary.addEventListener("click", (event) => {
    event.stopPropagation();
    if (gateReady(status, waited())) startNow();
    else {
      armed = true;
      renderGate();
    }
  });
  skip.addEventListener("click", (event) => {
    event.stopPropagation();
    override = true; // the markers catch up; no auto-pause until a seek
    startNow();
  });
  toastButton.addEventListener("click", (event) => {
    event.stopPropagation();
    release(true);
  });

  // ---- helpers ----
  function time() {
    try {
      return Number(player.getCurrentTime()) || 0;
    } catch {
      return 0;
    }
  }
  function state() {
    try {
      return player.getPlayerState?.();
    } catch {
      return undefined;
    }
  }
  function play() {
    ownPlayUntil = now() + 1500;
    try {
      player.playVideo();
    } catch (err) {
      console.warn("[gate] could not play", err);
    }
  }
  function pause() {
    try {
      player.pauseVideo();
    } catch (err) {
      console.warn("[gate] could not pause", err);
    }
  }
  function waited() {
    return gateShownAt === null ? 0 : (now() - gateShownAt) / 1000;
  }
  function busy() {
    try {
      return Boolean(isBusy());
    } catch {
      return false;
    }
  }
  function post(sec, force = false) {
    if (!isLiveStreaming(status)) return;
    const at = now();
    if (!force && (at - lastPostAt < PLAYHEAD_EVERY_MS || (lastPosted !== null && Math.abs(sec - lastPosted) < 1))) return;
    lastPosted = sec;
    lastPostAt = at;
    try {
      const result = postPlayhead(Math.max(0, Math.round(sec * 10) / 10));
      result?.catch?.(() => {});
    } catch {
      // a hint only
    }
  }

  // ---- the start gate ----
  function renderGate() {
    if (gateShownAt === null) return;
    const language = lang();
    const check = gateChecklist(status);
    title.textContent = t("gate.title", language);
    list.replaceChildren();
    const item = (done, text) => {
      const li = el(doc, "li", done ? "is-done" : "");
      li.append(el(doc, "span", "nobs-gate-check", done ? "✓" : "…"), el(doc, "span", "", text));
      list.appendChild(li);
    };
    item(check.captions, t("gate.captions", language));
    item(check.topics || check.firstChunkDone, t("gate.topics", language));
    const min = Math.max(1, Math.round(check.firstChunkEnd / 60));
    const chunkText = check.extracted
      ? fill(t("gate.firstChunk", language), { min, found: check.found, verified: check.verified })
      : fill(t("gate.firstChunkSearching", language), { min });
    item(check.firstChunkDone, chunkText);
    // The bar: time waited against the time waited plus the server's ETA.
    const w = waited();
    const eta = num(status?.eta_first_chunk_sec);
    const ready = gateReady(status, w);
    const fraction = ready ? 1 : eta !== null ? w / Math.max(1, w + eta) : Math.min(0.95, w / GATE_MAX_WAIT_SEC);
    barFill.style.width = `${Math.round(Math.max(0.03, Math.min(1, fraction)) * 100)}%`;
    const parts = [fill(t("gate.waited", language), { time: formatTimecode(w) })];
    if (!ready && eta !== null && eta > 0) parts.push(fill(t("gate.eta", language), { sec: Math.round(eta) }));
    meta.textContent = parts.join(" · ");
    const limitText = throttledLine(status, language);
    limit.hidden = !limitText;
    limit.textContent = limitText ?? "";
    gate.dataset.ready = ready ? "1" : "0";
    primary.textContent = ready ? t("gate.watch", language) : armed ? t("gate.armed", language) : t("gate.watchWhenReady", language);
    primary.setAttribute("aria-pressed", armed && !ready ? "true" : "false");
    skip.textContent = t("gate.startNow", language);
    skip.hidden = ready;
  }

  function showGate() {
    gateShownAt = now();
    gate.hidden = false;
    if (state() === PLAYING || state() === BUFFERING) pause();
    renderGate();
  }

  function hideGate() {
    gateShownAt = null;
    gate.hidden = true;
  }

  function startNow() {
    hideGate();
    armed = false;
    play();
  }

  // ---- the auto-pause ----
  function showToast(position) {
    const message = frontierMessage(status, claims, position, lang());
    toast.dataset.kind = message.kind;
    toastText.textContent = message.text;
    toastButton.textContent = t("gate.watchWithout", lang());
    toastButton.hidden = false;
    toast.hidden = false;
    noticeShown = false;
  }

  // A note while playing through a failed chunk: nothing is held.
  function showNotice() {
    toast.dataset.kind = "failed";
    toastText.textContent = t("gate.failedChunk", lang());
    toastButton.hidden = true;
    toast.hidden = false;
    noticeShown = true;
  }

  function hideToast() {
    toast.hidden = true;
    noticeShown = false;
  }

  // The viewer takes over: no auto-pause until the next seek.
  function release(resume) {
    const wasHeld = held;
    held = false;
    override = true;
    hideToast();
    if (resume && wasHeld) play();
  }

  function tick() {
    if (finished) return;
    const position = time();
    const at = now();
    // A seek (the seek bar, the list, the scoops, the keyboard): the auto-pause
    // is on again and the analysis hears of the new position at once.
    if (lastTime !== null && lastTickAt !== null) {
      const expected = lastTime + (state() === PLAYING ? (at - lastTickAt) / 1000 : 0);
      if (position - expected > SEEK_FORWARD_SEC || expected - position > SEEK_BACK_SEC) {
        override = false;
        post(position, true);
      }
    }
    lastTime = position;
    lastTickAt = at;
    if (gateShownAt !== null) {
      renderGate();
      if (gateReady(status, waited()) && armed) startNow();
      return;
    }
    if (!isLiveStreaming(status)) {
      if (held) {
        held = false;
        hideToast();
        if (!busy()) play();
      }
      if (noticeShown) hideToast();
      return;
    }
    post(position);
    const end = videoEnd(status);
    const ready = readyUntil(status, position);
    const playing = state() === PLAYING || state() === BUFFERING;
    if (!held) {
      if (failedRangeAt(status, position)) {
        if (!noticeShown) showNotice();
      } else if (noticeShown) {
        hideToast();
      }
    }
    if (held) {
      if (ready >= Math.min(position + RESUME_AHEAD_SEC, end)) {
        if (busy()) return; // a popup or the narrator: wait for them
        held = false;
        hideToast();
        play();
        return;
      }
      showToast(position);
      // Someone else resumed the video (the narrator, a popup): pause it again.
      if (playing && at > ownPlayUntil) pause();
      return;
    }
    if (override || !playing) return;
    if (ready >= end - 0.5) return;
    if (position >= ready - PAUSE_MARGIN_SEC) {
      held = true;
      pause();
      showToast(position);
    }
  }

  function start() {
    if (timer === null) timer = setIntervalImpl(tick, TICK_MS);
  }

  return {
    /** A /status body of the run. */
    update(next) {
      if (finished || !next) return;
      status = next;
      // A run just created is pending before it says it streams: decide
      // once it does (or once it runs as a batch run, or has finished).
      if (!decided && !(next.status === "pending" && !next.streaming)) {
        decided = true;
        if (startGateNeeded(status, time()) && state() !== PLAYING) showGate();
      }
      if (gateShownAt !== null) {
        renderGate();
        if (gateReady(status, waited()) && armed) startNow();
      }
      start();
    },
    /** The claims shown (counts the ones being checked near the viewer). */
    setClaims(next) {
      claims = [...(next ?? [])];
    },
    /** The viewer pressed Play / Pause (capture phase): a press while held
     * or on the gate is the viewer taking over. */
    viewerPlay() {
      if (gateShownAt !== null) {
        override = true;
        hideGate();
        armed = false;
        return;
      }
      if (held) {
        held = false;
        override = true;
        hideToast();
      }
    },
    /** The player's onStateChange: a play while the start gate is up (not
     * the gate's own) is the viewer starting now. */
    onPlayerState(next) {
      if (next === PLAYING && gateShownAt !== null && now() > ownPlayUntil) {
        override = true;
        hideGate();
        armed = false;
      }
    },
    /** A seek made on this page (list, seek bar): report it at once. */
    seeked(sec) {
      override = false;
      lastTime = sec;
      lastTickAt = now();
      post(sec, true);
    },
    /** The run completed or failed: the gate goes, a held video plays on. */
    finish() {
      if (finished) return;
      finished = true;
      if (gateShownAt !== null) {
        hideGate();
        if (armed) play();
      }
      if (held) {
        held = false;
        hideToast();
        if (!busy()) play();
      }
      hideToast();
      if (timer !== null) {
        clearIntervalImpl(timer);
        timer = null;
      }
    },
    isHeld: () => held,
    isGateShown: () => gateShownAt !== null,
    destroy() {
      if (timer !== null) clearIntervalImpl(timer);
      timer = null;
      finished = true;
      gate.remove();
      toast.remove();
    },
    _tick: tick,
  };
}
