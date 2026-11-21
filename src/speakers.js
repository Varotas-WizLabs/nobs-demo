// web/src/speakers.js
//
// Who speaks in the video, shown in the claim popup. The speaker comes from
// the video's own material (title, description, captions, on-screen text) and
// is never checked independently, so the popup labels it as such.

import { labelLanguage } from "./i18n.js?v=78dbe39118";

const LABELS = {
  ru: {
    unknown: "Спикер не опознан",
    note: "по материалам самого видео, не проверено независимо",
    noteOnScreen: "имя прочитано на экране, не проверено",
    roles: {
      host: "ведущий", guest: "гость", interviewer: "интервьюер", panelist: "участник дискуссии",
      voice_over: "закадровый голос", other: "участник",
    },
  },
  en: {
    unknown: "Speaker not identified",
    note: "from the video's own material, not independently verified",
    noteOnScreen: "name read on screen, not verified",
    roles: {
      host: "host", guest: "guest", interviewer: "interviewer", panelist: "panelist",
      voice_over: "voice-over", other: "participant",
    },
  },
};

function labels(lang) {
  return LABELS[String(labelLanguage(lang) ?? "").startsWith("ru") ? "ru" : "en"];
}

/** Attach `claim.speaker` ({name, role, identified_by}) in place; returns the run. */
export function withSpeakers(run) {
  if (!run || !Array.isArray(run.speakers) || !Array.isArray(run.claims)) return run;
  const byId = new Map(run.speakers.map((s) => [s.id, s]));
  for (const claim of run.claims) {
    const s = claim?.speaker_id != null ? byId.get(claim.speaker_id) : null;
    if (s) claim.speaker = { name: s.name ?? null, role: s.role ?? null, identified_by: s.identified_by ?? null };
  }
  return run;
}

export function speakerText(speaker, lang = "ru") {
  const L = labels(lang);
  const role = speaker?.role && speaker.role !== "unknown" ? L.roles[speaker.role] : null;
  const name = speaker?.name ? String(speaker.name) : null;
  if (name) return role ? `${name} · ${role}` : name;
  return role ? `${L.unknown} · ${role}` : L.unknown;
}

export function speakerNote(speaker, lang = "ru") {
  const L = labels(lang);
  return speaker?.identified_by === "on_screen" ? L.noteOnScreen : L.note;
}
