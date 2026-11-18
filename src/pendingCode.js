// web/src/pendingCode.js
//
// An invite code that arrives in the account page's link waits here until
// the visitor has signed in, then it is redeemed once (src/accountPage.js).
// Accepted in the link: #code=NOBS-… (the fragment, never sent to a server),
// ?invite=NOBS-… and ?code=NOBS-… -- but ?code= only when the value starts
// with NOBS-: the e-mail sign-in link (PKCE) comes back as ?code=<uuid>, which
// belongs to supabase-js. Only the invite parameter is removed from the
// address bar.
// Kept in sessionStorage and in localStorage with a 24 h lifetime: the e-mail
// link opens a new tab, whose sessionStorage is empty.

export const PENDING_KEY = "nobs.pendingCode";
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9-]{4,40}$/;
const INVITE_RE = /^NOBS-/i;

function defaultStorages() {
  const pick = (name) => {
    try {
      return globalThis[name] ?? null;
    } catch {
      return null;
    }
  };
  return [pick("sessionStorage"), pick("localStorage")];
}

function clean(value) {
  const code = String(value ?? "").trim();
  return CODE_RE.test(code) ? code : null;
}

/** The current page's address without the invite parameter (and without a
 * fragment): where the e-mail sign-in link should bring the visitor back. */
export function pageUrlWithoutInvite(loc) {
  const u = new URL(String(loc?.href ?? loc));
  u.searchParams.delete("invite");
  const code = u.searchParams.get("code");
  if (code && INVITE_RE.test(code)) u.searchParams.delete("code");
  u.hash = "";
  return u.toString();
}

/**
 * Take an invite code from the link, remember it and remove it from the
 * address bar. Returns the code or null. A PKCE ?code=<uuid> is left alone.
 */
export function captureInviteCode(loc = globalThis.location, hist = globalThis.history, storages = defaultStorages(), now = Date.now()) {
  if (!loc?.href) return null;
  const u = new URL(String(loc.href));
  const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
  let code = null;
  if (clean(hash.get("code"))) {
    code = clean(hash.get("code"));
    hash.delete("code");
    const rest = hash.toString();
    u.hash = rest ? `#${rest}` : "";
  } else if (clean(u.searchParams.get("invite"))) {
    code = clean(u.searchParams.get("invite"));
    u.searchParams.delete("invite");
  } else {
    const q = clean(u.searchParams.get("code"));
    if (q && INVITE_RE.test(q)) {
      code = q;
      u.searchParams.delete("code");
    }
  }
  if (!code) return null;
  const value = JSON.stringify({ code, at: now });
  for (const s of storages) {
    try {
      s?.setItem(PENDING_KEY, value);
    } catch {
      // blocked storage: the other one (or this page view) still has it
    }
  }
  try {
    const bare = u.toString().replace(/#$/, "");
    hist?.replaceState?.(hist.state ?? null, "", bare);
  } catch {
    // ignore
  }
  return code;
}

/** The pending code (from either storage, at most 24 h old), or null. */
export function takePendingCode(storages = defaultStorages(), now = Date.now()) {
  for (const s of storages) {
    let raw = null;
    try {
      raw = s?.getItem(PENDING_KEY);
    } catch {
      continue;
    }
    if (!raw) continue;
    let item = null;
    try {
      item = JSON.parse(raw);
    } catch {
      item = null;
    }
    const code = clean(item?.code);
    const at = Number(item?.at);
    if (code && Number.isFinite(at) && now - at >= 0 && now - at < PENDING_TTL_MS) return code;
    try {
      s.removeItem(PENDING_KEY);
    } catch {
      // ignore
    }
  }
  return null;
}

export function clearPendingCode(storages = defaultStorages()) {
  for (const s of storages) {
    try {
      s?.removeItem(PENDING_KEY);
    } catch {
      // ignore
    }
  }
}
