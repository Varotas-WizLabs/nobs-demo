// web/src/voice.js
//
// The flag narrator ("Озвучка флажков"). While it is on, every time playback
// reaches a flag -- one of the claims the claim list currently shows, or
// every flagged claim when no filter is set -- the video pauses, a short
// description of the flag is read aloud, and the video resumes when the
// voice has finished.
//
// The speech comes from an engine (voiceEngines.js): the local Silero sidecar
// (GET /voice/say), Piper generated in the browser, or the browser's own
// speech (Web Speech API). Blob engines produce a WAV; generating it takes a
// moment, so each flag's audio is requested LEAD_SEC seconds before playback
// reaches it (in order; Piper runs one request at a time). A speech engine
// speaks directly at the flag. While a blob engine is not ready (a Piper model
// still downloading) or its audio fails, the `fallback` speech engine (the
// system voice) speaks instead.
//
// Hooks for the page (the narrator touches no DOM): onHold(claim) when it
// pauses the video to speak, onItem(claim) as each flag's speech starts,
// onRelease({animate}) when the hold ends -- animate is true when it is about
// to resume the video itself, false when the viewer took over.
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
// Styles (settings "voiceStyle"): "normal" reads the claim's summary;
// "casual" (фривольный) reads a short friend-to-friend retelling generated per
// run by the backend (GET/POST /runs/{id}/voice-texts?style=casual, polled
// every TEXTS_POLL_MS while it runs). Until a claim's casual text exists, a
// colour opener ("Вот тут совсем не так.", in Hebrew "רגע, זה ממש לא ככה.")
// plus the summary stands in. Casual texts exist for Russian and Hebrew runs.
//
// Red flags (option errorCue): the narration of a red flag opens with a short
// "error" sound effect (two descending bell tones, in the spirit of a desktop
// error alert; synthesized with Web Audio, no recording) instead of the key
// click. The click stands in when Web Audio is unavailable.
//
// Speech plays SPEECH_RATE times faster than generated, pitch preserved.
//
// Commentators (personas, src/commentators.js): createNarrator({persona}) /
// setPersona(profile). «Душнила» (the default, persona null or id dushnila)
// behaves exactly as above (voiceStyle still picks casual / normal). Another
// persona: its own texts (voice-texts?style=<id>), the flag colours it stops
// at (triggers.flags), scoop stops at the server's at_sec (triggers.scoops),
// "only N" / min gap between stops (selectStops), its speech rate
// (RATE_BY_LEVEL[speech_rate]) and its entry / exit sounds. A parody persona
// speaks generated lines only: a stop without one is no stop at all (G6).
// A unit of narration is a "stop": {kind: "claim", claim} or {kind: "scoop",
// item}; the hooks get {kind, flag, ...claim, claim | scoop, persona}.
//
// Languages: Russian and Hebrew (caption code "iw" is Hebrew too). A new
// language is one entry in VOICES (plus OPENERS_BY_LANG for casual) and its
// engines in voiceEngines.js.
//
// Autoplay: speech starts from a timer, never inside a user gesture, so the
// narrator keeps ONE long-lived audio element and unlocks it in a real gesture
// (narrator.unlock(): the toggle click, the play button, any click or key on
// the page; touch: pointerup / touchend, the events that count as a gesture
// on a phone). The speech engines are primed in the same gesture (an empty
// utterance; iOS needs it). When the browser still refuses playback (NotAllowedError) the
// narrator marks itself blocked and stops pausing the video at flags until a
// gesture unlocks the element again -- no stutter at every flag.
//
// Memory: each flag's WAV (1-2 MB) is a blob URL; it is revoked once spoken,
// and on a seek every entry that is no longer near the playhead is dropped.
//
// The module is DOM-free apart from the Audio element it creates (injectable
// for tests), so it is tested with a fake player, fake fetch and fake audio.


import { RATE_BY_LEVEL, isParody, rateFor, selectStops, supportsLang } from "./commentators.js?v=cbff49fb19";

export { RATE_BY_LEVEL, selectStops };

export const LEAD_SEC = 5;
export const TICK_MS = 250;
export const WAIT_MS = 8000;
export const MAX_STEP_SEC = 2;
// After its own rewind (finish: seekTo(pause point - voiceRewindSec)) the
// YouTube player still reports the old time for a moment, then jumps back:
// for OWN_SEEK_GRACE_MS a backward step of at most the rewind plus
// OWN_SEEK_SLACK_SEC (the seek landing short, a few ticks of lag) is that
// landing, not a seek: the flags just read stay read (owner 2026-11-18: the
// same finding read twice, a second or more apart). A longer jump back, even
// then, is the viewer's own seek. At any time a backward step of at most
// BACK_JITTER_SEC (buffering) is jitter, not a seek.
export const OWN_SEEK_GRACE_MS = 1500;
export const OWN_SEEK_SLACK_SEC = 1;
export const BACK_JITTER_SEC = 0.5;
export const MIN_VOLUME = 30;
export const MAX_TEXT_CHARS = 300;
export const STORAGE_KEY = "nobs.voice";
export const SPEECH_RATE = 1.1;
export const TEXTS_POLL_MS = 5000;
// How long the error sound plays before the speech starts (ms).
export const ERROR_SOUND_MS = 480;

// The "error" alert: two short descending tones (G5 then C5), each a sine
// with a soft octave partial and a fast bell-like decay. Original sound, not a
// copy of any system sound. Returns the wait before going on (ms); 0 when Web
// Audio is unavailable.
export function playErrorSound(volume = 1) {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return 0;
    primeClick();
    const ctx = clickContextNow();
    if (!ctx) return 0;
    const t0 = ctx.currentTime + 0.01;
    const note = (freq, start, length) => {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.45 * volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      gain.connect(ctx.destination);
      for (const [mult, level] of [[1, 1], [2, 0.25], [3, 0.08]]) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq * mult;
        const partial = ctx.createGain();
        partial.gain.value = level;
        osc.connect(partial).connect(gain);
        osc.start(start);
        osc.stop(start + length + 0.02);
      }
    };
    note(784, t0, 0.32);
    note(523.25, t0 + 0.13, 0.42);
    return ERROR_SOUND_MS;
  } catch {
    return 0;
  }
}
export const VOICE_STYLES = Object.freeze(["casual", "normal"]);

// Casual openers per flag colour; one is picked per claim (by its id).
export const OPENERS = Object.freeze({
  red: ["Вот тут совсем не так.", "Э… как бы, нет."],
  yellow: ["Вот тут не точно.", "Ну, не совсем."],
  green: ["А вот тут всё чётко."],
  white: ["А это проверить не выйдет."],
});

// Hebrew openers per flag colour.
export const HE_OPENERS = Object.freeze({
  red: ["רגע, זה ממש לא ככה."],
  yellow: ["זה לא ממש מדויק."],
  green: ["כאן הכול נכון."],
  white: ["את זה אי אפשר לבדוק."],
});

export const OPENERS_BY_LANG = Object.freeze({ ru: OPENERS, he: HE_OPENERS });

// Run caption language (base code) -> voice language sent to /voice/say.
export const VOICES = Object.freeze({
  ru: { lang: "ru" },
  he: { lang: "he" },
});

// Caption code -> voice base code: "iw" (YouTube's old Hebrew code) is "he".
export function normalizeLang(captionLanguage) {
  const base = String(captionLanguage ?? "").split(/[-_]/)[0].toLowerCase();
  return base === "iw" ? "he" : base;
}

// The voice for a run's caption language, or null when there is none.
export function voiceFor(captionLanguage) {
  return VOICES[normalizeLang(captionLanguage)] ?? null;
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
// The last voice problem (any, not only the first one warned about): shown
// by the settings dialog's «Проверить голос» (narrator.diagnostics()).
let lastError = null;
function describe(err) {
  if (err == null) return "";
  if (typeof err === "string") return err;
  return String(err.error ?? err.message ?? err.name ?? err);
}
function warnOnce(...args) {
  lastError = args.map(describe).filter(Boolean).join(": ");
  if (warned) return;
  warned = true;
  console.warn("[voice]", ...args);
}

// One concise console line per engine decision, so a viewer's console
// screenshot explains why the narrator spoke with what (or did not speak).
// Repeats of the same line are not printed again.
export const LOG_PREFIX = "[NOBS voice]";
function engineName(e) {
  return e ? String(e.id ?? e.kind ?? "engine") : "none";
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

// What is said for one claim: its plain-language summary (no colour label),
// or the first sentence of the argument when there is no summary.
export function spokenText(claim, lang = "ru") {
  const summary = String(claim?.summary ?? "").trim();
  return capText(summary || firstSentence(claim?.argument));
}

function hashString(value) {
  let h = 0;
  for (const ch of String(value)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

// The casual stand-in for a claim without a generated text: a colour opener
// (deterministic per claim id) and the summary.
export function casualFallback(claim, lang = "ru") {
  const summary = spokenText(claim);
  const list = (OPENERS_BY_LANG[normalizeLang(lang)] ?? OPENERS)[claim?.flag];
  if (!list?.length) return summary;
  const opener = list[hashString(claim?.id ?? claim?.start_sec ?? "") % list.length];
  return summary ? `${opener} ${summary}` : opener;
}

// What is said for a claim in a style: "casual" uses the generated text
// (`texts[claim.id]`) or the fallback; "normal" the summary.
export function textForStyle(claim, style = "normal", texts = {}, lang = "ru") {
  if (style !== "casual") return spokenText(claim);
  const generated = String(texts?.[claim?.id] ?? "").trim();
  return generated ? capText(generated) : capText(casualFallback(claim, lang));
}

// When a flag is read: at the END of its passage (the speaker has finished
// the thought), falling back to its start when the end is unknown.
export function speakAt(claim) {
  const end = Number(claim?.end_sec);
  return Number.isFinite(end) && end > 0 ? end : Number(claim?.start_sec);
}

// The "space bar pressed" click played when the narrator pauses the video and
// again before it resumes: a real recording (web/sounds/key-spacebar.wav, the
// Android Open Source Project's KeypressSpacebar.wav, Apache 2.0; see
// web/sounds/NOTICE.md), decoded once with Web Audio. Until it has loaded (or
// if it cannot be), a synthesized click stands in. playKeyClick returns how
// long to wait (ms) before going on; 0 when Web Audio is unavailable.
export const CLICK_MS = 200;
export const CLICK_URL = "sounds/key-spacebar.wav";
let clickContext = null;
let clickBuffer = null;
let clickLoading = null;
function loadClick(ctx) {
  if (clickBuffer || clickLoading || typeof fetch !== "function") return;
  clickLoading = fetch(CLICK_URL)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then((bytes) => ctx.decodeAudioData(bytes))
    .then((buffer) => {
      clickBuffer = buffer;
    })
    .catch(() => {
      // keep the synthesized click; try again on the next gesture
      clickLoading = null;
    });
}
// Create / resume the click's AudioContext inside a user gesture, so the
// browser lets it sound later from a timer; also starts loading the sample.
function clickContextNow() {
  return clickContext;
}
export function primeClick() {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    clickContext ??= new Ctx();
    if (clickContext.state === "suspended") clickContext.resume?.();
    loadClick(clickContext);
  } catch {
    // no Web Audio: clicks are skipped
  }
}
export function playKeyClick(volume = 1) {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return 0;
    clickContext ??= new Ctx();
    const ctx = clickContext;
    if (ctx.state === "suspended") ctx.resume?.();
    if (clickBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = clickBuffer;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(ctx.destination);
      source.start();
      return CLICK_MS;
    }
    loadClick(ctx);
    const t0 = ctx.currentTime + 0.005;
    const length = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length / 7));
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400;
    band.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.55 * volume;
    noise.connect(band).connect(noiseGain).connect(ctx.destination);
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(180, t0);
    thump.frequency.exponentialRampToValueAtTime(70, t0 + 0.05);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.35 * volume, t0);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    thump.connect(thumpGain).connect(ctx.destination);
    noise.start(t0);
    thump.start(t0);
    thump.stop(t0 + 0.07);
    return CLICK_MS;
  } catch {
    return 0;
  }
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

// The commentator is ON by default: a first visit (nothing stored, or
// storage blocked) starts with the voice on; only the viewer's own "off"
// ("0") turns it off.
export function loadEnabled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
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
  click = playKeyClick,
  style: initialStyle = "normal",
  persona: initialPersona = null,
  errorCue = false,
  errorSound = playErrorSound,
  rewindSec = () => 0,
  // Seconds ahead a blob engine's audio is requested (a number or a
  // function, read at each tick): LEAD_SEC; more for Piper on a phone.
  leadSec = LEAD_SEC,
  engine: initialEngine = null,
  fallback: initialFallback = null,
  onHold = () => {},
  onItem = () => {},
  onRelease = () => {},
  // No engine can speak at a flag (no ready model, no browser voice for the
  // language): the video goes on, and the page may say why (once per cause).
  onNoVoice = () => {},
  logInfo = (line) => console.info(line),
}) {
  let lastLog = null;
  function log(line) {
    if (line === lastLog) return;
    lastLog = line;
    try {
      logInfo(`${LOG_PREFIX} ${line}`);
    } catch {
      // logging must never break the narration
    }
  }
  // Default engine: the local sidecar through the backend proxy.
  const sileroDefault = () => ({
    id: "silero",
    kind: "blob",
    isReady: () => true,
    synthesize: (text) =>
      Promise.resolve()
        .then(() => fetchImpl(`/voice/say?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(voice?.lang ?? "ru")}`))
        .then((response) => {
          if (!response.ok) throw new Error(`voice/say HTTP ${response.status}`);
          return response.blob();
        }),
  });
  let engine = initialEngine ?? sileroDefault();
  let fallback = initialFallback;
  const hook = (fn, arg) => {
    try {
      fn(arg);
    } catch (err) {
      warnOnce("voice hook failed", err);
    }
  };
  let enabled = false;
  let style = VOICE_STYLES.includes(initialStyle) ? initialStyle : "normal";
  // Casual texts of the current run: {runId, status, texts, loading, posted, pollTimer, gen}
  let runId = null;
  let texts = {};
  let textsStatus = null;
  let textsLoading = false;
  let textsPosted = false;
  let pollTimer = null;
  let textsGen = 0;
  let voice = null; // VOICES entry for the run's language
  // The commentator (src/commentators.js profile); null = «душнила» as before.
  let persona = initialPersona ?? null;
  // Scoop lines of the current persona: [{kind: "scoop", scoop_id, at_sec, text, title}]
  let items = [];
  let claims = [];
  // What the narrator stops for, in time order: claim stops and scoop stops
  // ({kind, key, at, flag, claim | item}), after the persona's triggers.
  let stops = [];
  let timer = null;
  let prevTime = null;
  // Claims already spoken in this pass over the video (cleared by a seek), so
  // a flag right at a tick boundary is never read twice.
  const fired = new Set();
  // Until when a backward step is the narrator's own rewind landing late.
  let ownSeekUntil = 0;
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
  let blocked = false;
  let lastUsed = null; // the engine that spoke last (diagnostics) // the browser refused playback: no pausing at flags

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

  // ---- Persona ----
  function isDushnila() {
    return !persona || persona.id === "dushnila";
  }

  function parody() {
    return Boolean(persona) && (Boolean(persona.parody) || isParody(persona));
  }

  // "generated" (texts from the backend) or "summary" (the claim's summary).
  function textMode() {
    if (parody()) return "generated";
    if (isDushnila()) return style === "casual" ? "generated" : "summary";
    return persona.text_mode === "summary" ? "summary" : "generated";
  }

  // The voice-texts style asked for: «душнила» keeps the legacy "casual"
  // storage until its profile is customized; any other persona its id.
  function textsStyle() {
    if (isDushnila()) return persona?.customized ? "dushnila" : "casual";
    return String(persona.id);
  }

  function speechRate() {
    return persona ? rateFor(persona) : SPEECH_RATE;
  }

  // A persona that does not speak the run's language makes no stops.
  function personaSpeaks() {
    return !persona || !voice || supportsLang(persona, voice.lang);
  }

  function claimKey(claim) {
    return `c:${claim.id ?? `${claim.start_sec}:${claim.text ?? ""}`}`;
  }

  function casualActive() {
    return textMode() === "generated" && Boolean(voice && OPENERS_BY_LANG[voice.lang]);
  }

  function generatedText(claim) {
    return String(texts?.[claim?.id] ?? "").trim();
  }

  // A non-parody persona without a line for a claim: one of its openers for
  // the colour (deterministic per claim) and the summary.
  function personaFallback(claim, lang) {
    const summary = spokenText(claim);
    const list = persona?.openers?.[lang]?.[claim?.flag];
    if (!Array.isArray(list) || !list.length) return summary;
    const opener = String(list[hashString(claim?.id ?? claim?.start_sec ?? "") % list.length]);
    return summary ? `${opener} ${summary}` : opener;
  }

  function claimText(claim) {
    const lang = voice?.lang ?? "ru";
    if (!casualActive()) return spokenText(claim, lang);
    const generated = generatedText(claim);
    if (generated) return capText(generated);
    if (isDushnila()) return capText(casualFallback(claim, lang));
    if (parody()) return "";
    return capText(personaFallback(claim, lang));
  }

  function currentText(stop) {
    return stop.kind === "scoop" ? capText(stop.item?.text ?? "") : claimText(stop.claim);
  }

  function claimStop(claim) {
    return { kind: "claim", key: claimKey(claim), at: speakAt(claim), flag: claim.flag, claim };
  }

  // Recompute the stops from the claims, the scoop lines and the persona.
  function rebuildStops() {
    if (!personaSpeaks()) {
      stops = [];
    } else {
      const triggers = persona?.triggers ?? null;
      const flags = Array.isArray(triggers?.flags) ? triggers.flags : null;
      const list = [];
      for (const claim of claims) {
        if (flags && !flags.includes(claim.flag)) continue;
        // A parody persona never stands in a summary: no line, no stop.
        if (parody() && !generatedText(claim)) continue;
        list.push(claimStop(claim));
      }
      if (triggers?.scoops && casualActive()) {
        for (const item of items) {
          const at = Number(item?.at_sec);
          if (item?.at_sec == null || !Number.isFinite(at) || !String(item.text ?? "").trim()) continue;
          list.push({ kind: "scoop", key: `s:${item.scoop_id}`, at, flag: "scoop", item });
        }
      }
      stops = triggers ? selectStops(list, triggers) : list.sort((a, b) => a.at - b.at);
    }
    // A stop speaking right now stays queued; later ones follow the change.
    if (session) {
      const keep = new Set(stops.map((stop) => stop.key));
      session.queue = session.queue.filter((stop) => keep.has(stop.key));
    }
  }

  // What the hooks get: the claim's fields (as before) plus kind / persona,
  // or a scoop stop.
  function hookStop(stop) {
    if (!stop) return stop;
    if (stop.kind === "scoop") return { kind: "scoop", flag: "scoop", scoop: stop.item, at_sec: stop.at, persona };
    return { ...stop.claim, kind: "claim", claim: stop.claim, persona };
  }

  // ---- Casual texts (GET / POST /runs/{id}/voice-texts?style=casual) ----
  function stopPoll() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function wantTexts() {
    return enabled && casualActive() && runId !== null && personaSpeaks();
  }

  // The first answer about the casual texts has not come yet: hold the
  // prefetch rather than synthesize a fallback that is replaced a moment later.
  function textsPending() {
    return casualActive() && textsLoading && textsStatus === null;
  }

  function refetchUpcoming() {
    if (enabled && voice && prevTime !== null && !session) prefetchAhead(prevTime);
  }

  function applyTexts(body) {
    const first = textsStatus === null;
    const before = JSON.stringify([texts, items]);
    texts = body?.texts && typeof body.texts === "object" ? body.texts : {};
    items = Array.isArray(body?.items) ? body.items.filter((item) => item?.kind === "scoop") : [];
    textsStatus = body?.status ?? "failed";
    const changed = JSON.stringify([texts, items]) !== before;
    if (first || changed) rebuildStops();
    // New texts (or the first answer): get the upcoming flags' audio with them.
    if (first || changed) refetchUpcoming();
  }

  async function requestTexts(method) {
    const response = await fetchImpl(
      `/runs/${encodeURIComponent(runId)}/voice-texts?style=${encodeURIComponent(textsStyle())}`,
      method === "POST" ? { method: "POST" } : undefined
    );
    // No texts for this persona and run (the public demo has none for a
    // persona the owner has not approved): "none", not an error to retry.
    if (response.status === 404) return { status: "none", texts: {}, items: [] };
    if (!response.ok) throw new Error(`voice-texts HTTP ${response.status}`);
    return response.json();
  }

  async function loadTexts() {
    const gen = textsGen;
    textsLoading = true;
    try {
      let body = await requestTexts("GET");
      if (gen !== textsGen) return;
      applyTexts(body);
      // None yet, failed, or stale (the persona or the scoops changed since
      // they were made): ask for a generation once; stale texts serve meanwhile.
      if ((textsStatus === "none" || textsStatus === "failed" || textsStatus === "stale") && !textsPosted) {
        textsPosted = true;
        body = await requestTexts("POST");
        if (gen !== textsGen) return;
        applyTexts(body);
      }
    } catch (err) {
      if (gen !== textsGen) return;
      warnOnce("casual voice texts failed", err);
      const first = textsStatus === null;
      textsStatus = "failed";
      if (first) {
        rebuildStops();
        refetchUpcoming();
      }
    } finally {
      if (gen === textsGen) textsLoading = false;
    }
    if (gen !== textsGen) return;
    if (textsStatus === "running" && wantTexts()) {
      pollTimer = setTimeout(() => {
        pollTimer = null;
        if (gen === textsGen && wantTexts()) loadTexts();
      }, TEXTS_POLL_MS);
    }
  }

  function ensureTexts() {
    if (!wantTexts()) {
      stopPoll();
      return;
    }
    if (textsLoading || pollTimer !== null) return;
    if (textsStatus === "complete") return;
    if (textsStatus === "failed" && textsPosted) return;
    if (textsStatus === "none" && textsPosted) return;
    if (textsStatus === "stale" && textsPosted) return;
    loadTexts();
  }

  function resetTexts() {
    textsGen += 1;
    stopPoll();
    texts = {};
    items = [];
    textsStatus = null;
    textsLoading = false;
    textsPosted = false;
    rebuildStops();
  }

  // ---- Audio fetching (cached per claim) ----
  // Null when the engine speaks directly (speech engine) or is not ready yet
  // (nothing is queued for a model still downloading).
  function engineBlobReady() {
    return engine?.kind === "blob" && (typeof engine.isReady !== "function" || engine.isReady());
  }

  // A speech engine that can speak the run's language here (the system
  // voice says no when the browser has no voice for it).
  function speechUsable(e) {
    if (e?.kind !== "speech") return false;
    try {
      return typeof e.hasVoice !== "function" || e.hasVoice() !== false;
    } catch {
      return true;
    }
  }

  // Who speaks a flag now: the blob engine when ready (or still able to
  // become ready while a speech engine stands in), else a speech engine.
  function speakerNow() {
    if (engineBlobReady()) return engine;
    if (speechUsable(engine)) return engine;
    if (speechUsable(fallback)) return fallback;
    return null;
  }

  // Why nothing can speak (for the log and the page's one-time notice).
  function silentReason() {
    if (engine?.kind === "blob") {
      const state = engine.getState?.() ?? "not ready";
      return `${engineName(engine)} is ${state} and there is no browser voice for "${voice?.lang ?? "?"}"`;
    }
    return `no browser voice for "${voice?.lang ?? "?"}"`;
  }

  function fetchAudio(stop) {
    if (!engineBlobReady()) return null;
    const key = stop.key;
    const text = currentText(stop);
    if (!text) return null;
    const known = cache.get(key);
    if (known && known.text === text) return known;
    if (known?.url) revokeObjectURL(known.url);
    const entry = { text, url: null, failed: false, promise: null };
    const source = engine;
    entry.promise = Promise.resolve()
      .then(() => source.synthesize(text, { isWanted: () => cache.get(key) === entry && engine === source }))
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

  function lead() {
    try {
      const value = Number(typeof leadSec === "function" ? leadSec() : leadSec);
      return Number.isFinite(value) && value > 0 ? value : LEAD_SEC;
    } catch {
      return LEAD_SEC;
    }
  }

  function prefetchAhead(time) {
    if (textsPending()) return;
    const within = lead();
    for (const stop of stops) {
      const ahead = stop.at - time;
      // A flag read in this pass is not synthesized again (after the rewind
      // it is a second ahead: that work would delay the next flag).
      if (ahead > 0 && ahead <= within && !fired.has(stop.key)) fetchAudio(stop);
    }
  }

  function prefetchNext(time) {
    if (textsPending()) return;
    const next = stops.find((stop) => stop.at > time && !fired.has(stop.key));
    if (next) fetchAudio(next);
  }

  function rewindAmount() {
    try {
      return Math.max(0, Number(rewindSec()) || 0);
    } catch {
      return 0;
    }
  }

  function dropEntry(key) {
    const entry = cache.get(key);
    if (!entry) return;
    if (entry.url) revokeObjectURL(entry.url);
    cache.delete(key);
  }

  // After a seek: keep only the audio for the next flag and the flags within
  // the lead (LEAD_SEC) of the new position; everything else is freed.
  function pruneCache(time) {
    const keep = new Set();
    const next = stops.find((stop) => stop.at > time);
    if (next) keep.add(next.key);
    const within = lead();
    for (const stop of stops) {
      const ahead = stop.at - time;
      if (ahead > 0 && ahead <= within) keep.add(stop.key);
    }
    if (session) for (const stop of session.queue) keep.add(stop.key);
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
    if (s.pausedByUs) hook(onRelease, { animate: Boolean(resume) });
    if (resume && s.pausedByUs) {
      const go = () => {
        try {
          // Resume a little before the pause point (setting voiceRewindSec),
          // so the phrase is not cut. prevTime follows the jump, so it is not
          // taken for a seek and the flag just read is not read again.
          const back = rewindAmount();
          if (back > 0) {
            const target = Math.max(0, (Number.isFinite(s.pausedVideoAt) ? s.pausedVideoAt : currentTime()) - back);
            player.seekTo?.(target, true);
            prevTime = target;
            ownSeekUntil = now() + OWN_SEEK_GRACE_MS;
          }
          player.playVideo();
        } catch (err) {
          warnOnce("could not resume the video", err);
        }
      };
      // "Space bar" click before the video goes on (skipped when the browser
      // blocks audio: nothing was heard, so no click either).
      const wait = blocked || exitSound() === "none" ? 0 : clickSafely();
      if (wait > 0) setTimeout(go, wait);
      else go();
    }
  }

  // The persona's sounds: entry "click" | "error_on_red" | "error" | "none",
  // exit "click" | "none". Without a persona: the errorCue option decides.
  function entrySound() {
    return persona?.sounds?.entry ?? (errorCue ? "error_on_red" : "click");
  }

  function exitSound() {
    return persona?.sounds?.exit ?? "click";
  }

  function clickSafely() {
    try {
      return Number(click(speechVolume())) || 0;
    } catch {
      return 0;
    }
  }

  function startSession(queue) {
    sessionToken += 1;
    session = { queue: [...queue], audio: null, pausedByUs: false, pausedAt: 0, pausedVideoAt: currentTime(), waitTimer: null, token: sessionToken };
    try {
      player.pauseVideo();
      session.pausedByUs = true;
      session.pausedAt = now();
    } catch (err) {
      warnOnce("could not pause the video", err);
      session = null;
      return;
    }
    const s = session;
    hook(onHold, hookStop(s.queue[0]));
    // A red flag opens with the "error" sound, other flags with the
    // "space bar" click; then the speech (the persona's sounds decide).
    const entry = entrySound();
    let wait = 0;
    if (!blocked && (entry === "error" || (entry === "error_on_red" && s.queue[0]?.flag === "red"))) {
      try {
        wait = Number(errorSound(speechVolume())) || 0;
      } catch {
        wait = 0;
      }
    }
    if (wait <= 0 && entry !== "none") wait = clickSafely();
    if (wait > 0) {
      s.waitTimer = setTimeout(() => {
        if (session !== s) return;
        s.waitTimer = null;
        speakNext();
      }, wait);
    } else {
      speakNext();
    }
  }

  function speakNext() {
    const s = session;
    if (!s) return;
    const stop = s.queue.shift();
    if (!stop || blocked) {
      finish(true);
      return;
    }
    hook(onItem, hookStop(stop));
    const key = stop.key;
    const spoken = () => {
      // Spoken (or unplayable): free its WAV. A seek back fetches it again.
      dropEntry(key);
      speakNext();
    };
    // No audio from the engine: the speech engine (or the fallback) speaks.
    const direct = () => {
      const speech = speechUsable(engine) ? engine : speechUsable(fallback) ? fallback : null;
      const text = currentText(stop);
      if (speech && text) {
        if (speech !== engine) log(`${engineName(engine)} not ready (${engine?.getState?.() ?? "no audio"}): speaking with ${engineName(speech)}`);
        lastUsed = engineName(speech);
        say(s, speech, text, spoken);
      } else {
        if (!speech) log(`flag skipped: ${silentReason()}`);
        spoken();
      }
    };
    const entry = fetchAudio(stop);
    if (!entry) {
      direct();
      return;
    }
    if (entry.url) {
      lastUsed = engineName(engine);
      log(`speaking with ${engineName(engine)}`);
      play(s, entry.url, spoken);
      return;
    }
    if (entry.failed) {
      direct();
      return;
    }
    // Not ready yet: wait for it, at most WAIT_MS.
    let settled = false;
    s.waitTimer = setTimeout(() => {
      if (settled || session !== s) return;
      settled = true;
      s.waitTimer = null;
      direct();
    }, WAIT_MS);
    entry.promise.then((url) => {
      if (settled || session !== s) return;
      settled = true;
      clearTimeout(s.waitTimer);
      s.waitTimer = null;
      if (url) {
        lastUsed = engineName(engine);
        log(`speaking with ${engineName(engine)}`);
        play(s, url, spoken);
      } else direct();
    });
  }

  // Speak `text` with a speech engine for session `s`; same semantics as
  // play(): stopping the session cancels it, `onDone` runs once when it ended
  // or failed.
  function say(s, speech, text, onDone) {
    const handle = { cancel: null, pause: () => handle.cancel?.() };
    s.audio = handle;
    let done = false;
    const next = () => {
      if (done || session !== s || s.audio !== handle) return;
      done = true;
      s.audio = null;
      onDone();
    };
    try {
      handle.cancel = speech.speak(text, {
        volume: speechVolume(),
        rate: speechRate(),
        onEnd: next,
        onError: (event) => {
          if (event?.error === "not-allowed") {
            blocked = true;
            unlocked = false;
            warnOnce("speech refused by the browser; click the page or the voice button to allow it", event);
          } else if (event?.error !== "interrupted" && event?.error !== "canceled") {
            warnOnce("speech failed", event?.error ?? event);
          }
          next();
        },
      });
    } catch (err) {
      warnOnce("speech failed", err);
      next();
    }
  }

  // Play `url` on the shared element for session `s`; `onDone` runs once it
  // ended, failed or was refused.
  function play(s, url, onDone) {
    let audio;
    try {
      audio = audioElement();
      srcGeneration += 1;
      audio.src = url;
      audio.volume = speechVolume();
      // Setting src resets playbackRate to defaultPlaybackRate: set both.
      audio.preservesPitch = true;
      audio.webkitPreservesPitch = true;
      audio.defaultPlaybackRate = speechRate();
      audio.playbackRate = speechRate();
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
      onDone();
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
    primeClick();
    // Web Speech too: iOS Safari speaks from a timer only after a first
    // utterance inside a gesture (the engine speaks an empty one, once).
    for (const speech of [engine, fallback]) {
      if (speech?.kind !== "speech" || typeof speech.prime !== "function") continue;
      try {
        speech.prime();
      } catch {
        // priming must never block the gesture
      }
    }
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
    // Our own rewind landing late, or a small backward jitter: not a seek;
    // what was read stays read (prevTime follows the time).
    const ownLanding = now() < ownSeekUntil && -step <= rewindAmount() + OWN_SEEK_SLACK_SEC;
    if (step < 0 && (ownLanding || -step <= BACK_JITTER_SEC)) return;
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
    const crossed = stops.filter((stop) => stop.at > prev && stop.at <= time + CROSS_EPS && !fired.has(stop.key));
    prefetchAhead(time);
    if (crossed.length) {
      for (const stop of crossed) fired.add(stop.key);
      // Playback refused by the browser: do not pause for speech that
      // cannot be heard; just free the audio.
      if (blocked) for (const stop of crossed) dropEntry(stop.key);
      else if (!speakerNow()) {
        // Nothing can speak (no ready model, no browser voice): never hold
        // the video for silence; the page says why, once.
        const reason = silentReason();
        log(`not pausing at the flag: ${reason}`);
        for (const stop of crossed) dropEntry(stop.key);
        hook(onNoVoice, { reason, lang: voice?.lang ?? null, engine: engineName(engine) });
      } else startSession(crossed);
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
      ensureTexts();
      startTimer();
      tick();
    } else {
      stopPoll();
      stopTimer();
      finish(true);
    }
  }

  return {
    /** The claims to read: the list the timeline markers show. A streaming
     * run's claim still being checked (or whose check failed) has no verdict
     * to read and is skipped until it gets one. */
    setClaims(list) {
      // Each finding once: never a repeat merged into another claim
      // (merged_into), never the same id twice (owner 2026-11-18).
      const byId = new Map();
      for (const claim of list ?? []) {
        if (!claim || !claim.flag || (claim.verify_state ?? "done") !== "done") continue;
        if (claim.merged_into !== undefined && claim.merged_into !== null) continue;
        if (!Number.isFinite(speakAt(claim))) continue;
        byId.set(claim.id ?? Symbol("claim"), claim);
      }
      claims = [...byId.values()].sort((a, b) => speakAt(a) - speakAt(b));
      // A claim speaking right now stays queued; later ones follow the filter.
      rebuildStops();
    },
    /** The run's caption language; narration only runs for a voiced one. */
    setLanguage(captionLanguage) {
      const next = voiceFor(captionLanguage);
      if (next !== voice) {
        voice = next;
        for (const entry of cache.values()) if (entry.url) revokeObjectURL(entry.url);
        cache.clear();
        rebuildStops();
      }
      refreshRunning();
    },
    /** The run whose casual texts are read (its run_id). */
    setRun(id) {
      const next = id ?? null;
      if (next === runId) return;
      resetTexts();
      runId = next;
      ensureTexts();
    },
    /** Ask for the current run's casual texts again (a streaming run just
     * completed: its texts can be generated only now; setRun ignores the
     * same id). */
    reloadTexts() {
      if (runId === null) return;
      resetTexts();
      ensureTexts();
    },
    /** "casual" or "normal"; upcoming flags are re-texted (refetched). */
    setStyle(next) {
      const value = VOICE_STYLES.includes(next) ? next : "normal";
      if (value === style) return;
      style = value;
      rebuildStops();
      ensureTexts();
      if (!wantTexts()) stopPoll();
      if (enabled && voice && prevTime !== null) prefetchAhead(prevTime);
    },
    getStyle() {
      return style;
    },
    /** Switch the commentator (a src/commentators.js profile; null =
     * «душнила»). Another texts style asks for its texts again; the upcoming
     * stops are re-texted, re-timed and re-voiced (rate, sounds). */
    setPersona(next) {
      const value = next ?? null;
      if (value === persona || JSON.stringify(value) === JSON.stringify(persona)) return;
      const before = textsStyle();
      persona = value;
      if (textsStyle() !== before) resetTexts();
      else rebuildStops();
      ensureTexts();
      if (!wantTexts()) stopPoll();
      refetchUpcoming();
    },
    getPersona() {
      return persona;
    },
    /** The stops ahead (for tests and the page): [{kind, at, flag}]. */
    getStops() {
      return stops.map(({ kind, at, flag, key }) => ({ kind, at, flag, key }));
    },
    /** Switch the voice engine (and the speech fallback); prepared audio is
     * dropped and the upcoming flags are requested again from the new one. */
    setEngine(next, nextFallback = fallback) {
      const before = `${engineName(engine)}|${engineName(fallback)}`;
      fallback = nextFallback ?? null;
      const after = `${engineName(next ?? engine)}|${engineName(fallback)}`;
      if (before !== after || next !== engine) {
        log(`engine ${engineName(next ?? engine)}, stand-in ${engineName(fallback)}${speechUsable(fallback) || !fallback ? "" : " (no voice for this language)"}`);
      }
      if (next === engine) return;
      engine = next ?? sileroDefault();
      for (const key of [...cache.keys()]) {
        // The WAV playing right now stays valid until it ends.
        if (session?.audio && element && cache.get(key)?.url === element.src) cache.delete(key);
        else dropEntry(key);
      }
      refetchUpcoming();
    },
    getEngine() {
      return engine;
    },
    /** The engine became ready (a Piper model finished loading): request the
     * upcoming flags' audio now. */
    engineReady() {
      refetchUpcoming();
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
    /** What the settings dialog's «Проверить голос» shows. */
    diagnostics() {
      return {
        engine: engineName(engine),
        engineState: engine?.getState?.() ?? (engine?.kind === "speech" ? "speech" : "ready"),
        engineProgress: engine?.getProgress?.() ?? null,
        engineError: engine?.getError?.() ?? null,
        fallback: engineName(fallback),
        fallbackHasVoice: fallback ? speechUsable(fallback) : null,
        speaker: engineName(speakerNow()),
        lastUsed,
        unlocked,
        blocked,
        lastError,
        persona: persona?.id ?? "dushnila",
        textsStatus,
        lines: Object.keys(texts ?? {}).filter((k) => String(texts[k] ?? "").trim()).length,
        stops: stops.length,
        enabled,
        language: voice?.lang ?? null,
      };
    },
    /**
     * Speak `text` now, from a click (the settings dialog's test button):
     * unlocks the audio in that gesture, then speaks with whatever would
     * speak a flag (a speech engine at once, inside the gesture). Resolves
     * {ok, used, error}. Never touches the video.
     */
    testSpeak(text, { timeoutMs = 20000 } = {}) {
      unlock();
      if (session) return Promise.resolve({ ok: false, used: null, error: "busy: the narrator is speaking" });
      const speaker = speakerNow();
      if (!speaker) {
        const reason = silentReason();
        log(`test: ${reason}`);
        return Promise.resolve({ ok: false, used: null, error: reason });
      }
      const used = engineName(speaker);
      log(`test: speaking with ${used}`);
      return new Promise((resolve) => {
        let done = false;
        const end = (ok, error = null) => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          if (ok) lastUsed = used;
          else if (error) lastError = String(error);
          resolve({ ok, used, error });
        };
        const guard = setTimeout(() => end(false, "timeout: no end of speech"), timeoutMs);
        if (speaker.kind === "speech") {
          try {
            speaker.speak(text, {
              volume: speechVolume(),
              rate: speechRate(),
              onEnd: () => end(true),
              onError: (event) => end(false, describe(event) || "speech error"),
            });
          } catch (err) {
            end(false, describe(err));
          }
          return;
        }
        Promise.resolve()
          .then(() => speaker.synthesize(text, { isWanted: () => true }))
          .then((blob) => {
            const audio = audioElement();
            const url = createObjectURL(blob);
            srcGeneration += 1;
            audio.src = url;
            audio.volume = speechVolume();
            listener = {
              onEnded: () => {
                listener = null;
                revokeObjectURL(url);
                end(true);
              },
              onError: (err) => {
                listener = null;
                end(false, describe(err) || "audio error");
              },
            };
            const played = audio.play();
            if (played && typeof played.then === "function") played.catch((err) => end(false, describe(err)));
          })
          .catch((err) => end(false, describe(err)));
      });
    },
    tick,
    destroy() {
      stopTimer();
      resetTexts();
      finish(false);
      for (const entry of cache.values()) if (entry.url) revokeObjectURL(entry.url);
      cache.clear();
      enabled = false;
    },
  };
}
