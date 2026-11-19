// web/src/accountPage.js
//
// account.html (spec 2026-11-18-accounts §1, §2a, §6 P1; dark: nothing links
// to it yet): sign-in by e-mail (a link and a 6-10 digit code from the same
// e-mail), the balance, an invite-code box (a code that came in the link is
// redeemed once after sign-in), the request form (Light / Deep, visibility
// with Public preselected, the prices) and «Мои видео» (status, open, the
// visibility switch, the Unlisted link, cancel). All data comes from the
// Supabase project through src/accountsClient.js; nothing here talks to the
// local server's private API.

import { t } from "./i18n.js?v=4f390fa6da";
import { pickLang } from "./publicRequest.js?v=4f390fa6da";
import { youtubeVideoId } from "./youtubeId.js?v=4f390fa6da";
import { buildEffortPicker, loadEffort, saveEffort } from "./effort.js?v=4f390fa6da";
import { loadAccountsConfig } from "./accountsConfig.js?v=4f390fa6da";
import { createAccountsClient } from "./accountsClient.js?v=4f390fa6da";
import { captureInviteCode, clearPendingCode, pageUrlWithoutInvite, takePendingCode } from "./pendingCode.js?v=4f390fa6da";

export const DEMO_BASE = "https://varotas-wizlabs.github.io/nobs-demo/";
export const POLL_ACTIVE_MS = 10000;
export const POLL_IDLE_MS = 60000;
export const OFFLINE_AFTER_MS = 15 * 60 * 1000;
export const VISIBILITIES = ["public", "unlisted", "private"];
const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const FAILED_REASONS = ["too_long", "unavailable", "no_captions", "expired", "error"];
export const OTP_STEP_KEY = "nobs.account.otpStep";
export const OTP_STEP_TTL_MS = 60 * 60 * 1000; // the code in the e-mail lives 1 h
export const NEXT_KEY = "nobs.account.next";
export const NEXT_TTL_MS = 60 * 60 * 1000;
const AUTH_LINK_PARAMS = ["error", "error_code", "error_description"];

function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (values[k] != null ? String(values[k]) : m));
}

/** «N разборов» with the Russian plural (English: credit / credits). */
export function creditsText(n, lang) {
  const v = Math.abs(Number(n) || 0);
  let key = "account.balance";
  if (lang === "en") key = v === 1 ? "account.balanceOne" : "account.balance";
  else if (v % 10 === 1 && v % 100 !== 11) key = "account.balanceOne";
  else if ([2, 3, 4].includes(v % 10) && ![12, 13, 14].includes(v % 100)) key = "account.balanceFew";
  return fill(t(key, lang), { n: Number(n) || 0 });
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

/** The status line of a «Мои видео» row's latest request. */
export function videoStatusText(request, lang) {
  if (!request) return t("account.status.none", lang);
  const refunded = request.refunded ? ` (${t("account.status.refunded", lang)})` : "";
  switch (request.status) {
    case "queued":
      return t("account.status.queued", lang);
    case "processing":
      if (Number(request.progress) >= 99) return t("account.status.publishing", lang);
      return fill(t("account.status.processing", lang), { pct: Number(request.progress) || 0 });
    case "done":
      return t("account.status.done", lang);
    case "cancelled":
      if (request.reason === "leader_cancelled") return t("account.status.leaderCancelled", lang);
      return t("account.status.cancelled", lang) + refunded;
    case "failed":
      return t(`account.failed.${FAILED_REASONS.includes(request.reason) ? request.reason : "error"}`, lang) + refunded;
    default:
      return t("account.status.none", lang);
  }
}

/** The absolute Unlisted link to give out: watch.html?v=ID&t=TOKEN on the demo. */
export function shareLink(videoId, token, base = DEMO_BASE) {
  if (!VIDEO_RE.test(videoId ?? "") || !TOKEN_RE.test(token ?? "")) return null;
  return `${base}watch.html?v=${videoId}&t=${token}`;
}

/**
 * An e-mail sign-in link that came back with an error (expired or used:
 * ?error=…&error_code=otp_expired, in the query or the fragment). Returns
 * {failed, cleanHref}: cleanHref is the address without those parameters, or
 * null when there was nothing to remove.
 */
export function authLinkError(href) {
  let u;
  try {
    u = new URL(String(href ?? ""));
  } catch {
    return { failed: false, cleanHref: null };
  }
  const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
  const failed = AUTH_LINK_PARAMS.some((k) => u.searchParams.has(k) || hash.has(k));
  if (!failed) return { failed: false, cleanHref: null };
  for (const k of AUTH_LINK_PARAMS) {
    u.searchParams.delete(k);
    hash.delete(k);
  }
  hash.delete("sb");
  const rest = hash.toString();
  u.hash = rest ? `#${rest}` : "";
  return { failed: true, cleanHref: u.toString() };
}

/** A PKCE sign-in ?code=<uuid> in the address (not an invite code NOBS-…). */
export function pkceCodeIn(href) {
  try {
    const code = new URL(String(href ?? "")).searchParams.get("code");
    return Boolean(code) && !/^NOBS-/i.test(code);
  } catch {
    return false;
  }
}

/**
 * The page to go back to after sign-in (?next=, from watch.html's «Войти»):
 * only a same-origin watch.html address with a video id. null otherwise.
 */
export function safeNext(value, origin) {
  if (!value) return null;
  try {
    const u = new URL(String(value), origin);
    if (u.origin !== origin || !/\/watch\.html$/.test(u.pathname)) return null;
    if (!VIDEO_RE.test(u.searchParams.get("v") ?? "")) return null;
    const t = u.searchParams.get("t");
    if (t != null && !TOKEN_RE.test(t)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function storageGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // private mode: the page works without it
  }
}

/** Whether a row's request is still waiting or running. */
export function isActive(row) {
  return ["queued", "processing"].includes(row?.request?.status);
}

/** The server is offline when its heartbeat is missing or older than 15 min. */
export function serverOffline(heartbeatAt, now) {
  const at = Date.parse(heartbeatAt ?? "");
  return !Number.isFinite(at) || now - at > OFFLINE_AFTER_MS;
}

function formatDate(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" });
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
 * Mount the page into `root`. Dependencies are injectable for tests:
 * `client` (else created from `config`, else from loadAccountsConfig()),
 * `now`, `clipboard`, `confirmImpl`, `storages`, `location`, `history`.
 * Returns {ready (a promise), state, refresh, stop}.
 */
export function mountAccountPage({
  doc = globalThis.document,
  root,
  lang = pickLang(globalThis.location),
  location = globalThis.location,
  history = globalThis.history,
  storages,
  navigate = (url) => globalThis.location.assign(url),
  config,
  client,
  createClient,
  now = () => Date.now(),
  clipboard = globalThis.navigator?.clipboard,
  confirmImpl = (text) => globalThis.confirm?.(text) ?? false,
  demoBase = DEMO_BASE,
} = {}) {
  const tt = (key, values) => fill(t(key, lang), values ?? {});
  const state = { user: null, videos: [], balance: null, settings: null, offline: false, timer: null, stopped: false, redeemedPending: false, client: null, mode: "loading" };

  // The invite code in the link is taken (and removed from the address) before
  // supabase-js reads the address for a sign-in ?code=.
  const capturedCode = captureInviteCode(location, history, storages, now());
  const pendingCode = () => takePendingCode(storages, now());
  const session0 = storages?.[0];
  // The page's address as cleaned below (history.replaceState does not change a test double's href).
  let pageHref = (() => {
    // without the invite code captureInviteCode just took (query or #code=NOBS-…)
    try {
      const u = new URL(String(location?.href ?? ""));
      u.searchParams.delete("invite");
      if (/^NOBS-/i.test(u.searchParams.get("code") ?? "")) u.searchParams.delete("code");
      const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
      if (/^NOBS-/i.test(hash.get("code") ?? "")) {
        hash.delete("code");
        const rest = hash.toString();
        u.hash = rest ? `#${rest}` : "";
      }
      return u.toString();
    } catch {
      return String(location?.href ?? "");
    }
  })();

  // ?next= (watch.html's «Войти»): remembered in localStorage for 1 h (the
  // e-mail link opens a new tab) and removed from the address, so it never
  // rides along in the sign-in link; used once after sign-in.
  const origin = (() => {
    try {
      return new URL(String(location?.href ?? "")).origin;
    } catch {
      return null;
    }
  })();
  const local1 = storages?.[1];
  const nextStore = {
    take() {
      let v = null;
      try {
        v = JSON.parse(storageGet(local1, NEXT_KEY) || "null");
      } catch {
        v = null;
      }
      storageSet(local1, NEXT_KEY, null);
      if (!v || !Number.isFinite(v.at) || now() - v.at >= NEXT_TTL_MS) return null;
      return safeNext(v.url, origin);
    },
  };
  try {
    const u = new URL(pageHref);
    if (u.searchParams.has("next")) {
      const next = safeNext(u.searchParams.get("next"), origin);
      if (next) storageSet(local1, NEXT_KEY, JSON.stringify({ url: next, at: now() }));
      u.searchParams.delete("next");
      pageHref = u.toString();
      history?.replaceState?.(history.state ?? null, "", pageHref);
    }
  } catch {
    // no next
  }

  // An e-mail link that came back with an error: say so, and clean the address.
  const linkError = authLinkError(pageHref);
  if (linkError.failed) {
    state.signinError = "link_failed";
    pageHref = linkError.cleanHref;
    try {
      history?.replaceState?.(history.state ?? null, "", pageHref);
    } catch {
      // the message still shows
    }
  }

  const otpStep = {
    load() {
      try {
        const v = JSON.parse(storageGet(session0, OTP_STEP_KEY) || "null");
        if (v && typeof v.email === "string" && Number.isFinite(v.at) && now() - v.at < OTP_STEP_TTL_MS) return v;
      } catch {
        // ignore
      }
      return null;
    },
    save(email) {
      storageSet(session0, OTP_STEP_KEY, JSON.stringify({ email, at: now() }));
    },
    clear() {
      storageSet(session0, OTP_STEP_KEY, null);
    },
  };

  root.replaceChildren(el(doc, "p", { class: "nobs-account-loading", text: tt("account.loading") }));

  // ---------------------------------------------------------------- signed out
  function renderSignedOut() {
    state.mode = "signedOut";
    const email = el(doc, "input", { type: "email", id: "account-email", autocomplete: "email", required: true, inputmode: "email" });
    const send = el(doc, "button", { type: "submit", id: "account-send", text: tt("account.send") });
    const emailForm = el(doc, "form", { class: "nobs-request-form", id: "account-email-form", novalidate: true },
      el(doc, "label", { class: "nobs-request-field" }, el(doc, "span", { text: tt("account.email") }), email),
      send);
    const sent = el(doc, "p", { class: "nobs-account-sent", id: "account-sent", hidden: true });
    const otp = el(doc, "input", { type: "text", id: "account-otp", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "10", pattern: "[0-9]{6,10}" });
    const verify = el(doc, "button", { type: "submit", id: "account-verify", text: tt("account.verify") });
    const other = el(doc, "button", { type: "button", id: "account-other-email", class: "nobs-secondary", text: tt("account.otherEmail") });
    const resend = el(doc, "button", { type: "button", id: "account-resend", class: "nobs-secondary", text: tt("account.resend") });
    const otpForm = el(doc, "form", { class: "nobs-request-form", id: "account-otp-form", novalidate: true, hidden: true },
      el(doc, "label", { class: "nobs-request-field" }, el(doc, "span", { text: tt("account.otp") }), otp),
      el(doc, "div", { class: "nobs-account-actions" }, verify, resend, other));
    const google = el(doc, "button", { type: "button", id: "account-google", class: "nobs-secondary nobs-account-google", text: tt("account.google") });
    google.hidden = !state.client.googleEnabled;
    const error = el(doc, "p", { class: "nobs-request-error", id: "account-signin-error", role: "alert", hidden: true });
    const invite = el(doc, "p", { class: "nobs-account-note", id: "account-pending-invite", text: tt("account.pendingInvite"), hidden: !pendingCode() });
    const showError = (code) => {
      error.textContent = code ? accountErrorText(code, lang, "signin") : "";
      error.hidden = !code;
    };

    const showCodeStep = (address) => {
      state.email = address;
      sent.textContent = tt("account.sent", { email: address });
      sent.hidden = false;
      emailForm.hidden = true;
      otpForm.hidden = false;
    };
    emailForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      showError(null);
      const address = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return showError("bad_email");
      send.disabled = true;
      send.textContent = tt("account.sending");
      const r = await state.client.sendEmailLink(address);
      send.disabled = false;
      send.textContent = tt("account.send");
      if (r.error) return showError(r.error);
      // kept for this tab (about 1 h): a reload while reading the e-mail comes back here
      otpStep.save(address);
      showCodeStep(address);
      otp.focus?.();
    });
    resend.addEventListener("click", async () => {
      showError(null);
      if (!state.email) return;
      resend.disabled = true;
      const r = await state.client.sendEmailLink(state.email);
      resend.disabled = false;
      if (r.error) return showError(r.error);
      otpStep.save(state.email);
      sent.textContent = tt("account.resent", { email: state.email });
    });
    otpForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      showError(null);
      const token = otp.value.replace(/\s+/g, "");
      if (!/^\d{6,10}$/.test(token)) return showError("bad_otp");
      verify.disabled = true;
      const r = await state.client.verifyCode(state.email, token);
      verify.disabled = false;
      if (r.error) return showError(r.error);
      if (r.data?.user) await signedIn(r.data);
    });
    other.addEventListener("click", () => {
      otpStep.clear();
      otpForm.hidden = true;
      sent.hidden = true;
      emailForm.hidden = false;
      otp.value = "";
      showError(null);
    });
    google.addEventListener("click", async () => {
      const r = await state.client.signInGoogle?.();
      if (r?.error) showError(r.error);
    });

    root.replaceChildren(
      el(doc, "section", { class: "nobs-account-card", id: "account-signin" },
        el(doc, "h2", { text: tt("account.signInTitle") }),
        el(doc, "p", { class: "nobs-tagline", text: tt("account.signInHint") }),
        invite, emailForm, sent, otpForm, google, error),
    );
    const step = otpStep.load();
    if (step) {
      email.value = step.email;
      showCodeStep(step.email);
    }
    if (state.signinError) {
      showError(state.signinError);
      state.signinError = null;
    }
  }

  // ---------------------------------------------------------------- signed in
  const ui = {};

  function buildVisibilityPicker() {
    const fieldset = el(doc, "fieldset", { class: "nobs-effort nobs-account-visibility", id: "account-visibility" },
      el(doc, "legend", { text: tt("account.visibility") }));
    for (const v of VISIBILITIES) {
      const input = el(doc, "input", { type: "radio", name: "account-visibility", value: v });
      input.checked = v === "public";
      fieldset.append(el(doc, "label", { class: "nobs-effort-option" }, input,
        el(doc, "span", { class: "nobs-effort-text" },
          el(doc, "strong", { text: tt(`account.vis.${v}`) }),
          el(doc, "small", { text: tt(`account.vis.${v}Hint`) }))));
    }
    fieldset.append(el(doc, "small", { class: "nobs-account-note", text: tt("account.vis.ytCap") }));
    return {
      root: fieldset,
      value: () => fieldset.querySelector("input:checked")?.value ?? "public",
    };
  }

  function renderSignedInShell() {
    state.mode = "signedIn";
    ui.offline = el(doc, "p", { class: "nobs-account-offline", id: "account-offline", role: "status", text: tt("account.offline"), hidden: true });
    ui.message = el(doc, "p", { class: "nobs-account-message", id: "account-message", role: "status", hidden: true });
    const signOut = el(doc, "button", { type: "button", id: "account-signout", class: "nobs-secondary", text: tt("account.signOut") });
    signOut.addEventListener("click", async () => {
      await state.client.signOut();
      signedOut();
    });
    const who = el(doc, "div", { class: "nobs-account-who" },
      el(doc, "span", { id: "account-email-shown", text: tt("account.signedInAs", { email: state.user?.email ?? "" }) }), signOut);

    ui.balance = el(doc, "p", { class: "nobs-account-balance", id: "account-balance", text: "…" });
    ui.expiry = el(doc, "small", { class: "nobs-account-note", id: "account-expiry", hidden: true });

    ui.redeemInput = el(doc, "input", { type: "text", id: "account-redeem-code", placeholder: tt("account.redeemPlaceholder"), autocomplete: "off", spellcheck: "false", maxlength: "40" });
    ui.redeemButton = el(doc, "button", { type: "submit", id: "account-redeem", text: tt("account.redeem") });
    ui.redeemResult = el(doc, "p", { class: "nobs-account-result", id: "account-redeem-result", role: "status", hidden: true });
    const redeemForm = el(doc, "form", { class: "nobs-account-inline", id: "account-redeem-form", novalidate: true }, ui.redeemInput, ui.redeemButton);
    redeemForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = ui.redeemInput.value.trim();
      if (!code) return;
      await redeem(code);
    });

    ui.url = el(doc, "input", { type: "url", id: "account-url", placeholder: "https://www.youtube.com/watch?v=...", autocomplete: "off", required: true });
    ui.effort = buildEffortPicker(doc, { lang, value: loadEffort(storages?.[1]), onChange: (v) => saveEffort(v, storages?.[1]), name: "account-effort" });
    ui.visibility = buildVisibilityPicker();
    ui.price = el(doc, "p", { class: "nobs-account-note", id: "account-price", hidden: true });
    ui.submit = el(doc, "button", { type: "submit", id: "account-submit", text: tt("account.submit") });
    ui.requestError = el(doc, "p", { class: "nobs-request-error", id: "account-request-error", role: "alert", hidden: true });
    const requestForm = el(doc, "form", { class: "nobs-request-form", id: "account-request-form", novalidate: true },
      el(doc, "label", { class: "nobs-request-field" }, el(doc, "span", { text: tt("account.url") }), ui.url),
      ui.effort.root, ui.visibility.root, ui.price, ui.submit);
    requestForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitRequest();
    });

    ui.list = el(doc, "div", { class: "nobs-account-videos", id: "account-videos" });
    ui.empty = el(doc, "p", { class: "nobs-account-note", id: "account-videos-empty", text: tt("account.videosEmpty"), hidden: true });

    root.replaceChildren(
      ui.offline,
      el(doc, "section", { class: "nobs-account-card", id: "account-profile" }, who,
        el(doc, "h2", { text: tt("account.balanceTitle") }), ui.balance, ui.expiry),
      el(doc, "section", { class: "nobs-account-card", id: "account-redeem-box" },
        el(doc, "h2", { text: tt("account.redeemTitle") }), redeemForm, ui.redeemResult),
      el(doc, "section", { class: "nobs-account-card", id: "account-request" },
        el(doc, "h2", { text: tt("account.requestTitle") }), requestForm, ui.requestError, ui.message),
      el(doc, "section", { class: "nobs-account-card", id: "account-my-videos" },
        el(doc, "h2", { text: tt("account.videosTitle") }), ui.empty, ui.list),
    );
  }

  function showMessage(text) {
    if (!ui.message) return;
    ui.message.textContent = text ?? "";
    ui.message.hidden = !text;
  }

  function renderBalance() {
    if (!ui.balance) return;
    if (!state.balance) return;
    ui.balance.textContent = creditsText(state.balance.credits, lang);
    const exp = state.balance.next_expiry ? formatDate(state.balance.next_expiry, lang) : "";
    ui.expiry.textContent = exp ? tt("account.nextExpiry", { date: exp }) : "";
    ui.expiry.hidden = !exp;
  }

  function renderPrice() {
    const s = state.settings;
    if (!ui.price || !s) return;
    ui.price.textContent = s.accepting === false ? tt("account.notAccepting")
      : tt("account.price", { light: s.light_cost, deep: s.deep_cost, upgrade: s.upgrade_cost });
    ui.price.hidden = false;
  }

  // Rebuilt only when the data changed, and not while the visitor is inside
  // the list (an open select or a focused button would be lost); a skipped
  // render happens on the next poll.
  function renderVideos({ force = false } = {}) {
    if (!ui.list) return;
    const json = JSON.stringify(state.videos);
    if (!force && json === state.renderedJson) return;
    if (!force && doc.activeElement && doc.activeElement !== doc.body && ui.list.contains(doc.activeElement)) return;
    state.renderedJson = json;
    ui.list.replaceChildren(...state.videos.map(videoRow));
    ui.empty.hidden = state.videos.length > 0;
  }

  function videoRow(row) {
    const id = row.video_id;
    const item = el(doc, "article", { class: "nobs-account-video", "data-video": id });
    if (VIDEO_RE.test(id ?? "")) {
      item.append(el(doc, "img", { src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, alt: "", loading: "lazy" }));
    }
    const body = el(doc, "div", { class: "nobs-account-video-body" });
    body.append(el(doc, "strong", { class: "nobs-account-video-title", text: row.title || id }));
    body.append(el(doc, "span", { class: "nobs-account-video-status", text: videoStatusText(row.request, lang) }));
    if (row.is_public && row.visibility !== "public") {
      body.append(el(doc, "small", { class: "nobs-account-note", text: tt("account.vis.othersPublic") }));
    }
    const capped = row.visibility === "public" && row.yt_unlisted && !row.is_public;
    if (capped) {
      body.append(el(doc, "small", { class: "nobs-account-note nobs-account-capped", text: tt("account.vis.ytCapped") }));
    }
    const actions = el(doc, "div", { class: "nobs-account-actions" });
    const href = row.player_url || row.request?.player_url;
    if (href && /^https?:\/\//.test(href)) {
      actions.append(el(doc, "a", { class: "nobs-account-open", href, text: tt("account.open") }));
    }
    const select = el(doc, "select", { class: "nobs-account-visibility-select", "aria-label": tt("account.visibility") });
    for (const v of VISIBILITIES) {
      const option = el(doc, "option", { value: v, text: tt(`account.vis.${v}`) });
      option.selected = row.visibility === v;
      select.append(option);
    }
    select.addEventListener("change", () => changeVisibility(row, select));
    actions.append(select);
    if ((row.visibility === "unlisted" || capped) && row.share_token) {
      const copy = el(doc, "button", { type: "button", class: "nobs-secondary nobs-account-copy", text: tt("account.copyLink") });
      copy.addEventListener("click", () => copyLink(shareLink(id, row.share_token, demoBase)));
      const rotate = el(doc, "button", { type: "button", class: "nobs-secondary nobs-account-rotate", text: tt("account.newLink") });
      rotate.addEventListener("click", () => rotateLink(row));
      actions.append(copy, rotate);
    }
    if (row.request?.status === "queued" && row.request.id) {
      const cancel = el(doc, "button", { type: "button", class: "nobs-secondary nobs-account-cancel", text: tt("account.cancel") });
      cancel.addEventListener("click", () => cancelRequest(row.request.id, cancel));
      actions.append(cancel);
    }
    body.append(actions);
    item.append(body);
    return item;
  }

  async function copyLink(url) {
    if (!url) return showMessage(accountErrorText("other", lang));
    try {
      await clipboard.writeText(url);
      showMessage(tt("account.copied"));
      return true;
    } catch {
      showMessage(tt("account.copyFailed", { url }));
      return false;
    }
  }

  async function rotateLink(row) {
    if (!confirmImpl(tt("account.newLinkConfirm"))) return;
    const r = await state.client.rotateToken(row.video_id);
    if (r.error) return showMessage(accountErrorText(r.error, lang));
    row.share_token = r.data;
    const url = shareLink(row.video_id, r.data, demoBase);
    // After the await the click may no longer count as a user action (Safari
    // refuses the write): say what really happened.
    let copied = false;
    try {
      await clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
    await refresh({ force: true });
    showMessage(copied ? tt("account.newLinkDone") : tt("account.newLinkReady", { url }));
  }

  async function changeVisibility(row, select) {
    const previous = row.visibility;
    const next = select.value;
    if (previous === next) return;
    // Leaving «По ссылке» kills the link everyone was given: ask first.
    if (previous === "unlisted" && !confirmImpl(tt("account.unlistedOffConfirm"))) {
      select.value = previous;
      return;
    }
    const r = await state.client.setVisibility(row.video_id, next);
    if (r.error) {
      select.value = previous;
      return showMessage(accountErrorText(r.error, lang));
    }
    await refresh({ force: true });
    // §2a: the old public copy may stay cached for a while
    showMessage(tt(previous === "public" ? "account.visibilityChangedFromPublic" : "account.visibilityChanged"));
  }

  async function cancelRequest(id, button) {
    button.disabled = true;
    const r = await state.client.cancel(id);
    if (r.error) {
      button.disabled = false;
      return showMessage(accountErrorText(r.error, lang));
    }
    await refresh({ force: true });
  }

  async function redeem(code) {
    ui.redeemButton.disabled = true;
    const r = await state.client.redeem(code);
    ui.redeemButton.disabled = false;
    ui.redeemResult.hidden = false;
    if (r.error) {
      ui.redeemResult.textContent = accountErrorText(r.error, lang, "redeem");
      ui.redeemResult.dataset.ok = "0";
      return r;
    }
    ui.redeemResult.textContent = tt("account.redeemed", { credits: creditsText(r.data.credits, lang), balance: creditsText(r.data.balance, lang) });
    ui.redeemResult.dataset.ok = "1";
    ui.redeemInput.value = "";
    state.balance = { ...(state.balance ?? {}), credits: r.data.balance };
    renderBalance();
    await refreshBalance();
    return r;
  }

  async function submitRequest() {
    ui.requestError.hidden = true;
    showMessage(null);
    const { id, reason } = youtubeVideoId(ui.url.value.trim());
    if (!id) {
      ui.requestError.textContent = t(reason === "clip" ? "request.error.clip" : "request.error.bad_url", lang);
      ui.requestError.hidden = false;
      return reason === "clip" ? "clip" : "bad_url";
    }
    ui.submit.disabled = true;
    const r = await state.client.createRequest(id, ui.effort.value(), ui.visibility.value());
    ui.submit.disabled = false;
    if (r.error) {
      ui.requestError.textContent = accountErrorText(r.error, lang);
      ui.requestError.hidden = false;
      return r.error;
    }
    const req = r.data ?? {};
    const asked = ui.visibility.value();
    const kind = req.joined_to ? "joined" : req.status === "done" ? "done" : "queued";
    let text = tt(`account.created.${kind}`, { cost: Number(req.cost) || 0 });
    ui.url.value = "";
    await refresh({ force: true });
    // A video already in «Мои видео» keeps its visibility: say so when the pick differs.
    const entry = state.videos.find((v) => v.video_id === id);
    if (entry && VISIBILITIES.includes(entry.visibility) && entry.visibility !== asked) {
      text += " " + tt("account.created.keptVisibility", { vis: tt(`account.vis.${entry.visibility}`) });
    }
    showMessage(text);
    return kind;
  }

  async function refreshBalance() {
    const r = await state.client.balance();
    if (!r.error) {
      state.balance = r.data;
      renderBalance();
    }
  }

  async function refresh({ force = false } = {}) {
    if (state.mode !== "signedIn") return;
    const [videos, , status] = await Promise.all([state.client.myVideos(), refreshBalance(), state.client.serverStatus()]);
    if (state.mode !== "signedIn") return;
    if (!videos.error) {
      state.videos = videos.data;
      renderVideos({ force });
    }
    if (!status.error) {
      state.offline = serverOffline(status.data?.heartbeat_at, now());
      ui.offline.hidden = !state.offline;
    }
  }

  // Polling: 10 s while a request is queued or processing, else 60 s; paused
  // while the tab is hidden.
  function schedule() {
    clearTimeout(state.timer);
    state.timer = null;
    if (state.stopped || state.mode !== "signedIn" || doc.visibilityState === "hidden") return;
    const ms = state.videos.some(isActive) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    state.timer = setTimeout(async () => {
      state.timer = null;
      await refresh();
      schedule();
    }, ms);
  }
  const onVisibility = async () => {
    if (doc.visibilityState === "hidden") {
      clearTimeout(state.timer);
      state.timer = null;
    } else if (state.mode === "signedIn" && !state.timer) {
      await refresh();
      schedule();
    }
  };
  doc.addEventListener("visibilitychange", onVisibility);

  async function signedIn(session) {
    const user = session?.user ?? null;
    if (!user) return signedOut();
    if (state.mode === "signedIn" && state.user?.id === user.id) return;
    state.user = user;
    otpStep.clear();
    // Came from watch.html's «Войти»: back to that video.
    const next = nextStore.take();
    if (next) {
      if (!pendingCode()) {
        navigate(next);
        return;
      }
    }
    renderSignedInShell();
    const settings = await state.client.publicSettings();
    if (!settings.error) {
      state.settings = settings.data;
      renderPrice();
    }
    // A code from the invite link: redeemed exactly once, after sign-in.
    const code = pendingCode();
    if (code && !state.redeemedPending) {
      state.redeemedPending = true;
      clearPendingCode(storages);
      await redeem(code);
      if (next) {
        navigate(next); // the invite code first, then back to the video
        return;
      }
    }
    await refresh();
    schedule();
  }

  function signedOut() {
    clearTimeout(state.timer);
    state.timer = null;
    state.user = null;
    state.videos = [];
    renderSignedOut();
  }

  function renderOff() {
    state.mode = "off";
    root.replaceChildren(
      el(doc, "section", { class: "nobs-account-card", id: "account-off" },
        el(doc, "p", { class: "nobs-account-off", text: tt("account.off") }),
        el(doc, "p", { class: "nobs-account-note", text: tt("account.offHint") })),
    );
  }

  const ready = (async () => {
    let c = client;
    if (!c) {
      const cfg = config !== undefined ? config : await loadAccountsConfig();
      c = cfg ? createAccountsClient(cfg, { createClient: createClient ?? globalThis.supabase?.createClient, redirectTo: pageUrlWithoutInvite(pageHref) }) : null;
    }
    if (!c) return renderOff();
    state.client = c;
    c.onAuthChange((session, event) => {
      if (state.stopped) return;
      if (event === "SIGNED_OUT" || !session) {
        if (state.mode === "signedIn") signedOut();
      } else if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        signedIn(session);
      }
    });
    const s = await c.session();
    if (s.data?.user) await signedIn(s.data);
    else if (state.mode !== "signedIn") {
      // A PKCE ?code= that gave no session: the link was opened in another
      // browser (no verifier here) or it was already used.
      if (pkceCodeIn(pageHref)) {
        state.signinError = "link_failed";
        try {
          const u = new URL(pageHref);
          u.searchParams.delete("code");
          history?.replaceState?.(history.state ?? null, "", u.toString());
        } catch {
          // the message still shows
        }
      }
      renderSignedOut();
    }
  })();

  return {
    ready,
    state,
    capturedCode,
    refresh,
    stop() {
      state.stopped = true;
      clearTimeout(state.timer);
      doc.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
