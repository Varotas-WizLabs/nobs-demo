// web/src/holdIcon.js
//
// The big "pause" sign (two vertical bars) shown centred over the video while
// the flag narrator holds the video paused to speak. The bars take the colour
// of the flag being read (the --nobs-<flag> colours, see styles.css). Entry
// and exit play a short "pressed" bounce (CSS, .is-in / .is-out); a viewer
// taking over hides it at once. It never takes clicks (pointer-events: none).
// Lives inside #player-container so it shows in fullscreen too.
//
// Commentators: a scoop stop draws the bars in the accent colour
// (data-flag="scoop"); a parody persona speaking gets a caption under the
// sign («📱 Яблогер · пародия», option `caption`), visible for the whole hold
// and gone with the sign (G1: the parody is always labelled).

export const OUT_MS = 260;

export function createHoldIcon(container, doc = container.ownerDocument) {
  const root = doc.createElement("div");
  root.className = "nobs-voice-hold";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  root.append(doc.createElement("span"), doc.createElement("span"));
  const caption = doc.createElement("p");
  caption.className = "nobs-voice-hold-caption";
  caption.setAttribute("role", "status");
  caption.hidden = true;
  container.append(root, caption);
  let outTimer = null;

  function clearOut() {
    if (outTimer !== null) {
      clearTimeout(outTimer);
      outTimer = null;
    }
  }

  function setFlag(claim) {
    const flag = claim?.flag;
    root.dataset.flag = ["red", "yellow", "green", "white", "scoop"].includes(flag) ? flag : "white";
  }

  function setCaption(text) {
    if (text === undefined) return;
    caption.textContent = String(text ?? "");
    caption.hidden = !caption.textContent;
    caption.setAttribute("aria-hidden", String(caption.hidden));
  }

  function hideCaption() {
    caption.hidden = true;
    caption.textContent = "";
    caption.setAttribute("aria-hidden", "true");
  }

  return {
    element: root,
    caption,
    /** The narrator paused the video for `claim` (a stop). `caption`: the
     * parody label shown under the sign, "" for none. */
    hold(claim, { caption: text = "" } = {}) {
      clearOut();
      setFlag(claim);
      setCaption(text);
      root.classList.remove("is-out", "is-in");
      root.hidden = false;
      // Restart the entry animation.
      void root.offsetWidth;
      root.classList.add("is-in");
    },
    /** The next flag's speech starts: switch the colour. */
    item(claim, { caption: text } = {}) {
      if (root.hidden) return;
      setFlag(claim);
      setCaption(text);
    },
    /** The hold ends: bounce out (`animate`) or vanish (the viewer took over). */
    release({ animate = false } = {}) {
      clearOut();
      root.classList.remove("is-in");
      if (!animate || root.hidden) {
        root.classList.remove("is-out");
        root.hidden = true;
        hideCaption();
        return;
      }
      root.classList.add("is-out");
      outTimer = setTimeout(() => {
        outTimer = null;
        root.classList.remove("is-out");
        root.hidden = true;
        hideCaption();
      }, OUT_MS);
    },
  };
}
