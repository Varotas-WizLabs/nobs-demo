// web/src/nerdToggle.js
//
// Hides the technical "Processing log" of a finished analysis behind a quiet
// «For nerds» button. While the run is still in progress (or has failed) the
// log stays visible: then it is the progress / error display, not trivia.
// The viewer's choice (shown / hidden) is remembered in localStorage.

const KEY = "nobs.forNerds";

function readPref(storage) {
  try {
    return storage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writePref(storage, on) {
  try {
    storage?.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

/** Put the «For nerds» button before `section` and manage its visibility. */
export function mountNerdToggle(section, { doc = globalThis.document, storage = globalThis.localStorage } = {}) {
  if (!section) return null;
  let on = readPref(storage);
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "nobs-nerd-toggle";
  section.before(button);

  const state = () => section.querySelector(".nobs-log")?.dataset.state || "pending";
  const render = () => {
    const finished = state() === "complete";
    // Active or failed runs always show their log; no toggle needed then.
    button.hidden = !finished;
    section.hidden = finished && !on;
    button.textContent = on ? "Hide nerd stuff" : "For nerds";
    button.setAttribute("aria-expanded", String(!section.hidden));
  };
  button.addEventListener("click", () => {
    on = !on;
    writePref(storage, on);
    render();
  });
  const Observer = globalThis.MutationObserver;
  if (Observer) {
    new Observer(render).observe(section, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
  }
  render();
  return { button, render };
}
