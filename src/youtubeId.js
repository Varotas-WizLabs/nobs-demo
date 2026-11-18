// web/src/youtubeId.js
//
// YouTube URL -> canonical 11-character video ID (spec
// docs/superpowers/specs/2026-11-18-accounts-design.md §2b). The same rules
// as the backend's nobs.youtube.extract_video_id, checked against the same
// table (tests/fixtures/youtube_urls.json at the repo root). A copy of this
// file is the queue Worker's workers/nobs-queue/src/youtubeId.js (its tests
// check the two stay identical). Pure ES module, no DOM.
//
// Accepted: watch (?v= -- the first v; v in the fragment as a fallback --
// and /watch/ID), youtu.be, shorts, live, embed, /v/ and /e/ on youtube.com
// and its m./music./kids./gaming. hosts, youtube-nocookie embeds,
// attribution links (u), consent / sign-in wrappers (continue) and oEmbed
// (url) -- unwrapped at most 3 deep --, any host letter case, http/https or
// no scheme, a bare 11-character id, and any of these in brackets, quotes or
// followed by sentence punctuation. IDs keep their case.
// Rejected (reason): playlist (also /embed/videoseries), channel, search,
// feed, post, clip (a clip id is not a video id; the server resolves it),
// invalid, not_youtube, too_deep.

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
// Every id seen so far is a 64-bit number: its last character is one of these.
const ID_LAST_CHARS = "AEIMQUYcgkosw048";
const YOUTUBE_HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "kids.youtube.com", "gaming.youtube.com"]);
const NOCOOKIE_HOSTS = new Set(["youtube-nocookie.com"]);
const CONTINUE_HOSTS = new Set(["consent.youtube.com", "accounts.google.com"]);
const MAX_WRAP_DEPTH = 3;
const ENCLOSING = "<>()[]\"'«»“”„";
const TRAILING = ".,!?:;…";
const ID_PATH_PREFIXES = new Set(["shorts", "live", "embed", "v", "e", "watch"]);
const NOT_A_VIDEO = { playlist: "playlist", results: "search", feed: "feed", post: "post", channel: "channel", c: "channel", user: "channel" };

function trimChars(text, chars, start, end) {
  let a = 0;
  let b = text.length;
  if (start) while (a < b && chars.includes(text[a])) a += 1;
  if (end) while (b > a && chars.includes(text[b - 1])) b -= 1;
  return text.slice(a, b);
}

/** `text` without the whitespace, brackets, quotes and trailing sentence
 * punctuation around a pasted link (repeated: «(https://youtu.be/x).»). */
export function stripLinkPunctuation(text) {
  let previous = null;
  let out = String(text ?? "");
  while (out !== previous) {
    previous = out;
    out = trimChars(trimChars(out.trim(), ENCLOSING, true, true), TRAILING, false, true);
  }
  return out;
}

function valid(id) {
  if (typeof id !== "string" || !VIDEO_ID_RE.test(id)) return { id: null, reason: "invalid" };
  if (!ID_LAST_CHARS.includes(id[10])) console.warn(`YouTube video id ${id} ends in an unusual character (accepted)`);
  return { id, reason: null };
}

function extract(input, depth) {
  if (depth > MAX_WRAP_DEPTH) return { id: null, reason: "too_deep" };
  let text = stripLinkPunctuation(input);
  if (VIDEO_ID_RE.test(text)) return valid(text);
  if (text.startsWith("//")) text = `https:${text}`;
  else if (!text.includes("://")) text = `https://${text}`;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { id: null, reason: "not_youtube" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { id: null, reason: "not_youtube" };
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  const query = parsed.searchParams;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const first = parts.length ? parts[0].toLowerCase() : "";
  const value = (params, name) => params.get(name) || null;
  const unwrap = (target) => {
    if (!target) return { id: null, reason: "invalid" };
    return extract(target.startsWith("/") ? `https://www.youtube.com${target}` : target, depth + 1);
  };

  if (CONTINUE_HOSTS.has(host)) return unwrap(value(query, "continue"));

  if (YOUTUBE_HOSTS.has(host)) {
    if (first === "watch" && parts.length === 1) {
      return valid(value(query, "v") ?? value(new URLSearchParams(parsed.hash.replace(/^#/, "")), "v"));
    }
    if (first === "attribution_link") return unwrap(value(query, "u"));
    if (first === "oembed") return unwrap(value(query, "url"));
    if (first === "clip") return { id: null, reason: "clip" };
    if (first === "embed" && (parts.length < 2 || parts[1] === "videoseries")) {
      if (parts.length >= 2 || value(query, "list")) return { id: null, reason: "playlist" };
    }
    if (ID_PATH_PREFIXES.has(first) && parts.length >= 2) return valid(parts[1]);
    let reason = Object.hasOwn(NOT_A_VIDEO, first) ? NOT_A_VIDEO[first] : null;
    if (reason === "channel" && parts.length < 2) reason = null;
    if (first.startsWith("@") && first.length > 1) reason = "channel";
    return { id: null, reason: reason ?? "invalid" };
  }

  if (NOCOOKIE_HOSTS.has(host)) {
    if (first === "embed" && parts[1] === "videoseries") return { id: null, reason: "playlist" };
    if (["embed", "v", "e"].includes(first) && parts.length >= 2) return valid(parts[1]);
    return { id: null, reason: "invalid" };
  }

  if (host === "youtu.be") return valid(parts[0]);

  return { id: null, reason: "not_youtube" };
}

/** {id, reason}: the canonical video id of `text` (reason null), or id null
 * and why (see the header). */
export function youtubeVideoId(text) {
  if (typeof text !== "string") return { id: null, reason: "not_youtube" };
  return extract(text, 0);
}

/** The canonical 11-character video id of `text`, or null. */
export function extractVideoId(text) {
  return youtubeVideoId(text).id;
}
