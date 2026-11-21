// web/src/voiceStatus.js
//
// Why the narrator speaks (or stays silent), for the viewer:
//
// - effectivePersona(): the public demo has a parody commentator's lines
//   only for runs the owner approved (data/runs/<id>.voice-<persona>.json).
//   A parody persona speaks generated lines only, so without them it would
//   never stop at a flag -- the narrator would be silent. The persona then
//   gives way to «Душнила» (the page says so once).
// - voiceStatusLines(): the status the settings dialog's «Проверить голос»
//   shows: engine chosen / used, Piper model state, browser voices, autoplay,
//   commentator and its lines, last error.

import { DEFAULT_COMMENTATOR, isParody, resolvePersona } from "./commentators.js?v=3d15d8e254";
import { labelLanguage } from "./i18n.js?v=3d15d8e254";

/** A persona that speaks only generated lines (a parody). */
export function needsLines(profile) {
  return Boolean(profile) && profile.id !== DEFAULT_COMMENTATOR && (Boolean(profile.parody) || isParody(profile));
}

/** The number of non-empty lines in a GET /runs/{id}/voice-texts answer. */
export function countLines(body) {
  const texts = body?.texts && typeof body.texts === "object" ? body.texts : {};
  return Object.values(texts).filter((v) => String(v ?? "").trim()).length;
}

/**
 * The persona that actually speaks: the chosen one, unless it needs lines
 * and `linesById[id] === 0` (known to have none for this run); then the
 * default «Душнила». Returns {persona, chosen, fallback: bool}.
 */
export function effectivePersona(list, chosenId, lang, linesById = {}) {
  const chosen = resolvePersona(list, chosenId, lang);
  if (needsLines(chosen) && linesById?.[chosen.id] === 0) {
    return { persona: resolvePersona(list, DEFAULT_COMMENTATOR, lang), chosen, fallback: true };
  }
  return { persona: chosen, chosen, fallback: false };
}

/** {personaId: reason} for the commentator menu: personas with no lines for this run. */
export function unavailablePersonas(list, linesById = {}, reason = "no lines") {
  const out = {};
  for (const p of list ?? []) if (needsLines(p) && linesById?.[p.id] === 0) out[p.id] = reason;
  return out;
}

function pct(x) {
  return `${Math.round((Number(x) || 0) * 100)}%`;
}

/**
 * Status lines for «Проверить голос». `info`: {chosen, setting, diag (the
 * narrator's diagnostics()), result ({ok, used, error} or null while
 * speaking), voices: {ru: [...], he: [...], en: [...]}, activation (bool|null),
 * persona, chosenPersona, lines (number|null), personaFallback, lang}.
 */
export function voiceStatusLines(info, lang = "ru") {
  // Shown on screen: the interface language when one is chosen.
  const shown = labelLanguage(lang);
  const ru = shown !== "en" && shown !== "he";
  const L = (r, e) => (ru ? r : e);
  const d = info?.diag ?? {};
  const yes = (v) => (v == null ? "?" : v ? L("да", "yes") : L("нет", "no"));
  const lines = [];
  lines.push(`${L("Голос выбран", "Chosen engine")}: ${info?.chosen ?? "—"}${info?.setting && info.setting !== info.chosen ? ` (${L("в настройках", "setting")}: ${info.setting})` : ""}`);
  const used = info?.result ? info.result.used : null;
  lines.push(`${L("Говорит", "Speaking with")}: ${used ?? d.speaker ?? "—"}${info?.result == null ? L(" (проверка идёт…)", " (testing…)") : ""}`);
  let piper = L("не используется", "not used");
  if (String(d.engine ?? "").startsWith("piper:")) {
    const state = d.engineState ?? "idle";
    piper =
      state === "ready"
        ? L("готова", "ready")
        : state === "loading"
          ? `${L("загрузка", "loading")} ${pct(d.engineProgress)}`
          : state === "failed"
            ? `${L("ошибка", "error")}: ${d.engineError ?? "?"}`
            : L("не загружена", "not loaded");
  }
  lines.push(`${L("Модель Piper", "Piper model")}: ${piper}`);
  for (const code of ["ru", "he", "en"]) {
    const names = info?.voices?.[code] ?? [];
    lines.push(`${L("Голоса браузера", "Browser voices")} ${code}: ${names.length ? names.join(", ") : L("нет", "none")}`);
  }
  lines.push(`${L("Звук разрешён (жест был)", "Audio unlocked")}: ${yes(d.unlocked || info?.activation)}${d.blocked ? L(" — браузер блокирует", " — blocked by the browser") : ""}`);
  const who = info?.chosenPersona?.name ?? info?.chosenPersona?.id ?? d.persona ?? "—";
  let linesText = "";
  if (needsLines(info?.chosenPersona)) {
    linesText =
      info?.lines == null
        ? L(" · реплики: проверяются", " · lines: checking")
        : info.lines > 0
          ? L(` · реплик для этого видео: ${info.lines}`, ` · lines for this video: ${info.lines}`)
          : L(" · реплик для этого видео нет — говорит Душнила", " · no lines for this video: Dushnila speaks");
  } else if (d.textsStatus) {
    linesText = L(` · тексты: ${d.textsStatus}, ${d.lines ?? 0}`, ` · texts: ${d.textsStatus}, ${d.lines ?? 0}`);
  }
  lines.push(`${L("Комментатор", "Commentator")}: ${who}${linesText}`);
  lines.push(`${L("Озвучка флажков", "Flag narrator")}: ${d.enabled ? L("вкл", "on") : L("выкл", "off")}${d.stops != null ? L(`, остановок: ${d.stops}`, `, stops: ${d.stops}`) : ""}`);
  const err = info?.result?.error ?? d.lastError;
  lines.push(`${L("Последняя ошибка", "Last error")}: ${err || "—"}`);
  if (info?.result) lines.push(info.result.ok ? L("✓ Фраза прозвучала", "✓ The phrase was spoken") : L("✗ Не прозвучало", "✗ Nothing was spoken"));
  return lines;
}
