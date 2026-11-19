// web/src/frames.js
//
// The frames layer in the player (GET /runs/{id}/frames): a small storyboard
// thumbnail next to a claim, an «На экране: …» line with the shown document's
// source-check status, the «С экрана» group (claims read only on screen,
// origin "screen") and the presentation marks on the timeline. Screen text
// is a lead, never evidence: the popup says so when the original was not
// found. Frames never change a flag.

import { formatTimecode } from "./claimSync.js?v=8999e255c1";
import { labelLanguage } from "./i18n.js?v=8999e255c1";

const LABELS = {
  ru: {
    onScreen: "На экране",
    fromScreen: "С экрана",
    fromScreenBadge: "с экрана",
    frameAlt: "Кадр в момент утверждения",
    hires: "прочитано по чёткому кадру",
    original: "оригинал",
    notFound: "на экране показан скриншот, оригинал не найден",
    note: "Подача, не вердикт",
    roles: { host: "ведущий", guest: "гость", voice_over: "закадровый голос" },
  },
  en: {
    onScreen: "On screen",
    fromScreen: "From the screen",
    fromScreenBadge: "on screen",
    frameAlt: "Frame at the claim",
    hires: "read from a sharp still",
    original: "original",
    notFound: "a screenshot was shown; its original was not found",
    note: "Presentation, not a verdict",
    roles: { host: "host", guest: "guest", voice_over: "voice-over" },
  },
};

export function frameLabels(lang) {
  return LABELS[String(labelLanguage(lang) ?? "").startsWith("ru") ? "ru" : "en"];
}

function safeUrl(url) {
  try {
    const u = new URL(String(url), "https://x.invalid");
    return u.protocol === "http:" || u.protocol === "https:" ? String(url) : null;
  } catch {
    return null;
  }
}

/** A thumbnail path the page may load: the API's own path or a demo file. */
export function safeThumb(path) {
  const p = String(path ?? "");
  return /^(\/frames-files\/|data\/frames\/)[A-Za-z0-9_\-/.]+\.jpg$/.test(p) && !p.includes("..") ? p : null;
}

/**
 * Attach the frames payload to a run (in place, returns it): each claim gets
 * `frame_thumb` and `screen` (the observations linked to it, nearest first),
 * the run gets `frame_marks`.
 */
export function attachFrames(run, payload) {
  if (!run || !payload) return run;
  const observations = Array.isArray(payload.observations) ? payload.observations : [];
  const thumbs = payload.claim_frames ?? {};
  for (const claim of run.claims ?? []) {
    const thumb = safeThumb(thumbs[String(claim.id)]);
    if (thumb) claim.frame_thumb = thumb;
    const mid = (Number(claim.start_sec) + Number(claim.end_sec)) / 2;
    const linked = observations
      .filter((o) => (o.claim_ids ?? []).includes(claim.id))
      .sort((a, b) => Math.abs(a.t_sec - mid) - Math.abs(b.t_sec - mid));
    if (linked.length) claim.screen = linked;
  }
  run.frame_marks = Array.isArray(payload.marks) ? payload.marks : [];
  run.frames = payload;
  return run;
}

/** Fetch and attach the run's frames; the run unchanged when there are none. */
export function withFrames(fetchImpl, run) {
  if (!run || run.run_id == null) return Promise.resolve(run);
  return Promise.resolve()
    .then(() => fetchImpl(`/runs/${run.run_id}/frames`))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((payload) => attachFrames(run, payload))
    .catch(() => run);
}

export function isScreenClaim(claim) {
  return claim?.origin === "screen";
}

/** The source-check outcome of the documents shown near a claim. */
export function screenChecks(claim) {
  return (claim?.screen ?? []).flatMap((o) => o.source_check ?? []);
}

/**
 * The «На экране: …» line: the first legible fragments near the claim and
 * the source-check status. null when nothing was read.
 */
export function screenLine(claim, lang = "ru") {
  const L = frameLabels(lang);
  const obs = (claim?.screen ?? []).find((o) => (o.on_screen_text ?? []).some((x) => String(x.text ?? "").trim()));
  if (!obs) return null;
  const texts = obs.on_screen_text
    .filter((x) => String(x.text ?? "").trim())
    .slice(0, 2)
    .map((x) => `«${String(x.text).trim().slice(0, 140)}»${x.uncertain ? " (?)" : ""}`);
  const check = (obs.source_check ?? [])[0] ?? null;
  return {
    text: `${L.onScreen}: ${texts.join(", ")}`,
    time: formatTimecode(obs.t_sec),
    hires: obs.resolution_read && obs.resolution_read !== "320x180" ? L.hires : null,
    status: check?.status ?? null,
    statusNote: check ? check.status_note || (check.status === "shown_not_found" ? L.notFound : "") : null,
    url: check && check.status !== "shown_not_found" ? safeUrl(check.url) : null,
  };
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Popup HTML: the thumbnail, «На экране: …» and the source-check status. */
export function screenBlockHtml(claim, lang = "ru") {
  const L = frameLabels(lang);
  const thumb = safeThumb(claim?.frame_thumb);
  const line = screenLine(claim, lang);
  const role = L.roles[claim?.speaker_role];
  if (!thumb && !line && !isScreenClaim(claim) && !role) return "";
  const parts = [];
  if (thumb) parts.push(`<img class="claim-frame" src="${esc(thumb)}" alt="${esc(L.frameAlt)}" loading="lazy" width="160" height="90">`);
  const lines = [];
  if (isScreenClaim(claim)) lines.push(`<span class="claim-screen-badge">${esc(L.fromScreen)}</span>`);
  if (role) lines.push(`<span class="claim-speaker-role">${esc(role)}</span>`);
  if (line) {
    lines.push(`<span class="claim-screen-text">${esc(line.text)}${line.hires ? ` <small>(${esc(line.hires)})</small>` : ""}</span>`);
    if (line.statusNote) {
      const link = line.url ? ` <a href="${esc(line.url)}" target="_blank" rel="noopener noreferrer">${esc(L.original)}</a>` : "";
      lines.push(`<span class="claim-screen-status" data-status="${esc(line.status)}">${esc(line.statusNote)}${link}</span>`);
    }
  }
  return `<div class="claim-screen">${parts.join("")}<p>${lines.join("<br>")}</p></div>`;
}

/** Timeline items for the presentation marks (no popup: the tooltip says it is presentation, not a verdict). */
export function frameTimelineItems(run) {
  const lang = run?.caption_language ?? "ru";
  const L = frameLabels(lang);
  const key = String(labelLanguage(lang)).startsWith("ru") ? "ru" : "en";
  return (run?.frame_marks ?? [])
    .filter((m) => Number.isFinite(Number(m.t_sec)))
    .map((m) => {
      const name = m.label?.[key] ?? m.tag;
      return {
        kind: "frame",
        tag_id: `frame:${m.tag}`,
        start_sec: Number(m.t_sec),
        end_sec: Number(m.t_sec),
        label: `${formatTimecode(m.t_sec)} ${name}`,
        title: `${name}${m.detail ? ` (${m.detail})` : ""}\n${L.note}`,
      };
    });
}
