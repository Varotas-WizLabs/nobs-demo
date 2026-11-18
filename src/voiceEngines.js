// web/src/voiceEngines.js
//
// The voices the flag narrator (voice.js) can speak with, behind one small
// interface, so the same narration works in the local app and in the public
// static demo (where nothing can be generated on a server):
//
//   "silero"        the local voice sidecar through the backend
//                   (GET /voice/say -> WAV); only where GET /voice/health is ok.
//   "piper:<name>"  Piper generated in the viewer's browser (dmitri, irina,
//                   denis, ruslan), in a module Web Worker (piperWorker.js);
//                   the ~63 MB model downloads once and is cached by the
//                   browser (OPFS). Needs WebAssembly.
//   "system"        the browser's own speech (Web Speech API, a voice in the
//                   run's language when there is one: ru-RU, he-IL). Also the
//                   stand-in while a Piper model is still downloading or when
//                   Piper fails.
//   "local:<lang>:<engine>"  a local engine of the voice sidecar through the
//                   backend (GET /voice/say?lang=<lang>&engine=<engine>), e.g.
//                   "local:he:say" (macOS Carmit) or "local:he:pocket:liat";
//                   offered only when GET /voice/engines lists it available.
//
// Languages: Russian has Piper, Silero and the system voice; Hebrew has the
// system voice (he-IL) and the local engines. Piper has no Hebrew voice.
//
// Blob engines: {id, kind: "blob", isReady(), synthesize(text, {isWanted}) ->
// Promise<Blob>}. Speech engines: {id, kind: "speech", speak(text, {volume,
// rate, onEnd, onError}) -> cancel()}.
//
// Piper and the system voice do not normalize text the way the Silero sidecar
// does (tools/voice/nobs_voice.py), so normalizeForSynth() prepares it:
// "+" read as "плюс", known abbreviations, Latin words in Cyrillic. Numbers stay
// digits (espeak-ng, Piper's phonemizer, reads Russian numbers itself).

export const PIPER_VOICES = Object.freeze({
  dmitri: "ru_RU-dmitri-medium",
  irina: "ru_RU-irina-medium",
  denis: "ru_RU-denis-medium",
  ruslan: "ru_RU-ruslan-medium",
});
export const ENGINE_IDS = Object.freeze(["piper:dmitri", "piper:irina", "piper:denis", "piper:ruslan", "silero", "system"]);
export const DEFAULT_ENGINE = "piper:dmitri";

// ---- Text normalization (mirrors nobs_voice.py, without stress marks) ----

// Read letter by letter (or as a word). Longer keys first; case-sensitive.
export const ABBREV = Object.freeze({
  // Russian
  ДНК: "дэ-эн-ка", РНК: "эр-эн-ка", мРНК: "эм-эр-эн-ка", США: "сэ-шэ-а", ВИЧ: "вич",
  СПИД: "спид", ВОЗ: "воз", ИИ: "и-и", ЕС: "е-эс", РФ: "эр-эф", ООН: "о-о-эн",
  СССР: "эс-эс-эс-эр", РАН: "ран", МГУ: "эм-гэ-у", ЦНС: "цэ-эн-эс", ЖКТ: "жэ-ка-тэ",
  МРТ: "эм-эр-тэ", КТ: "ка-тэ", ЭКГ: "э-ка-гэ", ЭЭГ: "э-э-гэ", ЭКО: "эко", ОРВИ: "орви",
  ГМО: "гэ-эм-о", ВВП: "вэ-вэ-пэ", ПЦР: "пэ-цэ-эр", СДВГ: "эс-дэ-вэ-гэ", ПТСР: "пэ-тэ-эс-эр",
  ОКР: "о-ка-эр", ЛСД: "эл-эс-дэ", ТГК: "тэ-гэ-ка", КБД: "ка-бэ-дэ", ИМТ: "и-эм-тэ",
  ЛПНП: "эл-пэ-эн-пэ", ЛПВП: "эл-пэ-вэ-пэ", СМИ: "сми", НАСА: "наса", ФДА: "эф-дэ-а",
  ЖКХ: "жэ-ка-ха",
  // Latin
  "SARS-CoV-2": "сарс ков два", "COVID-19": "ковид девятнадцать", COVID: "ковид",
  "CAR-T": "кар-ти", CRISPR: "криспр", ChatGPT: "чат-джи-пи-ти", GPT: "джи-пи-ти",
  mRNA: "эм-эр-эн-эй", DNA: "ди-эн-эй", RNA: "эр-эн-эй", FDA: "эф-ди-эй", CDC: "си-ди-си",
  NIH: "эн-ай-эйч", WHO: "ву-эйч-о", NASA: "наса", MIT: "эм-ай-ти", AAV: "эй-эй-ви",
  HIV: "эйч-ай-ви", AIDS: "эйдс", PCR: "пи-си-ар", MRI: "эм-ар-ай", IVF: "ай-ви-эф",
  BMI: "би-эм-ай", LDL: "эл-ди-эл", HDL: "эйч-ди-эл", IQ: "ай-кью", AI: "эй-ай",
  CBD: "си-би-ди", THC: "ти-эйч-си", LSD: "эл-эс-ди", ADHD: "эй-ди-эйч-ди",
  PTSD: "пи-ти-эс-ди", GMO: "джи-эм-о", CO2: "цэ-о-два", SARS: "сарс", USA: "ю-эс-эй",
  UK: "ю-кей", EU: "и-ю", BBC: "би-би-си", CNN: "си-эн-эн", GDP: "джи-ди-пи",
  ACE2: "эй-си-и два", PhD: "пи-эйч-ди", NHS: "эн-эйч-эс", ALS: "эй-эл-эс", BPA: "би-пи-эй",
  PFAS: "пи-эф-эй-эс", EMF: "и-эм-эф", "5G": "пять-джи", "4G": "четыре-джи",
  "Wi-Fi": "вай-фай", WiFi: "вай-фай", YouTube: "ютуб", Google: "гугл", iPhone: "айфон",
  OpenAI: "оупен-эй-ай",
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const ABBREV_RE = new RegExp(
  `(?<![A-Za-zА-Яа-яЁё0-9])(${Object.keys(ABBREV)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|")})(?![A-Za-zА-Яа-яЁё0-9])`,
  "g"
);

const EN_LETTER = {
  a: "эй", b: "би", c: "си", d: "ди", e: "и", f: "эф", g: "джи", h: "эйч", i: "ай",
  j: "джей", k: "кей", l: "эл", m: "эм", n: "эн", o: "оу", p: "пи", q: "кью", r: "ар",
  s: "эс", t: "ти", u: "ю", v: "ви", w: "дабл-ю", x: "экс", y: "уай", z: "зед",
};
const RU_LETTER = {
  A: "а", B: "бэ", C: "цэ", D: "дэ", E: "е", F: "эф", G: "гэ", H: "аш", I: "и", J: "йот",
  K: "ка", L: "эль", M: "эм", N: "эн", O: "о", P: "пэ", Q: "ку", R: "эр", S: "эс", T: "тэ",
  U: "у", V: "вэ", W: "дубль-вэ", X: "икс", Y: "игрек", Z: "зэт",
};

const KNOWN_EN_RU = {
  mattel: "Маттел", netflix: "Нетфликс", disney: "Дисней", pixar: "Пиксар", youtube: "Ютуб",
  hollywood: "Голливуд", nature: "Нэйчер", science: "Сайенс", lancet: "Ланцет", cell: "Селл",
  harvard: "Гарвард", stanford: "Стэнфорд", oxford: "Оксфорд", cambridge: "Кембридж",
  pfizer: "Пфайзер", moderna: "Модерна", google: "Гугл", apple: "Эппл", microsoft: "Майкрософт",
  meta: "Мета", tesla: "Тесла", the: "зе", of: "оф", and: "энд", new: "нью", york: "Йорк",
  times: "Таймс", journal: "Джорнал", medicine: "Медисин",
};

// Practical transcription, longer clusters first.
const EN_RU_RULES = [
  ["sch", "ш"], ["tch", "ч"], ["igh", "ай"], ["ough", "оу"],
  ["ch", "ч"], ["sh", "ш"], ["th", "т"], ["ph", "ф"], ["ck", "к"],
  ["qu", "кв"], ["wh", "в"], ["kn", "н"], ["wr", "р"],
  ["oo", "у"], ["ee", "и"], ["ea", "и"], ["ie", "и"], ["oa", "оу"],
  ["ai", "эй"], ["ay", "эй"], ["ey", "ей"], ["oy", "ой"], ["oi", "ой"],
  ["ou", "ау"], ["ow", "ау"], ["au", "о"], ["aw", "о"], ["ew", "ю"],
  ["a", "а"], ["b", "б"], ["c", "к"], ["d", "д"], ["e", "е"], ["f", "ф"],
  ["g", "г"], ["h", "х"], ["i", "и"], ["j", "дж"], ["k", "к"], ["l", "л"],
  ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["q", "к"], ["r", "р"],
  ["s", "с"], ["t", "т"], ["u", "у"], ["v", "в"], ["w", "в"], ["x", "кс"],
  ["y", "и"], ["z", "з"],
];

function spellLatin(word) {
  return [...word.toLowerCase()].map((c) => EN_LETTER[c] ?? "").join("-");
}

export function enWordToRu(word) {
  const known = KNOWN_EN_RU[word.toLowerCase()];
  if (known) return known;
  let low = word.toLowerCase().replace(/'/g, "");
  // silent final e: "Alone" -> "Алон"
  if (low.length > 3 && low.endsWith("e") && !"aeiou".includes(low[low.length - 2])) low = low.slice(0, -1);
  let out = "";
  let i = 0;
  while (i < low.length) {
    const rule = EN_RU_RULES.find(([src]) => low.startsWith(src, i));
    if (rule) {
      out += rule[1];
      i += rule[0].length;
    } else {
      i += 1;
    }
  }
  return /^[A-Z]/.test(word) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

// Hebrew text for the browser's voice: "+" read as "פלוס", Russian stress
// marks (combining acute) dropped; Latin and digits stay as they are.
export function normalizeHebrew(text) {
  return String(text ?? "")
    .replace(/\u0301/g, "")
    .replace(/\+/g, " פלוס ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.:;!?…])/g, "$1")
    .trim();
}

/** Text ready for Piper / the system voice (not needed for Silero). */
export function normalizeForSynth(text, lang = "ru") {
  if (baseLang(lang) === "he") return normalizeHebrew(text);
  let s = String(text ?? "");
  s = s.replace(/\+/g, " плюс ");
  s = s.replace(/&/g, " и ").replace(/№/g, " номер ");
  s = s.replace(ABBREV_RE, (m) => ABBREV[m]);
  // Unknown all-caps Latin of 2-5 letters: an acronym, spelled.
  s = s.replace(/(?<![A-Za-z])[A-Z]{2,5}(?![A-Za-z])/g, (m) => spellLatin(m));
  // A lone capital Latin letter ("витамин C"): the Russian letter name.
  s = s.replace(/(?<![A-Za-zА-Яа-яЁё0-9\-])[A-Z](?![A-Za-zА-Яа-яЁё0-9\-])/g, (m) => RU_LETTER[m]);
  s = s.replace(/[A-Za-z][A-Za-z']*/g, (m) => enWordToRu(m));
  return s.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.:;!?…])/g, "$1").trim();
}

// ---- Languages ----

// "iw" (YouTube's old code for Hebrew) and "he-IL" -> "he"; "ru-RU" -> "ru".
export function baseLang(lang) {
  const base = String(lang ?? "").split(/[-_]/)[0].toLowerCase();
  return base === "iw" ? "he" : base;
}

// BCP-47 tag the browser voice is asked for, per base language.
export const SPEECH_LANG = Object.freeze({ ru: "ru-RU", he: "he-IL" });

/** A browser voice for `lang` ("he" matches he-IL, he, iw-IL), or null. */
export function findSystemVoice(lang, synth = globalThis.speechSynthesis) {
  try {
    const want = baseLang(lang);
    const tag = (SPEECH_LANG[want] ?? want).toLowerCase();
    const voices = synth?.getVoices?.() ?? [];
    const norm = (v) => String(v?.lang ?? "").toLowerCase().replace("_", "-");
    return voices.find((v) => norm(v) === tag) ?? voices.find((v) => baseLang(norm(v)) === want) ?? null;
  } catch {
    return null;
  }
}

/** Names of the browser voices for `lang` ("ru", "he"), for diagnostics. */
export function systemVoiceNames(lang, synth = globalThis.speechSynthesis) {
  try {
    const want = baseLang(lang);
    return (synth?.getVoices?.() ?? [])
      .filter((v) => baseLang(String(v?.lang ?? "").toLowerCase().replace("_", "-")) === want)
      .map((v) => `${v.name}${v.localService === false ? " (online)" : ""}`);
  } catch {
    return [];
  }
}

/** The local engine id for a /voice/engines option ("say" -> "local:he:say"). */
export function localEngineId(lang, option) {
  return `local:${baseLang(lang)}:${option}`;
}

/**
 * The local engines GET /voice/engines lists as available for `lang`:
 * [{id: "local:he:say", engine: "say", label}]. {} (sidecar down) -> [].
 */
export function localEngines(enginesBody, lang) {
  const entry = enginesBody?.[baseLang(lang)];
  const options = Array.isArray(entry?.options) ? entry.options : [];
  return options
    .filter((o) => o && o.available === true && typeof o.id === "string" && o.id)
    .map((o) => ({ id: localEngineId(lang, o.id), engine: o.id, label: String(o.label ?? o.id) }));
}

/** GET /voice/engines; {} when it fails or the sidecar is down. */
export async function fetchVoiceEngines(fetchImpl) {
  try {
    const response = await fetchImpl("/voice/engines");
    if (!response.ok) return {};
    const body = await response.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

/** The default Hebrew choice: local Carmit when available, else the system voice. */
export function defaultHebrewEngine(localIds = []) {
  return localIds.includes("local:he:say") ? "local:he:say" : "system";
}

// ---- Availability ----

export function piperSupported(g = globalThis) {
  return typeof g.WebAssembly === "object" && g.WebAssembly !== null;
}

export function systemSupported(g = globalThis) {
  return Boolean(g.speechSynthesis && typeof g.SpeechSynthesisUtterance === "function");
}

/**
 * The engine to use for the `wanted` setting given what this page has:
 * an unavailable choice falls back to Piper (dmitri), then the system voice.
 * Null when nothing can speak.
 */
export function resolveEngineId(wanted, { silero = false, piper = false, system = false, local = [] } = {}, lang = "ru") {
  if (baseLang(lang) === "he") return resolveHebrewEngineId(wanted, { system, local });
  const ok = (id) => (id === "silero" ? silero : id === "system" ? system : id.startsWith("piper:") ? piper : false);
  const id = ENGINE_IDS.includes(wanted) ? wanted : DEFAULT_ENGINE;
  if (ok(id)) return id;
  if (piper) return DEFAULT_ENGINE;
  if (system) return "system";
  if (silero) return "silero";
  return null;
}

/**
 * Hebrew: the wanted engine when it can speak here; otherwise local Carmit,
 * the system voice (only when the browser has a Hebrew voice), any local
 * engine; null when none (the toggle is then disabled for the run).
 * `local`: ids of the available local engines ("local:he:say", ...).
 */
export function resolveHebrewEngineId(wanted, { system = false, local = [] } = {}) {
  const ids = Array.isArray(local) ? local : [];
  if (wanted === "system" && system) return "system";
  if (typeof wanted === "string" && wanted.startsWith("local:he:") && ids.includes(wanted)) return wanted;
  if (ids.includes("local:he:say")) return "local:he:say";
  if (system) return "system";
  return ids[0] ?? null;
}

// ---- Engines ----

/** A local sidecar engine ("local:he:say", "local:he:pocket:liat") through /voice/say. */
export function createLocalEngine({ fetchImpl, id }) {
  const [, lang = "he", ...rest] = String(id).split(":");
  const engine = rest.join(":");
  return {
    id,
    kind: "blob",
    isReady: () => true,
    async synthesize(text) {
      const response = await fetchImpl(
        `/voice/say?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}&engine=${encodeURIComponent(engine)}`
      );
      if (!response.ok) throw new Error(`voice/say HTTP ${response.status}`);
      return response.blob();
    },
  };
}

/** The local Silero sidecar through the backend proxy. */
export function createSileroEngine({ fetchImpl, lang = "ru" }) {
  return {
    id: "silero",
    kind: "blob",
    isReady: () => true,
    async synthesize(text) {
      const response = await fetchImpl(`/voice/say?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(lang)}`);
      if (!response.ok) throw new Error(`voice/say HTTP ${response.status}`);
      return response.blob();
    },
  };
}

/** The browser's Web Speech API. */
export function createSystemEngine({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, lang = "ru-RU" } = {}) {
  const base = baseLang(lang);
  const tag = SPEECH_LANG[base] ?? lang;
  const pickVoice = () => findSystemVoice(base, synth);
  // Chrome fills the voice list asynchronously; ask early.
  try {
    synth?.getVoices?.();
  } catch {
    // ignore
  }
  let primed = false;
  return {
    id: "system",
    kind: "speech",
    lang: base,
    isReady: () => true,
    /**
     * False when the browser lists its voices and none is in this language
     * (it would read Russian with an English voice, i.e. not at all); true
     * when there is one, or while the list is still empty (not loaded yet).
     */
    hasVoice() {
      try {
        const all = synth?.getVoices?.() ?? [];
        return all.length === 0 || Boolean(pickVoice());
      } catch {
        return true;
      }
    },
    voiceName: () => pickVoice()?.name ?? null,
    // Called inside a user gesture: an empty, silent utterance, so iOS
    // Safari lets later speech start from a timer. Once per engine.
    prime() {
      if (primed || !synth || typeof Utterance !== "function") return;
      primed = true;
      if (synth.speaking) return; // already speaking: unlocked
      const utterance = new Utterance("");
      utterance.lang = tag;
      utterance.volume = 0;
      synth.speak(utterance);
    },
    speak(text, { volume = 1, rate = 1, onEnd = () => {}, onError = () => {} } = {}) {
      let done = false;
      const settle = (fn, arg) => {
        if (done) return;
        done = true;
        fn(arg);
      };
      const utterance = new Utterance(normalizeForSynth(text, base));
      utterance.lang = tag;
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      utterance.volume = volume;
      // Chrome sometimes never starts an utterance or never says it ended
      // (a stuck queue, an online voice that lost the network): a watchdog
      // ends it, so the narrator never holds the video for silence.
      const words = String(utterance.text ?? "").length;
      const expectMs = Math.min(60000, 4000 + (words / 12 / Math.max(0.5, rate)) * 1000 * 1.8);
      let watchdog = null;
      const arm = (ms, why) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          try {
            synth.cancel();
          } catch {
            // ignore
          }
          settle(onError, { error: why });
        }, ms);
      };
      utterance.onstart = () => arm(expectMs, "timeout");
      utterance.onend = () => {
        clearTimeout(watchdog);
        settle(onEnd);
      };
      utterance.onerror = (event) => {
        clearTimeout(watchdog);
        settle(onError, event);
      };
      // A previous utterance still queued would delay this one.
      synth.cancel();
      // A queue left paused (Chrome) would never start this one.
      try {
        synth.resume?.();
      } catch {
        // ignore
      }
      synth.speak(utterance);
      arm(6000 + expectMs, "no-start");
      return () => {
        clearTimeout(watchdog);
        done = true;
        try {
          synth.cancel();
        } catch {
          // ignore
        }
      };
    },
  };
}

function defaultWorkerFactory() {
  if (typeof Worker === "function") {
    try {
      return new Worker(new URL("./piperWorker.js", import.meta.url), { type: "module" });
    } catch {
      // fall through to the main thread
    }
  }
  return mainThreadPort();
}

// Same message protocol as the worker, on the page itself (no Worker support).
function mainThreadPort() {
  const port = { onmessage: null, onerror: null, terminated: false };
  let handle = null;
  const post = (data) => {
    if (!port.terminated) port.onmessage?.({ data });
  };
  port.postMessage = (data) => {
    const run = (h) => h(data);
    if (handle) {
      handle.then(run);
      return;
    }
    handle = import("./piperWorker.js?v=4a6a7b52fe").then(({ createPiperHandler }) => createPiperHandler(post));
    handle.then(run, (err) => port.onerror?.(err));
  };
  port.terminate = () => {
    port.terminated = true;
  };
  return port;
}

/**
 * In-browser Piper. One worker (and one loaded model) per engine; requests
 * run one at a time in order. `onProgress(fraction)` while the model loads,
 * `onState(state)` on "loading" / "ready" / "failed".
 */
export function createPiperEngine({ voice = "dmitri", workerFactory = defaultWorkerFactory, onProgress = () => {}, onState = () => {} } = {}) {
  const voiceId = PIPER_VOICES[voice] ?? PIPER_VOICES.dmitri;
  let state = "idle";
  let progress = 0;
  let worker = null;
  let nextId = 1;
  const pending = new Map(); // id -> {resolve, reject}
  let chain = Promise.resolve();
  let readyPromise = null;
  let readyResolve;
  let readyReject;

  function setState(next) {
    state = next;
    try {
      onState(next);
    } catch {
      // ignore
    }
  }

  let error = null;
  function fail(message) {
    error = String(message ?? "failed");
    setState("failed");
    readyReject?.(new Error(message));
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  }

  function onMessage(data) {
    if (!data) return;
    if (data.type === "progress") {
      progress = data.total ? data.loaded / data.total : 0;
      try {
        onProgress(progress);
      } catch {
        // ignore
      }
    } else if (data.type === "ready") {
      progress = 1;
      setState("ready");
      readyResolve?.();
    } else if (data.type === "result") {
      pending.get(data.id)?.resolve(data.blob);
      pending.delete(data.id);
    } else if (data.type === "error") {
      if (data.id != null && pending.has(data.id)) {
        pending.get(data.id).reject(new Error(data.message));
        pending.delete(data.id);
      } else if (state === "loading") {
        fail(data.message || "piper failed to load");
      }
    }
  }

  function prepare() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    readyPromise.catch(() => {});
    setState("loading");
    try {
      worker = workerFactory();
      worker.onmessage = (event) => onMessage(event.data);
      worker.onerror = (event) => {
        event?.preventDefault?.();
        fail(String(event?.message ?? "piper worker error"));
      };
      worker.postMessage({ type: "init", voiceId });
    } catch (err) {
      fail(String(err?.message ?? err));
    }
    return readyPromise;
  }

  function request(text) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: "predict", id, text: normalizeForSynth(text) });
    });
  }

  return {
    id: `piper:${voice}`,
    kind: "blob",
    voiceId,
    prepare,
    isReady: () => state === "ready",
    getState: () => state,
    getProgress: () => progress,
    getError: () => error,
    /** Serialized; a request whose `isWanted()` turned false before its turn is dropped. */
    synthesize(text, { isWanted = () => true } = {}) {
      const job = chain.then(async () => {
        await prepare();
        if (!isWanted()) throw new Error("dropped");
        return request(text);
      });
      chain = job.catch(() => {});
      return job;
    },
    destroy() {
      try {
        worker?.terminate?.();
      } catch {
        // ignore
      }
      worker = null;
      for (const { reject } of pending.values()) reject(new Error("destroyed"));
      pending.clear();
      if (state === "loading") readyReject?.(new Error("destroyed"));
      state = "idle";
    },
  };
}

/** The engine for an id ("piper:dmitri", "silero", "system", "local:he:say"). */
export function createEngine(id, { fetchImpl, lang = "ru", workerFactory, onProgress, onState, synth, Utterance } = {}) {
  if (id === "silero") return createSileroEngine({ fetchImpl, lang });
  if (id === "system") return createSystemEngine({ synth, Utterance, lang });
  if (String(id).startsWith("local:")) return createLocalEngine({ fetchImpl, id });
  const voice = String(id).split(":")[1] ?? "dmitri";
  return createPiperEngine({ voice, workerFactory, onProgress, onState });
}
