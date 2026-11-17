// web/src/voice.js
//
// The flag narrator ("Озвучка флажков"). While it is on, every time playback
// reaches a flag -- one of the claims the claim list currently shows, or
// every flagged claim when no filter is set -- the video pauses, a short
// description of the flag is read aloud, and the video resumes when the
// voice has finished.
//
// The speech comes from the local voice sidecar through the backend proxy
// (GET /voice/say?text=..&lang=ru, a WAV). Generating it takes a moment, so
// each flag's audio is fetched LEAD_SEC seconds before playback reaches it.
//
// Rules:
// - A flag speaks when playback *crosses* its start (previous tick time <
//   start <= current time) while the video plays. A jump of more than
//   MAX_STEP_SEC (a seek) never speaks: it only re-arms, and the next flag
//   after the new position is fetched at once.
// - The narrator resumes the video only when it paused it itself and the
//   viewer has not touched the playback since (play/pause, a popup, a seek):
//   any of those cancels the narration and leaves playback to the viewer.
// - Audio not ready at the crossing: the video waits up to WAIT_MS for it;
//   when it does not come (or fails) the flag is skipped and the video goes on.
// - Speech volume: max(player volume, MIN_VOLUME) / 100, also when the
//   player is muted. A viewer who turned the narrator on wants to hear it,
//   and a muted or near-silent video must not make it inaudible.
// - Errors never show a dialog: they are logged once (console.warn) and the
//   narrator steps out of the way.
//
// Languages: only Russian has a voice for now. A new language is one entry in
// VOICES plus its "voice.*" strings in i18n.js.
//
// Autoplay: speech starts from a timer, never inside a user gesture, so the
// narrator keeps ONE long-lived audio element and unlocks it in a real gesture
// (narrator.unlock(): the toggle click, the play button, any click or key on
// the page). When the browser still refuses playback (NotAllowedError) the
// narrator marks itself blocked and stops pausing the video at flags until a
// gesture unlocks the element again -- no stutter at every flag.
//
// Memory: each flag's WAV (1-2 MB) is a blob URL; it is revoked once spoken,
// and on a seek every entry that is no longer near the playhead is dropped.
//
// The module is DOM-free apart from the Audio element it creates (injectable
// for tests), so it is tested with a fake player, fake fetch and fake audio.

import { t } from "./i18n.js";

export const LEAD_SEC = 5;
export const TICK_MS = 250;
export const WAIT_MS = 8000;
export const MAX_STEP_SEC = 2;
export const MIN_VOLUME = 30;
export const MAX_TEXT_CHARS = 300;
export const STORAGE_KEY = "nobs.voice";

// Run caption language (base code) -> voice language sent to /voice/say.
export const VOICES = Object.freeze({
  ru: { lang: "ru" },
});

// The voice for a run's caption language, or null when there is none.
export function voiceFor(captionLanguage) {
  const base = String(captionLanguage ?? "").split("-")[0].toLowerCase();
  return VOICES[base] ?? null;
}

const PLAYING = 1;
const BUFFERING = 3;
// A state event arriving this soon after the narrator paused the video is
// the tail of the playback it interrupted, not the viewer pressing play.
const STATE_GRACE_MS = 600;
// Small slack on the crossing test, for ticks that land right on the start.
const CROSS_EPS = 0.05;
// 10 ms of silence (8 kHz, 8-bit mono): played inside a gesture to unlock the
// audio element for later, timer-driven speech.
export const SILENT_WAV =
  "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

let warned = false;
function warnOnce(...args) {
  if (warned) return;
  warned = true;
  console.warn("[voice]", ...args);
}

// Shorten to at most `max` characters: at the last sentence end when that
// keeps a reasonable part, else at a word boundary, with an ellipsis.
export function capText(text, max = MAX_TEXT_CHARS) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentenceEnd >= max / 3) return head.slice(0, sentenceEnd + 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 3 ? head.slice(0, space) : head).replace(/[,;:.\s]+$/, "")}…`;
}

function firstSentence(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  const match = s.match(/^.*?[.!?…](?=\s|$)/);
  return match ? match[0] : s;
}

// What is said for one claim: "Красный флажок. <summary>".
export function spokenText(claim, lang = "ru") {
  const colour = ["red", "yellow", "green", "white"].includes(claim?.flag) ? claim.flag : "white";
  const label = t(`voice.flag.${colour}`, lang);
  const summary = String(claim?.summary ?? "").trim();
  const body = capText(summary || firstSentence(claim?.argument));
  return body ? `${label}. ${body}` : `${label}.`;
}

// True when GET /voice/health answers {"ok": true}; false on anything else.
export async function checkVoiceHealth(fetchImpl) {
  try {
    const response = await fetchImpl("/voice/health");
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

export function loadEnabled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveEnabled(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/**
 * @param {{
 *   player: {getCurrentTime(): number, getPlayerState(): number, pauseVideo(): void, playVideo(): void, getVolume?(): number},
 *   fetchImpl: typeof fetch,
 *   audioFactory?: () => {src: string, play(): any, pause(): void, volume: number, addEventListener(type: string, fn: Function): void},
 *   createObjectURL?: (blob: Blob) => string,
 *   revokeObjectURL?: (url: string) => void,
 *   now?: () => number,
 * }} options
 */
export function createNarrator({
  player,
  fetchImpl,
  audioFactory = () => new Audio(),
  createObjectURL = (blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url) => URL.revokeObjectURL(url),
  now = () => Date.now(),
}) {
  let enabled = false;
  let voice = null; // VOICES entry for the run's language
  let claims = [];
  let timer = null;
  let prevTime = null;
  // Claims already spoken in this pass over the video (cleared by a seek), so
  // a flag right at a tick boundary is never read twice.
  const fired = new Set();
  // claim id -> {text, promise, url, failed}
  const cache = new Map();

  // The narration in progress: {queue, audio, pausedByUs, pausedAt, waitTimer, token}
  let session = null;
  let sessionToken = 0;

  // The one audio element (created on first use) and who listens to it now.
  let element = null;
  let listener = null; // {onEnded, onError} of the speech playing now
  let srcGeneration = 0; // bumped on every src change, guards async unlock
  let unlocked = false;
  let blocked = false; // the browser refused playback: no pausing at flags

  function audioElement() {
    if (element) return element;
    element = audioFactory();
    element.addEventListener("ended", (event) => listener?.onEnded(event));
    element.addEventListener("error", (event) => listener?.onError(event));
    return element;
  }

  function isRefusal(err) {
    return err?.name === "NotAllowedError";
  }

  function isActive() {
    const state = player.getPlayerState();
    return state === PLAYING || state === BUFFERING;
  }

  function currentTime() {
    const time = Number(player.getCurrentTime());
    return Number.isFinite(time) ? time : 0;
  }

  function claimKey(claim) {
    return String(claim.id ?? `${claim.start_sec}:${claim.text ?? ""}`);
  }

  // ---- Audio fetching (cached per claim) ----
  function fetchAudio(claim) {
    const key = claimKey(claim);
    const text = spokenText(claim, voice?.lang ?? "ru");
    const known = cache.get(key);
    if (known && known.text === text) return known;
    if (known?.url) revokeObjectURL(known.url);
    const entry = { text, url: null, failed: false, promise: null };
    const lang = voice?.lang ?? "ru";
    entry.promise = Promise.resolve()
      .then(() => fetchImpl(`/voice/say?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`))
      .then((response) => {
        if (!response.ok) throw new Error(`voice/say HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cache.get(key) !== entry) return null; // torn down / replaced meanwhile
        entry.url = createObjectURL(blob);
        return entry.url;
      })
      .catch((err) => {
        entry.failed = true;
        warnOnce("speech fetch failed", err);
        return null;
      });
    cache.set(key, entry);
    return entry;
  }

  function prefetchAhead(time) {
    for (const claim of claims) {
      const ahead = claim.start_sec - time;
      if (ahead > 0 && ahead <= LEAD_SEC) fetchAudio(claim);
    }
  }

  function prefetchNext(time) {
    const next = claims.find((claim) => claim.start_sec > time);
    if (next) fetchAudio(next);
  }

  function dropEntry(key) {
    const entry = cache.get(key);
    if (!entry) return;
    if (entry.url) revokeObjectURL(entry.url);
    cache.delete(key);
  }

  // After a seek: keep only the audio for the next flag and the flags within
  // LEAD_SEC of the new position; everything else is freed.
  function pruneCache(time) {
    const keep = new Set();
    const next = claims.find((claim) => claim.start_sec > time);
    if (next) keep.add(claimKey(next));
    for (const claim of claims) {
      const ahead = claim.start_sec - time;
      if (ahead > 0 && ahead <= LEAD_SEC) keep.add(claimKey(claim));
    }
    if (session) for (const claim of session.queue) keep.add(claimKey(claim));
    for (const key of [...cache.keys()]) if (!keep.has(key)) dropEntry(key);
  }

  // ---- Narration ----
  function speechVolume() {
    let level = 100;
    try {
      level = Number(player.getVolume?.() ?? 100);
    } catch {
      level = 100;
    }
    if (!Number.isFinite(level)) level = 100;
    return Math.min(Math.max(level, MIN_VOLUME), 100) / 100;
  }

  function stopAudio(s) {
    if (s.waitTimer !== null) {
      clearTimeout(s.waitTimer);
      s.waitTimer = null;
    }
    if (s.audio) {
      listener = null;
      try {
        s.audio.pause();
      } catch {
        // already gone
      }
      s.audio = null;
    }
  }

  // End the narration. `resume`: play the video again if the narrator paused it.
  function finish(resume) {
    const s = session;
    if (!s) return;
    session = null;
    stopAudio(s);
    prevTime = currentTime();
    if (resume && s.pausedByUs) {
      try {
        player.playVideo();
      } catch (err) {
        warnOnce("could not resume the video", err);
      }
    }
  }

  function startSession(queue) {
    sessionToken += 1;
    session = { queue: [...queue], audio: null, pausedByUs: false, pausedAt: 0, waitTimer: null, token: sessionToken };
    try {
      player.pauseVideo();
      session.pausedByUs = true;
      session.pausedAt = now();
    } catch (err) {
      warnOnce("could not pause the video", err);
      session = null;
      return;
    }
    speakNext();
  }

  function speakNext() {
    const s = session;
    if (!s) return;
    const claim = s.queue.shift();
    if (!claim || blocked) {
      finish(true);
      return;
    }
    const key = claimKey(claim);
    const entry = fetchAudio(claim);
    if (entry.url) {
      play(s, entry.url, key);
      return;
    }
    if (entry.failed) {
      speakNext();
      return;
    }
    // Not ready yet: wait for it, at most WAIT_MS.
    let settled = false;
    s.waitTimer = setTimeout(() => {
      if (settled || session !== s) return;
      settled = true;
      s.waitTimer = null;
      speakNext();
    }, WAIT_MS);
    entry.promise.then((url) => {
      if (settled || session !== s) return;
      settled = true;
      clearTimeout(s.waitTimer);
      s.waitTimer = null;
      if (url) play(s, url, key);
      else speakNext();
    });
  }

  function play(s, url, key) {
    let audio;
    try {
      audio = audioElement();
      srcGeneration += 1;
      audio.src = url;
      audio.volume = speechVolume();
    } catch (err) {
      warnOnce("audio playback failed", err);
      speakNext();
      return;
    }
    s.audio = audio;
    let done = false;
    const next = () => {
      if (done || session !== s || s.audio !== audio) return;
      done = true;
      listener = null;
      s.audio = null;
      // Spoken (or unplayable): free its WAV. A seek back fetches it again.
      dropEntry(key);
      speakNext();
    };
    const refused = (err) => {
      if (isRefusal(err)) {
        // No user activation for this page: stop pausing at flags until a
        // gesture unlocks the element (unlock()).
        blocked = true;
        unlocked = false;
        warnOnce("audio playback refused by the browser; click the page or the voice button to allow it", err);
      } else {
        warnOnce("audio playback failed", err);
      }
      next();
    };
    listener = {
      onEnded: next,
      onError: (err) => {
        warnOnce("audio playback failed", err);
        next();
      },
    };
    try {
      const played = audio.play();
      if (played && typeof played.then === "function") {
        played.then(
          () => {
            unlocked = true;
            blocked = false;
          },
          refused
        );
      }
    } catch (err) {
      refused(err);
    }
  }

  // Play a moment of silence inside a user gesture, so the browser lets the
  // element play later from a timer. Cheap no-op once unlocked.
  function unlock() {
    if (unlocked && !blocked) return;
    if (session?.audio) return; // speaking right now: already playing
    let audio;
    try {
      audio = audioElement();
      srcGeneration += 1;
      audio.src = SILENT_WAV;
    } catch {
      return;
    }
    const generation = srcGeneration;
    try {
      const played = audio.play();
      const settle = () => {
        unlocked = true;
        blocked = false;
        // Pause only when no speech took the element over meanwhile.
        if (srcGeneration === generation) {
          try {
            audio.pause();
          } catch {
            // ignore
          }
        }
      };
      if (played && typeof played.then === "function") played.then(settle, () => {});
      else settle();
    } catch {
      // still locked; the next gesture tries again
    }
  }

  // ---- The playback tick ----
  function tick() {
    if (!enabled || !voice) return;
    const time = currentTime();
    if (session) {
      // The video plays again although the narrator holds it: the viewer
      // pressed play (or something else resumed it). Their call wins. Only
      // PLAYING counts: a BUFFERING tail after our pause (slow network) is not
      // the viewer taking over.
      if (player.getPlayerState() === PLAYING && now() - session.pausedAt > STATE_GRACE_MS) finish(false);
      prevTime = time;
      return;
    }
    const prev = prevTime;
    prevTime = time;
    if (!isActive()) return;
    if (prev === null) {
      prefetchAhead(time);
      return;
    }
    const step = time - prev;
    if (step < 0 || step > MAX_STEP_SEC) {
      // A seek: re-arm from the new position and get the next flag ready.
      fired.clear();
      // Failed speech is retried after a seek (not on every tick).
      for (const [key, entry] of cache) if (entry.failed) cache.delete(key);
      pruneCache(time);
      prefetchNext(time);
      prefetchAhead(time);
      return;
    }
    const crossed = claims.filter(
      (claim) => claim.start_sec > prev && claim.start_sec <= time + CROSS_EPS && !fired.has(claimKey(claim))
    );
    prefetchAhead(time);
    if (crossed.length) {
      for (const claim of crossed) fired.add(claimKey(claim));
      // Playback refused by the browser: do not pause for speech that
      // cannot be heard; just free the audio.
      if (blocked) for (const claim of crossed) dropEntry(claimKey(claim));
      else startSession(crossed);
    }
  }

  function startTimer() {
    if (timer === null) timer = setInterval(tick, TICK_MS);
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function refreshRunning() {
    if (enabled && voice) {
      prevTime = null;
      startTimer();
      tick();
    } else {
      stopTimer();
      finish(true);
    }
  }

  return {
    /** The claims to read: the list the timeline markers show. */
    setClaims(list) {
      claims = [...(list ?? [])]
        .filter((claim) => claim && claim.flag && Number.isFinite(Number(claim.start_sec)))
        .sort((a, b) => a.start_sec - b.start_sec);
      // A claim speaking right now stays queued; later ones follow the filter.
      if (session) {
        const keep = new Set(claims.map(claimKey));
        session.queue = session.queue.filter((claim) => keep.has(claimKey(claim)));
      }
    },
    /** The run's caption language; narration only runs for a voiced one. */
    setLanguage(captionLanguage) {
      const next = voiceFor(captionLanguage);
      if (next !== voice) {
        voice = next;
        for (const entry of cache.values()) if (entry.url) revokeObjectURL(entry.url);
        cache.clear();
      }
      refreshRunning();
    },
    supports(captionLanguage) {
      return voiceFor(captionLanguage) !== null;
    },
    setEnabled(on) {
      enabled = Boolean(on);
      refreshRunning();
    },
    isEnabled() {
      return enabled;
    },
    isSpeaking() {
      return session !== null;
    },
    /** Forward the YouTube player's onStateChange here. */
    onPlayerState(state) {
      if (!session) return;
      if (state === PLAYING && now() - session.pausedAt > STATE_GRACE_MS) finish(false);
    },
    /** Call from a user gesture (click / key): lets the timer-driven speech
     * play later, and lifts a "blocked" state left by a refused playback. */
    unlock,
    isBlocked() {
      return blocked;
    },
    /** The viewer touched the playback (play/pause, a popup, a seek): stop
     * speaking and never auto-resume. */
    interrupt() {
      finish(false);
    },
    tick,
    destroy() {
      stopTimer();
      finish(false);
      for (const entry of cache.values()) if (entry.url) revokeObjectURL(entry.url);
      cache.clear();
      enabled = false;
    },
  };
}
