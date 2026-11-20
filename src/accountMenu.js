// web/src/accountMenu.js
//
// The account corner of the top bar on every public page: signed in, the
// user's picture (Google avatar, else the first letter) opens a menu with
// «Настройки аккаунта» (account.html) and «Выход»; signed out, a «Войти»
// button (account.html). Nothing is shown when accounts are not configured.
//
// It reads the Supabase session that supabase-js keeps in localStorage
// (key sb-<project ref>-auth-token) instead of loading supabase-js on every
// page; account.html, which does load it, refreshes the session. «Выход»
// revokes the session on Supabase (best effort) and forgets it locally.

import { loadAccountsConfig } from "./accountsConfig.js?v=a1c8a76876";
import { t } from "./i18n.js?v=a1c8a76876";

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

function el(doc, tag, attrs = {}, text = "") {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

/** Render the corner into `bar` (the .nobs-topbar). Returns the root node. */
export function renderAccountMenu(doc, bar, { session, accountHref = "account.html", onSignOut }) {
  bar.querySelector(".nobs-account-menu")?.remove();
  const root = el(doc, "div", { class: "nobs-account-menu" });
  if (!session) {
    const login = el(doc, "a", { class: "nobs-account-login", href: accountHref }, t("menu.signIn", "ru"));
    root.append(login);
    bar.append(root);
    return root;
  }
  const label = session.name || session.email || t("menu.account", "ru");
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
  const settings = el(doc, "a", { role: "menuitem", href: accountHref }, t("menu.settings", "ru"));
  const exit = el(doc, "button", { type: "button", role: "menuitem" }, t("menu.signOut", "ru"));
  menu.append(settings);
  // The player's settings dialog (src/settings.js enableMenuSettings).
  if (doc.documentElement?.dataset.settings === "1") {
    const prefs = el(doc, "button", { type: "button", role: "menuitem", class: "nobs-account-prefs" }, t("menu.playerSettings", "ru"));
    prefs.addEventListener("click", () => {
      close();
      (doc.defaultView ?? globalThis).dispatchEvent(new Event("nobs:open-settings"));
    });
    menu.append(prefs);
  }
  // The local app's admin entry: present only when the local-only module set the href (never in the demo).
  const adminHref = doc.documentElement?.dataset.adminHref;
  if (adminHref && doc.documentElement?.dataset.demo !== "1") {
    menu.append(el(doc, "a", { role: "menuitem", href: adminHref, class: "nobs-account-admin" }, t("menu.adminSettings", "ru")));
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
  root.append(button, menu);
  bar.append(root);
  return root;
}

/** Find the top bar and show the corner; null when accounts are off. */
export async function mountAccountMenu({
  doc = globalThis.document,
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  reload = () => globalThis.location?.reload(),
  loadConfig = loadAccountsConfig,
} = {}) {
  const bar = doc?.querySelector(".nobs-topbar");
  if (!bar) return null;
  const config = await loadConfig();
  if (!config) return null;
  const draw = () =>
    renderAccountMenu(doc, bar, {
      session: readSession(storage, config.url),
      onSignOut: async () => {
        await signOut(config, storage, fetchImpl);
        reload();
      },
    });
  const root = draw();
  // Signed in or out in another tab (or on account.html): follow it.
  globalThis.addEventListener?.("storage", (e) => {
    if (e.key === storageKeyFor(config.url)) draw();
  });
  globalThis.addEventListener?.("nobs:auth-changed", () => draw());
  // The page gained its settings entry (src/settings.js enableMenuSettings).
  globalThis.addEventListener?.("nobs:menu-changed", () => draw());
  return root;
}
