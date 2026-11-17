// web/src/holdIcon.js
//
// The big "pause" sign (two vertical bars) shown centred over the video while
// the flag narrator holds the video paused to speak. The bars take the colour
// of the flag being read (the --nobs-<flag> colours, see styles.css). Entry
// and exit play a short "pressed" bounce (CSS, .is-in / .is-out); a viewer
// taking over hides it at once. It never takes clicks (pointer-events: none).
// Lives inside #player-container so it shows in fullscreen too.

export const OUT_MS = 260;

export function createHoldIcon(container, doc = container.ownerDocument) {
  const root = doc.createElement("div");
  root.className = "nobs-voice-hold";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  root.append(doc.createElement("span"), doc.createElement("span"));
  container.appendChild(root);
  let outTimer = null;

  function clearOut() {
    if (outTimer !== null) {
      clearTimeout(outTimer);
      outTimer = null;
    }
  }

  function setFlag(claim) {
    const flag = claim?.flag;
    root.dataset.flag = ["red", "yellow", "green", "white"].includes(flag) ? flag : "white";
  }

  return {
    element: root,
    /** The narrator paused the video for `claim`. */
    hold(claim) {
      clearOut();
      setFlag(claim);
      root.classList.remove("is-out", "is-in");
      root.hidden = false;
      // Restart the entry animation.
      void root.offsetWidth;
      root.classList.add("is-in");
    },
    /** The next flag's speech starts: switch the colour. */
    item(claim) {
      if (!root.hidden) setFlag(claim);
    },
    /** The hold ends: bounce out (`animate`) or vanish (the viewer took over). */
    release({ animate = false } = {}) {
      clearOut();
      root.classList.remove("is-in");
      if (!animate || root.hidden) {
        root.classList.remove("is-out");
        root.hidden = true;
        return;
      }
      root.classList.add("is-out");
      outTimer = setTimeout(() => {
        outTimer = null;
        root.classList.remove("is-out");
        root.hidden = true;
      }, OUT_MS);
    },
  };
}
