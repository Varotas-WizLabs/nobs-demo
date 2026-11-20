// web/src/channelAvatar.js
//
// A channel's avatar disc on the home page (cards, result rows, search
// suggestions): the channel's picture when the run list carries one
// (`channel_avatar`, a relative data/avatars/<hash>.jpg cached at build time,
// see nobs.search_index), else the channel's initial on a neutral tone picked
// by a hash of the name. The tones are a grey ramp mixed from the theme's
// text and surface tokens: never the brand spectrum, never a verdict colour.
// Decorative (aria-hidden): the channel's name is always in the text beside it.

export const AVATAR_TONES = 6;
const AVATAR_SRC_RE = /^data\/avatars\/[0-9a-f]{16}\.jpg$/;

/** A stable tone 0..AVATAR_TONES-1 for a channel name (FNV-1a). */
export function avatarTone(name) {
  let h = 0x811c9dc5;
  for (const ch of String(name ?? "").trim()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % AVATAR_TONES;
}

/** The disc: `cls` is the size class (nobs-hp-avatar, nobs-hp-suggest-avatar). */
export function channelAvatar(doc, { name, src } = {}, cls = "nobs-hp-avatar") {
  const label = String(name ?? "").trim();
  const disc = doc.createElement("span");
  disc.className = `${cls} nobs-avatar-tone-${avatarTone(label)}`;
  disc.setAttribute("aria-hidden", "true");
  disc.textContent = label.charAt(0).toUpperCase() || "?";
  if (AVATAR_SRC_RE.test(String(src ?? ""))) {
    const img = doc.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 36;
    img.height = 36;
    disc.classList.add("nobs-avatar-pic");
    // A picture that fails to load leaves the initial underneath.
    img.addEventListener("error", () => {
      img.remove();
      disc.classList.remove("nobs-avatar-pic");
    });
    disc.append(img);
  }
  return disc;
}
