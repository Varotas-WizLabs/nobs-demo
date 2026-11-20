// web/src/requestForm.js
//
// The signed-in «Question a video» form: YouTube link, effort picker (Deep
// locked until the plan is Pro), visibility, price line and the submit button.
// Shared by the account page (src/accountPage.js) and the top bar's lightbox
// (src/requestModal.js), so both behave the same.

import { t } from "./i18n.js?v=5fa56d3ec5";
import { youtubeVideoId } from "./youtubeId.js?v=5fa56d3ec5";
import { buildEffortPicker, loadEffort, saveEffort } from "./effort.js?v=5fa56d3ec5";

export const VISIBILITIES = ["public", "unlisted", "private"];

export function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (values[k] != null ? String(values[k]) : m));
}

/** The visitor-facing text of an accounts error code (`context`: redeem, signin or none). */
export function accountErrorText(code, lang, context = null) {
  const c = code || "other";
  if (context) {
    const specific = t(`account.error.${context}.${c}`, lang);
    if (specific !== `account.error.${context}.${c}`) return specific;
  }
  const general = t(`account.error.${c}`, lang);
  return general === `account.error.${c}` ? t("account.error.other", lang) : general;
}

function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else if (k === "hidden") node.hidden = Boolean(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/**
 * Build the form. `idPrefix` names the element ids ("account" keeps the
 * account page's ids). `getClient()` returns the accounts client at submit time.
 * `onCreated({id, kind, text, asked, request})` runs after a successful request
 * and may return an extra sentence to append; `showMessage(text)` shows the
 * confirmation. Returns {form, error, ui, setPlan, setSettings, submit}.
 */
export function buildRequestForm(doc, {
  lang,
  storage = null,
  idPrefix = "account",
  submitKey = "account.submit",
  getClient,
  onCreated = null,
  showMessage = () => {},
} = {}) {
  const tt = (key, values) => fill(t(key, lang), values ?? {});
  const ui = {};

  const fieldset = el(doc, "fieldset", { class: "nobs-effort nobs-account-visibility", id: `${idPrefix}-visibility` },
    el(doc, "legend", { text: tt("account.visibility") }));
  for (const v of VISIBILITIES) {
    const input = el(doc, "input", { type: "radio", name: `${idPrefix}-visibility`, value: v });
    input.checked = v === "public";
    fieldset.append(el(doc, "label", { class: "nobs-effort-option" }, input,
      el(doc, "span", { class: "nobs-effort-text" },
        el(doc, "strong", { text: tt(`account.vis.${v}`) }),
        el(doc, "small", { text: tt(`account.vis.${v}Hint`) }))));
  }
  fieldset.append(el(doc, "small", { class: "nobs-account-note", text: tt("account.vis.ytCap") }));
  ui.visibility = { root: fieldset, value: () => fieldset.querySelector("input:checked")?.value ?? "public" };

  ui.url = el(doc, "input", { type: "url", id: `${idPrefix}-url`, placeholder: "https://www.youtube.com/watch?v=...", autocomplete: "off", required: true });
  ui.effort = buildEffortPicker(doc, { lang, value: loadEffort(storage), onChange: (v) => saveEffort(v, storage), name: `${idPrefix}-effort`, proBadge: true, disabled: { deep: tt("account.pro.deepLocked") } });
  ui.effort.deepLocked = true; // until my_plan says Pro
  ui.price = el(doc, "p", { class: "nobs-account-note", id: `${idPrefix}-price`, hidden: true });
  ui.submit = el(doc, "button", { type: "submit", id: `${idPrefix}-submit`, text: tt(submitKey) });
  const error = el(doc, "p", { class: "nobs-request-error", id: `${idPrefix}-request-error`, role: "alert", hidden: true });
  const form = el(doc, "form", { class: "nobs-request-form", id: `${idPrefix}-request-form`, novalidate: true },
    el(doc, "label", { class: "nobs-request-field" }, el(doc, "span", { text: tt("account.url") }), ui.url),
    ui.effort.root, ui.visibility.root, ui.price, ui.submit);

  // Pro: Deep enabled; otherwise (also when my_plan failed) Deep is locked and
  // a saved «Deep» falls back to Light without being forgotten.
  function setPlan(plan) {
    if (!plan?.pro) {
      if (!ui.effort.deepLocked) {
        ui.effort.deepLocked = true;
        ui.effort.setDeepDisabled(tt("account.pro.deepLocked"));
      }
      return;
    }
    if (ui.effort.deepLocked) {
      ui.effort.deepLocked = false;
      ui.effort.setDeepDisabled(null);
      ui.effort.set(loadEffort(storage));
    }
  }

  function setSettings(s) {
    if (!s) return;
    ui.price.textContent = s.accepting === false ? tt("account.notAccepting")
      : tt("account.price", { light: s.light_cost, deep: s.deep_cost, upgrade: s.upgrade_cost });
    ui.price.hidden = false;
  }

  async function submit() {
    error.hidden = true;
    showMessage(null);
    const { id, reason } = youtubeVideoId(ui.url.value.trim());
    if (!id) {
      error.textContent = t(reason === "clip" ? "request.error.clip" : "request.error.bad_url", lang);
      error.hidden = false;
      return reason === "clip" ? "clip" : "bad_url";
    }
    ui.submit.disabled = true;
    const r = await getClient().createRequest(id, ui.effort.value(), ui.visibility.value());
    ui.submit.disabled = false;
    if (r.error) {
      error.textContent = accountErrorText(r.error, lang);
      error.hidden = false;
      return r.error;
    }
    const request = r.data ?? {};
    const asked = ui.visibility.value();
    const kind = request.joined_to ? "joined" : request.status === "done" ? "done" : "queued";
    const created = request.allowance === true && kind === "queued" ? "allowance" : kind;
    let text = tt(`account.created.${created}`, { cost: Number(request.cost) || 0 });
    ui.url.value = "";
    const extra = await onCreated?.({ id, kind, text, asked, request });
    if (extra) text += " " + extra;
    showMessage(text, { id, kind, request });
    return kind;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  return { form, error, ui, setPlan, setSettings, submit };
}
