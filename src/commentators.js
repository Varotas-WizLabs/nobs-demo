// web/src/commentators.js
//
// Commentator profiles (personas of the flag narrator), the client side of
// docs/superpowers/specs/2026-11-17-commentators-design.md §4.
//
// The server owns the profiles (GET /commentators, nobs/commentators/*):
// built-in ones live in its code, the owner's overrides and own personas in
// its database. This module holds what the browser needs without a round
// trip -- the same validation rules as the server (pydantic, model.py), the
// speech-rate table, the parody rule (G1) and copies of the two built-ins,
// used when the list cannot be loaded (an older server, a demo exported
// before personas existed) so the player always has «душнила».
//
// Safety rules G1-G7 are not configurable here: the parody flag is derived
// (never taken from the form), crude humour is capped at 2, and nothing in
// this module turns a guardrail off.

import { labelLanguage, t as tr } from "./i18n.js?v=71d330228d";
import { fillVars } from "./stringsCommentators.js?v=71d330228d";

/** A label of src/stringsCommentators.js with {placeholders} filled. */
const msg = (key, vars) => fillVars(tr(`cmui.${key}`, "ru"), vars);

export const DEFAULT_COMMENTATOR = "dushnila";

// speech_rate 1..5 -> audio playbackRate (pitch preserved). 3 is the old
// fixed SPEECH_RATE.
export const RATE_BY_LEVEL = Object.freeze({ 1: 0.9, 2: 1.0, 3: 1.1, 4: 1.25, 5: 1.4 });

export const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
export const RESERVED_IDS = Object.freeze(["normal", "casual", "dushnila", "yablogger", "all", "new", "meta"]);
export const FLAGS = Object.freeze(["red", "yellow", "green", "white"]);
export const OPENER_KEYS = Object.freeze([...FLAGS, "scoop"]);
export const LANGS = Object.freeze(["ru", "he", "en"]);
export const ENTRY_SOUNDS = Object.freeze(["click", "error_on_red", "error", "none"]);
export const EXIT_SOUNDS = Object.freeze(["click", "none"]);
export const INTENSITY_KNOBS = Object.freeze(["exaggeration", "humor", "slang", "drama", "crude"]);
export const PARODY_MANNERS = Object.freeze(["zoomer_blogger", "sarcastic", "standup"]);

export const LIMITS = Object.freeze({
  speech_rate: [1, 5],
  speech_speed: [0.7, 1.6],
  complexity: [1, 5],
  intensity: [0, 5],
  crude: [0, 2], // hard cap (G4): household humour about the situation, never about people
  max_words: [8, 40],
  top_n: [1, 50],
  min_gap_sec: [0, 600],
  name: 40,
  description: 300,
  extra_instructions: 600,
  opener: 80,
  openers_per_key: 8,
});

// Manners offered when /commentators/meta cannot be loaded (the server's list
// is the source of truth: prompt.py holds the role templates).
export const FALLBACK_MANNERS = Object.freeze([
  { key: "neutral", label_ru: "нейтральный", label_he: "ניטרלי", label_en: "neutral", parody: false },
  { key: "friendly", label_ru: "дружеский", label_he: "ידידותי", label_en: "friendly", parody: false },
  { key: "frivolous", label_ru: "фривольный", label_he: "קליל", label_en: "playful", parody: false },
  { key: "zoomer_blogger", label_ru: "зумер-блогер", label_he: "בלוגר זומר", label_en: "Gen Z blogger", parody: true },
  { key: "sarcastic", label_ru: "саркастичный", label_he: "סרקסטי", label_en: "sarcastic", parody: true },
  { key: "academic", label_ru: "академичный", label_he: "אקדמי", label_en: "academic", parody: false },
  { key: "news_anchor", label_ru: "ведущий новостей", label_he: "מגיש חדשות", label_en: "news anchor", parody: false },
  { key: "standup", label_ru: "стендап", label_he: "סטנדאפ", label_en: "stand-up", parody: true },
]);

const DUSHNILA = Object.freeze({
  id: "dushnila",
  name: "Душнила",
  emoji: "🤓",
  color: "#4f7cff",
  description: "Спокойно и по-дружески пересказывает итог проверки фактов.",
  built_in: true,
  parody: false,
  customized: false,
  languages: ["ru", "he", "en"],
  speech_rate: 3,
  speech_speed: 1.1,
  complexity: 3,
  manner: "friendly",
  intensity: { exaggeration: 0, humor: 1, slang: 0, drama: 0, crude: 0 },
  triggers: { flags: ["red", "yellow", "green", "white"], scoops: false, frequency: "all", top_n: 8, min_gap_sec: 0 },
  max_words: 25,
  openers: {
    ru: {
      red: ["Вот тут совсем не так.", "Э… как бы, нет."],
      yellow: ["Вот тут не точно.", "Ну, не совсем."],
      green: ["А вот тут всё чётко."],
      white: ["А это проверить не выйдет."],
      scoop: [],
    },
    he: {
      red: ["רגע, זה ממש לא ככה."],
      yellow: ["זה לא ממש מדויק."],
      green: ["כאן הכול נכון."],
      white: ["את זה אי אפשר לבדוק."],
      scoop: [],
    },
    en: {
      red: ["Hmm, that's just not right…", "Uh… no, not really…", "Nope, that one misses…", "Well, actually, no…"],
      yellow: ["That's not quite accurate…", "Well, not exactly…", "There's a catch here…", "Almost, but…"],
      green: ["This one checks out…", "Yep, that's right…", "No arguments here…"],
      white: ["This one can't be checked…", "Hard to say here…", "That's just an opinion…"],
      scoop: [],
    },
  },
  voices: { ru: null, he: null, en: null },
  sounds: { entry: "error_on_red", exit: "click" },
  text_mode: "generated",
  extra_instructions: "",
  enabled: true,
});

const YABLOGGER = Object.freeze({
  id: "yablogger",
  name: "Яблогер",
  emoji: "📱",
  color: "#ff3d7f",
  description: "Пародия на хайп-блогера: из каждого итога проверки делает драму и кликбейт.",
  built_in: true,
  parody: true,
  customized: false,
  languages: ["ru", "he", "en"],
  speech_rate: 4,
  speech_speed: 1.25,
  complexity: 1,
  manner: "zoomer_blogger",
  intensity: { exaggeration: 4, humor: 4, slang: 5, drama: 5, crude: 1 },
  triggers: { flags: ["red", "yellow"], scoops: true, frequency: "all", top_n: 8, min_gap_sec: 20 },
  max_words: 30,
  openers: {
    ru: {
      red: ["ЧТО?! Вот это поворот…", "Так, стоп, это же скандал…", "Ребят, это разоблачение века…", "Это база? Нет, это не база…"],
      yellow: ["Ребят, я в шоке…", "Кринж, конечно…", "Ну такое, честно…", "Тут прям полуправда, держитесь…"],
      green: ["Ну всё, хайпа не будет, это правда…"],
      white: ["Проверить нельзя, но вайб подозрительный…"],
      scoop: ["Внимание, эксклюзив!", "Вы не поверите, что мы нашли…", "Срочно в сторис…", "Это надо разбирать в отдельном видео…"],
    },
    he: {
      red: ["מה?! איזה טוויסט…", "רגע, רגע, זה סקנדל…"],
      yellow: ["חבר'ה, אני בהלם…", "קרינג', אין מה לעשות…"],
      green: [],
      white: [],
      scoop: ["בלעדי!"],
    },
    en: {
      red: ["WHAT?! Plot twist…", "Okay, stop, this is a scandal…", "Guys, the exposé of the century…", "Is this based? Nah, not based…"],
      yellow: ["Guys, I'm shook…", "Cringe, honestly…", "Kinda mid, not gonna lie…", "Half-truth alert, hold on…"],
      green: ["Okay, no drama, it's actually true…", "Ugh, it's legit for real…"],
      white: ["Can't be checked, but the vibe is sus…", "Hot take, that's just an opinion…"],
      scoop: ["Breaking, exclusive!", "You won't believe what we found…", "Straight to my stories…", "This needs its own video…"],
    },
  },
  voices: { ru: null, he: null, en: null },
  sounds: { entry: "error_on_red", exit: "click" },
  text_mode: "generated",
  extra_instructions: "",
  enabled: true,
});

export const BUILTINS = Object.freeze([DUSHNILA, YABLOGGER]);

const clone = (value) => JSON.parse(JSON.stringify(value));

/** A fresh copy of the built-in profiles (fallback list). */
export function builtinProfiles() {
  return BUILTINS.map(clone);
}

/** G1: a persona is a parody when its manner is one or a strong knob says so. */
export function isParody(profile) {
  if (!profile) return false;
  if (PARODY_MANNERS.includes(profile.manner)) return true;
  const knobs = profile.intensity ?? {};
  return ["exaggeration", "drama", "crude"].some((k) => Number(knobs[k]) >= 3);
}

export const SPEED_STEP = 0.05;

/** A speed snapped to the 5% grid and the allowed range. */
export function snapSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const [lo, hi] = LIMITS.speech_speed;
  return Math.round(Math.min(hi, Math.max(lo, Math.round(n / SPEED_STEP) * SPEED_STEP)) * 100) / 100;
}

/** The nearest old 1..5 level for a speed (kept in step for old readers). */
export function levelForSpeed(speed) {
  let best = 3;
  for (const [level, rate] of Object.entries(RATE_BY_LEVEL)) {
    if (Math.abs(rate - speed) < Math.abs(RATE_BY_LEVEL[best] - speed)) best = Number(level);
  }
  return best;
}

/** Speech rate (playbackRate) for a profile: speech_speed (5% steps), else the old 1..5 level; 1.1 for none. */
export function rateFor(profile) {
  const speed = snapSpeed(profile?.speech_speed);
  if (speed != null && profile?.speech_speed != null) return speed;
  return RATE_BY_LEVEL[Number(profile?.speech_rate)] ?? RATE_BY_LEVEL[3];
}

/** Whether a persona speaks a run in `lang` ("ru" / "he" / "en"; "iw" is "he"). */
export function supportsLang(profile, lang) {
  const base = String(lang ?? "").split(/[-_]/)[0].toLowerCase();
  const code = base === "iw" ? "he" : base;
  const langs = Array.isArray(profile?.languages) ? profile.languages : LANGS;
  return langs.includes(code);
}

// A built-in persona's name / description, shown in the interface language
// while the owner has not renamed or rewritten it (then theirs is shown).
function builtinText(profile, field) {
  const builtin = BUILTINS.find((b) => b.id === profile?.id);
  if (!builtin || profile[field] !== builtin[field] || labelLanguage("ru") === "ru") return profile?.[field];
  const key = `cmui.persona.${builtin.id}.${field}`;
  const text = tr(key, "ru");
  return text === key ? profile[field] : text;
}

/** The name shown for a persona (a built-in one in the interface language). */
export function personaName(profile) {
  if (!profile) return "";
  return builtinText(profile, "name") || profile.id || "";
}

/** The description shown for a persona (a built-in one in the interface language). */
export function personaDescription(profile) {
  if (!profile) return "";
  return builtinText(profile, "description") ?? "";
}

/** Label of a persona: "📱 Яблогер". */
export function personaLabel(profile) {
  if (!profile) return "";
  return [profile.emoji, personaName(profile)].filter(Boolean).join(" ");
}

const PARODY_WORD = { ru: "пародия", he: "פרודיה", en: "parody" };
/** The word «пародия» in the UI language (ru / he / en). */
export function parodyWord(lang = "ru") {
  const base = String(labelLanguage(lang) ?? "").split(/[-_]/)[0].toLowerCase();
  return PARODY_WORD[base === "iw" ? "he" : base] ?? PARODY_WORD.en;
}

/** The caption under the pause sign while a parody persona speaks, else "". */
export function parodyCaption(profile, lang = "ru") {
  if (!profile || !(profile.parody || isParody(profile))) return "";
  return `${personaLabel(profile)} · ${parodyWord(lang)}`;
}

/** A blank profile for the "new commentator" form. */
export function emptyProfile() {
  return {
    id: "",
    name: "",
    emoji: "🎙️",
    color: "#8ab4ff",
    description: "",
    built_in: false,
    parody: false,
    languages: ["ru"],
    speech_rate: 3,
  speech_speed: 1.1,
    complexity: 3,
    manner: "neutral",
    intensity: { exaggeration: 0, humor: 0, slang: 0, drama: 0, crude: 0 },
    triggers: { flags: ["red", "yellow"], scoops: false, frequency: "all", top_n: 8, min_gap_sec: 0 },
    max_words: 25,
    openers: Object.fromEntries(LANGS.map((lang) => [lang, { red: [], yellow: [], green: [], white: [], scoop: [] }])),
    voices: Object.fromEntries(LANGS.map((lang) => [lang, null])),
    sounds: { entry: "click", exit: "click" },
    text_mode: "generated",
    extra_instructions: "",
    enabled: true,
  };
}

/** Fill the missing fields of a (server or older) profile with defaults. */
export function normalizeProfile(profile) {
  const base = emptyProfile();
  const p = profile && typeof profile === "object" ? profile : {};
  const openers = {};
  for (const lang of LANGS) {
    openers[lang] = {};
    for (const key of OPENER_KEYS) {
      const list = p.openers?.[lang]?.[key];
      openers[lang][key] = Array.isArray(list) ? list.map(String) : [];
    }
  }
  const out = {
    ...base,
    ...p,
    intensity: { ...base.intensity, ...(p.intensity ?? {}) },
    triggers: { ...base.triggers, ...(p.triggers ?? {}) },
    openers,
    voices: { ...base.voices, ...(p.voices ?? {}) },
    sounds: { ...base.sounds, ...(p.sounds ?? {}) },
    languages: Array.isArray(p.languages) ? [...p.languages] : [...base.languages],
  };
  out.triggers.flags = Array.isArray(out.triggers.flags) ? [...out.triggers.flags] : [];
  out.parody = Boolean(p.parody) || isParody(out);
  out.built_in = Boolean(p.built_in);
  return out;
}

/** A copy of `profile` for "duplicate": new free id, not built-in, editable. */
export function duplicateProfile(profile, takenIds = []) {
  const copy = normalizeProfile(clone(profile));
  const taken = new Set([...RESERVED_IDS, ...takenIds]);
  const stem = String(profile?.id ?? "copy").replace(/[^a-z0-9-]/g, "").slice(0, 26) || "copy";
  let id = `${stem}-copy`;
  for (let i = 2; taken.has(id); i += 1) id = `${stem}-copy${i}`;
  copy.id = /^[a-z]/.test(id) ? id : `c-${id}`.slice(0, 32);
  copy.name = `${copy.name || profile?.id || ""}${msg("copySuffix")}`.slice(0, LIMITS.name);
  copy.built_in = false;
  delete copy.customized;
  return copy;
}

function graphemes(text) {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(String(text))].length;
  } catch {
    return [...String(text)].length;
  }
}

const inRange = (value, [lo, hi]) => Number.isInteger(Number(value)) && Number(value) >= lo && Number(value) <= hi;

/**
 * Validate a profile as the server does. Returns {field: message} (in the
 * interface language, Russian by default),
 * empty when valid. `isNew`: the id is being created (format, reserved and
 * taken ids checked); `takenIds`: ids that exist already.
 */
export function validateProfile(profile, { isNew = false, takenIds = [] } = {}) {
  const errors = {};
  const p = profile ?? {};
  if (isNew) {
    if (!ID_PATTERN.test(String(p.id ?? ""))) errors.id = msg("v.idFormat");
    else if (RESERVED_IDS.includes(p.id)) errors.id = msg("v.idReserved");
    else if (takenIds.includes(p.id)) errors.id = msg("v.idTaken");
  }
  const name = String(p.name ?? "").trim();
  if (!name) errors.name = msg("v.nameRequired");
  else if (name.length > LIMITS.name) errors.name = msg("v.maxChars", { n: LIMITS.name });
  if (graphemes(String(p.emoji ?? "").trim()) !== 1) errors.emoji = msg("v.emoji");
  if (!/^#[0-9a-fA-F]{6}$/.test(String(p.color ?? ""))) errors.color = msg("v.color");
  if (String(p.description ?? "").length > LIMITS.description) errors.description = msg("v.maxChars", { n: LIMITS.description });
  const langs = Array.isArray(p.languages) ? p.languages : [];
  if (!langs.length || langs.some((l) => !LANGS.includes(l))) errors.languages = msg("v.languages");
  if (!inRange(p.speech_rate, LIMITS.speech_rate)) errors.speech_rate = msg("v.range", { lo: 1, hi: 5 });
  const speed = Number(p.speech_speed);
  if (p.speech_speed != null && !(Number.isFinite(speed) && speed >= LIMITS.speech_speed[0] && speed <= LIMITS.speech_speed[1])) errors.speech_speed = msg("v.speed");
  if (!inRange(p.complexity, LIMITS.complexity)) errors.complexity = msg("v.range", { lo: 1, hi: 5 });
  for (const knob of INTENSITY_KNOBS) {
    const range = knob === "crude" ? LIMITS.crude : LIMITS.intensity;
    if (!inRange(p.intensity?.[knob], range)) errors[`intensity.${knob}`] = msg("v.range", { lo: range[0], hi: range[1] });
  }
  const t = p.triggers ?? {};
  const flags = Array.isArray(t.flags) ? t.flags : [];
  if (flags.some((f) => !FLAGS.includes(f))) errors["triggers.flags"] = msg("v.unknownFlag");
  else if (!flags.length && !t.scoops) errors["triggers.flags"] = msg("v.flagsRequired");
  if (!["all", "top_n"].includes(t.frequency)) errors["triggers.frequency"] = msg("v.frequency");
  if (t.frequency === "top_n" && !inRange(t.top_n, LIMITS.top_n)) errors["triggers.top_n"] = msg("v.range", { lo: LIMITS.top_n[0], hi: LIMITS.top_n[1] });
  if (!inRange(t.min_gap_sec, LIMITS.min_gap_sec)) errors["triggers.min_gap_sec"] = msg("v.rangeSeconds", { lo: LIMITS.min_gap_sec[0], hi: LIMITS.min_gap_sec[1] });
  if (!inRange(p.max_words, LIMITS.max_words)) errors.max_words = msg("v.range", { lo: LIMITS.max_words[0], hi: LIMITS.max_words[1] });
  for (const lang of LANGS) {
    for (const key of OPENER_KEYS) {
      const list = p.openers?.[lang]?.[key] ?? [];
      if (!Array.isArray(list)) continue;
      if (list.length > LIMITS.openers_per_key) errors[`openers.${lang}.${key}`] = msg("v.maxOpeners", { n: LIMITS.openers_per_key });
      else if (list.some((o) => String(o).length > LIMITS.opener)) errors[`openers.${lang}.${key}`] = msg("v.openerLength", { n: LIMITS.opener });
    }
  }
  for (const lang of LANGS) {
    const v = p.voices?.[lang];
    if (v != null && v !== "" && !/^(piper:[a-z]+|silero|system|system:[\p{L}\p{N}_ .,()'+-]{1,100}|local:[a-z]+:[a-z0-9:_-]+)$/u.test(String(v))) errors[`voices.${lang}`] = msg("v.unknownVoice");
  }
  if (!ENTRY_SOUNDS.includes(p.sounds?.entry)) errors["sounds.entry"] = msg("v.unknownSound");
  if (!EXIT_SOUNDS.includes(p.sounds?.exit)) errors["sounds.exit"] = msg("v.unknownSound");
  if (!["generated", "summary"].includes(p.text_mode ?? "generated")) errors.text_mode = msg("v.textMode");
  if (String(p.extra_instructions ?? "").length > LIMITS.extra_instructions) errors.extra_instructions = msg("v.maxChars", { n: LIMITS.extra_instructions });
  return errors;
}

/**
 * The body sent to POST / PUT /commentators: the profile without the fields
 * only the server sets (built_in, parody, customized). Empty voices -> null,
 * opener lines trimmed and blank ones dropped.
 */
export function profilePayload(profile) {
  const p = normalizeProfile(profile);
  delete p.built_in;
  delete p.parody;
  delete p.customized;
  for (const lang of LANGS) {
    if (!p.voices[lang]) p.voices[lang] = null;
    for (const key of OPENER_KEYS) p.openers[lang][key] = p.openers[lang][key].map((o) => String(o).trim()).filter(Boolean);
  }
  for (const knob of INTENSITY_KNOBS) p.intensity[knob] = Number(p.intensity[knob]);
  for (const key of ["speech_rate", "complexity", "max_words"]) p[key] = Number(p[key]);
  // The speed itself (5% steps); the old level follows it.
  p.speech_speed = snapSpeed(p.speech_speed ?? RATE_BY_LEVEL[p.speech_rate]);
  p.speech_rate = levelForSpeed(p.speech_speed);
  p.triggers.top_n = Number(p.triggers.top_n);
  p.triggers.min_gap_sec = Number(p.triggers.min_gap_sec);
  p.name = String(p.name).trim();
  p.emoji = String(p.emoji).trim();
  return p;
}

/**
 * GET /commentators: {list, default}. The built-ins stand in when the server
 * has no personas yet (404) or cannot be reached; a built-in missing from the
 * answer is added back (the player must always have «душнила»).
 */
export async function fetchCommentators(fetchImpl, { all = false } = {}) {
  let list = [];
  let def = DEFAULT_COMMENTATOR;
  try {
    const response = await fetchImpl(all ? "/commentators?all=1" : "/commentators");
    if (response.ok) {
      const body = await response.json();
      if (Array.isArray(body?.commentators)) list = body.commentators.map(normalizeProfile);
      if (typeof body?.default === "string") def = body.default;
    }
  } catch {
    // keep the built-ins
  }
  for (const builtin of builtinProfiles()) {
    if (!list.some((p) => p.id === builtin.id)) list.push(normalizeProfile(builtin));
  }
  return { list, default: def, fallback: list.every((p) => p.built_in) };
}

/**
 * The persona to use: `id` when it is in `list`, enabled and speaks `lang`
 * (when given), else «душнила» (or the first entry).
 */
export function resolvePersona(list, id, lang = null) {
  const usable = (p) => p && p.enabled !== false && (lang == null || supportsLang(p, lang));
  const chosen = (list ?? []).find((p) => p.id === id);
  if (usable(chosen)) return chosen;
  return (list ?? []).find((p) => p.id === DEFAULT_COMMENTATOR) ?? normalizeProfile(clone(DUSHNILA));
}

// Priority for "only N" and for clashes within min_gap: red, scoop, yellow, white, green.
const PRIORITY = { red: 0, scoop: 1, yellow: 2, white: 3, green: 4 };

/**
 * Pick the stops a persona interrupts the video for. `stops`: [{at, flag,
 * kind}] (a scoop's flag is "scoop"); `triggers`: {frequency, top_n,
 * min_gap_sec}. Higher-priority stops are taken first; a stop closer than
 * min_gap_sec to one taken is dropped; with "top_n" at most top_n are kept.
 * Pure; the result is sorted by time.
 */
export function selectStops(stops, triggers = {}) {
  const list = [...(stops ?? [])].filter((s) => Number.isFinite(s?.at));
  const gap = Math.max(0, Number(triggers?.min_gap_sec) || 0);
  const limit = triggers?.frequency === "top_n" ? Math.max(0, Number(triggers.top_n) || 0) : Infinity;
  if (gap === 0 && limit === Infinity) return list.sort((a, b) => a.at - b.at);
  const rank = (s) => PRIORITY[s.kind === "scoop" ? "scoop" : s.flag] ?? 5;
  const ordered = list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.s.at - b.s.at || a.i - b.i)
    .map(({ s }) => s);
  const taken = [];
  for (const stop of ordered) {
    if (taken.length >= limit) break;
    if (gap > 0 && taken.some((t) => Math.abs(t.at - stop.at) < gap)) continue;
    taken.push(stop);
  }
  return taken.sort((a, b) => a.at - b.at);
}
