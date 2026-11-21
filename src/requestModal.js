// web/src/requestModal.js
//
// The «Question a video» lightbox opened from the top bar (src/accountMenu.js):
// the signed-in request form of the account page (src/requestForm.js) in a
// modal dialog. Esc, the backdrop and the close button close it and focus goes
// back to the button that opened it; the page underneath stays where it was.

import { t } from "./i18n.js?v=78dbe39118";
import { buildRequestForm, fill } from "./requestForm.js?v=78dbe39118";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function el(doc, tag, attrs = {}, text = "") {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

/**
 * Open the lightbox. `client` is the accounts client (myPlan, publicSettings,
 * createRequest). Returns {close, root, form}. Only one is open at a time.
 */
export function openRequestModal({ doc = globalThis.document, client, lang = "ru", opener = null, accountHref = "account.html", storage = globalThis.localStorage } = {}) {
  doc.querySelector(".nobs-modal-backdrop")?.remove();
  const tt = (key, values) => fill(t(key, lang), values ?? {});
  const backdrop = el(doc, "div", { class: "nobs-modal-backdrop" });
  const dialog = el(doc, "div", { class: "nobs-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "nobs-modal-title" });
  const head = el(doc, "div", { class: "nobs-modal-head" });
  const title = el(doc, "h2", { id: "nobs-modal-title" }, tt("menu.ask"));
  const closeButton = el(doc, "button", { type: "button", class: "nobs-modal-close", "aria-label": tt("menu.askClose"), title: tt("menu.askClose") }, "×");
  head.append(title, closeButton);

  const message = el(doc, "div", { class: "nobs-account-message nobs-modal-message", role: "status" });
  message.hidden = true;
  const showMessage = (text, info) => {
    message.replaceChildren();
    message.hidden = !text;
    if (!text) return;
    message.append(el(doc, "span", {}, text));
    const player = info?.request?.player_url;
    if (typeof player === "string" && /^https?:\/\//.test(player)) {
      message.append(" ", el(doc, "a", { class: "nobs-account-open", href: player }, tt("account.open")));
    }
    message.append(" ", el(doc, "a", { href: accountHref }, tt("account.videosTitle")));
  };

  const request = buildRequestForm(doc, { lang, storage, idPrefix: "ask", submitKey: "menu.askSubmit", getClient: () => client, showMessage });
  const code = el(doc, "a", { class: "nobs-modal-code", href: accountHref }, tt("menu.askHaveCode"));
  dialog.append(head, request.form, request.error, message, code);
  backdrop.append(dialog);
  doc.body.append(backdrop);
  doc.documentElement.classList.add("nobs-modal-open");

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    doc.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    doc.documentElement.classList.remove("nobs-modal-open");
    // The top bar may have been redrawn meanwhile (auth change): find the button again.
    const back = opener?.isConnected ? opener : doc.querySelector(".nobs-account-ask");
    back?.focus?.();
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && !n.closest("[hidden]"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  doc.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  closeButton.addEventListener("click", close);
  request.ui.url.focus();

  // Plan (Deep gating) and prices arrive after the dialog is already usable.
  Promise.resolve()
    .then(() => client?.myPlan?.())
    .then((r) => {
      if (r && !r.error && !closed) request.setPlan(r.data);
    })
    .catch(() => {});
  Promise.resolve()
    .then(() => client?.publicSettings?.())
    .then((r) => {
      if (r && !r.error && !closed) request.setSettings(r.data);
    })
    .catch(() => {});

  return { close, root: backdrop, form: request };
}
