// web/src/sidePanel.js
//
// Collapsible side panels on the player page (the analyses library on the
// left, the claim list on the right): a toggle button with an icon, and the
// collapsed state on the panel's data-collapsed (CSS narrows the panel to a
// rail). Panels start collapsed. Icons are built with DOM APIs.

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(doc, paths) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/** A "list" icon: three bullets and lines. */
export function listIcon(doc) {
  return icon(doc, ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6h.01", "M4 12h.01", "M4 18h.01"]);
}

/** A "download" icon: an arrow down onto a tray. */
export function downloadIcon(doc) {
  return icon(doc, ["M12 4v11", "m7 10 5 5 5-5", "M5 20h14"]);
}

/** A "library" icon: books on a shelf, one leaning. */
export function libraryIcon(doc) {
  return icon(doc, ["m16 6 4 14", "M12 6v14", "M8 8v12", "M4 4v16"]);
}

export function isCollapsed(panel) {
  return panel.dataset.collapsed !== "false";
}

/**
 * Set the panel's state: data-collapsed, the toggle's aria-expanded and
 * label, and `hidden` on the content element.
 */
export function setCollapsed(panel, collapsed) {
  panel.dataset.collapsed = String(collapsed);
  const toggle = panel.querySelector(".nobs-side-toggle[aria-controls]");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.title = collapsed ? toggle.dataset.showLabel : toggle.dataset.hideLabel;
    toggle.setAttribute("aria-label", toggle.title);
  }
  const contentId = toggle?.getAttribute("aria-controls");
  const content = contentId ? panel.querySelector(`#${contentId}`) : null;
  if (content) content.hidden = collapsed;
}

/**
 * A toggle button for `panel` that shows/hides the element with id
 * `contentId` inside it. The caller places the button.
 */
export function makePanelToggle(panel, { contentId, makeIcon, showLabel, hideLabel }) {
  const doc = panel.ownerDocument;
  if (panel.dataset.collapsed === undefined) panel.dataset.collapsed = "true";
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "nobs-side-toggle";
  toggle.dataset.showLabel = showLabel;
  toggle.dataset.hideLabel = hideLabel;
  toggle.setAttribute("aria-controls", contentId);
  toggle.appendChild(makeIcon(doc));
  toggle.addEventListener("click", () => setCollapsed(panel, !isCollapsed(panel)));
  return toggle;
}
