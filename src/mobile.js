// web/src/mobile.js
//
// Phones and tablets: what the player does differently on a touch device.
//
// - isMobileDevice(): a coarse primary pointer (a finger, matchMedia
//   "(pointer: coarse)") with no fine pointer anywhere, or the browser saying
//   so (navigator.userAgentData.mobile, Chromium). No user-agent sniffing
//   beyond a last-resort check for iOS, whose Safari has no userAgentData.
// - playerVars(): the YouTube IFrame player parameters. playsinline: 1 so an
//   iPhone plays the video in the page (with our control bar, flags and
//   narrator) instead of its native fullscreen player.
// - The default Russian voice on a phone is the browser's own (Web Speech:
//   speaks at once, nothing to download); Piper (a ~63 MB model, slow
//   synthesis on a phone CPU) stays selectable. When Piper is chosen on a
//   phone, the narrator asks for each flag's audio MOBILE_PIPER_LEAD_SEC
//   ahead instead of voice.js LEAD_SEC.
// - Fullscreen: iPhone Safari has no Element.requestFullscreen for a div;
//   there the container fills the window instead (canFullscreen()).

export const MOBILE_PIPER_LEAD_SEC = 10;

function media(win, query) {
  try {
    return Boolean(win?.matchMedia?.(query)?.matches);
  } catch {
    return false;
  }
}

/** iPhone / iPad / iPod (iPadOS reports a Mac with touch). */
export function isIOS(win = globalThis) {
  const nav = win?.navigator;
  if (!nav) return false;
  const ua = String(nav.userAgent ?? "");
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1;
}

/** A phone or tablet: a finger as the main pointer and no mouse, or the browser says "mobile". */
export function isMobileDevice(win = globalThis) {
  if (win?.navigator?.userAgentData?.mobile === true) return true;
  if (media(win, "(pointer: coarse)") && !media(win, "(any-pointer: fine)")) return true;
  return isIOS(win);
}

/** The YouTube IFrame player parameters (controls hidden, captions not forced, inline on iOS). */
export function playerVars() {
  return { controls: 0, cc_load_policy: 0, playsinline: 1 };
}

/** The Russian voice used when the viewer has not chosen one. */
export function defaultRussianEngine(mobile = false) {
  return mobile ? "system" : "piper:dmitri";
}

/** How many seconds ahead the narrator asks for a flag's audio with `engineId`. */
export function narratorLeadSec(engineId, { mobile = false, base = 5 } = {}) {
  return mobile && String(engineId ?? "").startsWith("piper:") ? MOBILE_PIPER_LEAD_SEC : base;
}

/** True when `el` can enter real fullscreen (Fullscreen API, incl. the webkit prefix). */
export function canFullscreen(el) {
  return Boolean(el && (typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function"));
}

/**
 * A persona's own voice (commentators "voices.ru", e.g. "piper:denis") is
 * used on a phone only when it is not Piper or the viewer chose a Piper
 * voice in the settings: otherwise the phone would download ~63 MB behind
 * the viewer's back. On a computer the persona's voice always applies.
 */
export function personaVoiceAllowed(own, chosen, mobile = false) {
  if (!own) return false;
  if (!mobile || !String(own).startsWith("piper:")) return true;
  return String(chosen ?? "").startsWith("piper:");
}
