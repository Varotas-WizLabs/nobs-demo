// web/src/accountMenu.js
//
// The account corner of the top bar on every public page: signed in, the
// user's picture (Google avatar, else the first letter) opens a menu with
// «Настройки аккаунта» (account/) and «Выход»; signed out, a «Войти»
// button (account/). Signed in, a «Question a video» button sits just left
// of the picture (the old «+ Analyse a video» link of the library panel). Nothing is shown when accounts are not configured.
//
// It reads the Supabase session that supabase-js keeps in localStorage
// (key sb-<project ref>-auth-token) instead of loading supabase-js on every
// page; account/, which does load it, refreshes the session. «Выход»
// revokes the session on Supabase (best effort) and forgets it locally.
//
// «Брендбук» (brand/, web/brand/index.html) is in the menu only for the roles in BRAND_ROLES
// (my_role(), asked after the menu is drawn, so a signed-in page then loads
// supabase-js; never shown on an error) and in the owner's local app (where
// «Настройки админа» is shown).

import { loadAccountsConfig } from "./accountsConfig.js?v=3d15d8e254";
import { UI_LANGUAGES, t as tr } from "./i18n.js?v=3d15d8e254";
import { createAccountsClient } from "./accountsClient.js?v=3d15d8e254";
import { openRequestModal } from "./requestModal.js?v=3d15d8e254";
import { PAGES, rootPrefix, siteHref } from "./sitePaths.js?v=3d15d8e254";

/** sb-<ref>-auth-token for a https://<ref>.supabase.co project URL. */
export function storageKeyFor(url) {
  const ref = new URL(url).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

/** {accessToken, name, email, avatar} of the stored session, or null. */
export function readSession(storage, url) {
  let raw;
  try {
    raw = storage?.getItem(storageKeyFor(url));
  } catch {
    return null;
  }
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const session = data?.currentSession ?? data;
  const user = session?.user;
  if (!user || !session.access_token) return null;
  // An expired session without a refresh token cannot come back.
  if (!session.refresh_token && session.expires_at && session.expires_at * 1000 < Date.now()) return null;
  const meta = user.user_metadata || {};
  const avatar = String(meta.avatar_url || meta.picture || "");
  return {
    accessToken: session.access_token,
    name: String(meta.full_name || meta.name || ""),
    email: String(user.email || ""),
    avatar: /^https:\/\//.test(avatar) ? avatar : "",
  };
}

/** Revoke the session on Supabase (best effort) and drop it locally. */
export async function signOut(config, storage, fetchImpl) {
  const session = readSession(storage, config.url);
  if (session && fetchImpl) {
    try {
      await fetchImpl(`${config.url}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.accessToken}` },
      });
    } catch {
      /* offline: forgetting it locally is enough */
    }
  }
  try {
    storage.removeItem(storageKeyFor(config.url));
    storage.removeItem(`${storageKeyFor(config.url)}-code-verifier`);
  } catch {
    /* storage blocked */
  }
}

// Links resolve from the site root (src/sitePaths.js), so the menu works on every page.
export { rootPrefix, siteHref };

/** The brand book (web/brand/index.html), relative to the site root. */
export const BRAND_PAGE = PAGES.brand;

/** Roles that see the «Брендбук» link. */
export const BRAND_ROLES = new Set(["admin", "master_admin"]);

/** True when the local app registered its admin page (never in the demo). */
function localAdmin(doc) {
  return Boolean(doc.documentElement?.dataset.adminHref) && doc.documentElement?.dataset.demo !== "1";
}

/** Add the «Брендбук» item (once) before «Выход» in a rendered signed-in corner. */
export function addBrandLink(doc, root) {
  const menu = root?.querySelector(".nobs-account-dropdown");
  if (!menu || menu.querySelector(".nobs-account-brand")) return;
  const link = el(doc, "a", { role: "menuitem", class: "nobs-account-brand", href: siteHref(doc, BRAND_PAGE) }, tr("menu.brand", pageLang(doc)));
  menu.insertBefore(link, menu.querySelector(".nobs-account-signout"));
}

function el(doc, tag, attrs = {}, text = "") {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

/** The interface language of the page: <html data-ui-lang> / <html lang>, else "ru". */
export function pageLang(doc) {
  const root = doc.documentElement;
  for (const v of [root?.dataset?.uiLang, root?.lang]) if (UI_LANGUAGES.includes(v)) return v;
  return "ru";
}

/** Render the corner into `bar` (the .nobs-topbar). Returns the root node. */
export function renderAccountMenu(doc, bar, { session, accountHref = siteHref(doc, PAGES.account), askHref = null, onAsk = null, onSignOut, showBrand = false }) {
  bar.querySelector(".nobs-account-menu")?.remove();
  const root = el(doc, "div", { class: "nobs-account-menu" });
  const lang = pageLang(doc);
  const t = (key) => tr(key, lang);
  if (!session) {
    const login = el(doc, "a", { class: "nobs-account-login", href: accountHref }, t("menu.signIn"));
    root.append(login);
    bar.append(root);
    return root;
  }
  // «Question a video»: signed-in users only, immediately left of the picture.
  const ask = el(doc, "a", {
    class: "nobs-account-ask",
    href: askHref || accountHref,
    "aria-label": t("menu.ask"),
    title: t("menu.askTitle"),
  });
  ask.append(el(doc, "span", { class: "nobs-account-ask-plus", "aria-hidden": "true" }, "+"), el(doc, "span", { class: "nobs-account-ask-text" }, t("menu.ask")));
  // With JS the link opens the lightbox; the plain link (account/) is the fallback.
  if (onAsk) {
    ask.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onAsk(ask, lang);
    });
  }
  const label = session.name || session.email || t("menu.account");
  const button = el(doc, "button", {
    type: "button",
    class: "nobs-account-avatar",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    "aria-label": label,
    title: label,
  });
  if (session.avatar) {
    const img = el(doc, "img", { src: session.avatar, alt: "", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => {
      img.remove();
      button.textContent = label.trim().charAt(0).toUpperCase() || "?";
    });
    button.append(img);
  } else {
    button.textContent = label.trim().charAt(0).toUpperCase() || "?";
  }
  const menu = el(doc, "div", { class: "nobs-account-dropdown", role: "menu" });
  menu.hidden = true;
  if (session.email) menu.append(el(doc, "div", { class: "nobs-account-dropdown-who" }, session.email));
  const settings = el(doc, "a", { role: "menuitem", href: accountHref }, t("menu.settings"));
  const exit = el(doc, "button", { type: "button", role: "menuitem", class: "nobs-account-signout" }, t("menu.signOut"));
  menu.append(settings);
  // The player's settings dialog (src/settings.js enableMenuSettings).
  if (doc.documentElement?.dataset.settings === "1") {
    const prefs = el(doc, "button", { type: "button", role: "menuitem", class: "nobs-account-prefs" }, t("menu.playerSettings"));
    prefs.addEventListener("click", () => {
      close();
      (doc.defaultView ?? globalThis).dispatchEvent(new Event("nobs:open-settings"));
    });
    menu.append(prefs);
  }
  // The local app's admin entry: present only when the local-only module set the href (never in the demo).
  if (localAdmin(doc)) {
    menu.append(el(doc, "a", { role: "menuitem", href: siteHref(doc, doc.documentElement.dataset.adminHref), class: "nobs-account-admin" }, t("menu.adminSettings")));
  }
  menu.append(exit);

  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
  });
  doc.addEventListener("click", (e) => {
    if (!root.contains(e.target)) close();
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  exit.addEventListener("click", async () => {
    exit.disabled = true;
    await onSignOut?.();
  });
  root.append(ask, button, menu);
  if (showBrand || localAdmin(doc)) addBrandLink(doc, root);
  bar.append(root);
  return root;
}

/** supabase-js is loaded by account/ only; other pages load it on demand. */
export function ensureSupabase(doc, src = siteHref(doc, "vendor/supabase.js")) {
  if (globalThis.supabase?.createClient) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = doc.createElement("script");
    script.src = src;
    script.onload = () => resolve(Boolean(globalThis.supabase?.createClient));
    script.onerror = () => resolve(false);
    doc.head.append(script);
  });
}

/** Find the top bar and show the corner; null when accounts are off. */
export async function mountAccountMenu({
  doc = globalThis.document,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  reload = () => globalThis.location?.reload(),
  loadConfig = loadAccountsConfig,
  loadSupabase = () => ensureSupabase(doc),
  makeClient = createAccountsClient,
  navigate = (url) => globalThis.location?.assign(url),
  fetchRole = null,
} = {}) {
  const bar = doc?.querySelector(".nobs-topbar");
  if (!bar) return null;
  const config = await loadConfig();
  if (!config) return null;
  let client = null;
  // The lightbox needs the accounts client; when it cannot be made, go to the account page.
  const onAsk = async (opener, lang) => {
    if (!client && (await loadSupabase())) client = makeClient(config);
    if (!client) return navigate(siteHref(doc, PAGES.account));
    openRequestModal({ doc, client, lang, opener, storage, accountHref: siteHref(doc, PAGES.account) });
  };
  // The caller's role (my_role()) for the «Брендбук» link: asked once per access token, after the
  // corner is drawn; any failure (no supabase-js, offline, an old database) leaves it hidden.
  const askRole =
    fetchRole ??
    (async () => {
      if (!client && (await loadSupabase())) client = makeClient(config);
      return client ? client.myRole() : null;
    });
  const role = { token: null, value: null };
  const checkRole = (session) => {
    if (!session || role.token === session.accessToken) return;
    role.token = session.accessToken;
    role.value = null;
    const token = session.accessToken;
    Promise.resolve()
      .then(() => askRole())
      .catch(() => null)
      .then((value) => {
        if (role.token !== token) return;
        role.value = typeof value === "string" ? value : null;
        if (BRAND_ROLES.has(role.value)) addBrandLink(doc, bar.querySelector(".nobs-account-menu"));
      });
  };
  const draw = () => {
    const session = readSession(storage, config.url);
    const node = renderAccountMenu(doc, bar, {
      session,
      onAsk,
      showBrand: Boolean(session) && role.token === session.accessToken && BRAND_ROLES.has(role.value),
      onSignOut: async () => {
        await signOut(config, storage, fetchImpl);
        reload();
      },
    });
    checkRole(session);
    return node;
  };
  const root = draw();
  // Signed in or out in another tab (or on account/): follow it.
  globalThis.addEventListener?.("storage", (e) => {
    if (e.key === storageKeyFor(config.url)) draw();
  });
  globalThis.addEventListener?.("nobs:auth-changed", () => draw());
  // The page gained its settings entry (src/settings.js enableMenuSettings).
  globalThis.addEventListener?.("nobs:menu-changed", () => draw());
  return root;
}
