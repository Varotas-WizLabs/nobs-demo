// web/src/accountsConfig.js
//
// Where the accounts pages find their Supabase project (spec
// 2026-11-18-accounts §1): the demo build's src/config.js
// (ACCOUNTS_CONFIG, camelCase), else the local server's GET /accounts/config
// ({enabled, url, publishable_key, google_enabled}, snake_case), else none
// (accounts are off: the page says so). Only the project URL and the
// publishable key are ever accepted; anything that does not look like them
// (a secret key above all) is treated as "no config".

import { ACCOUNTS_CONFIG } from "./config.js?v=0126c7d901";

const URL_RE = /^https:\/\/[a-z0-9]{10,40}\.supabase\.co$/;
const KEY_RE = /^sb_publishable_[A-Za-z0-9_-]{8,200}$/;

/** {url, publishableKey, googleEnabled} from either spelling, or null. */
export function normalizeAccountsConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.enabled === false) return null;
  const url = String(raw.url ?? "").replace(/\/+$/, "");
  const publishableKey = String(raw.publishableKey ?? raw.publishable_key ?? "");
  if (!URL_RE.test(url) || !KEY_RE.test(publishableKey)) return null;
  return { url, publishableKey, googleEnabled: Boolean(raw.googleEnabled ?? raw.google_enabled ?? false) };
}

/** The config, or null when accounts are not available here. */
export async function loadAccountsConfig({ config = ACCOUNTS_CONFIG, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const built = normalizeAccountsConfig(config);
  if (built) return built;
  if (!fetchImpl) return null;
  try {
    const r = await fetchImpl("/accounts/config", { cache: "no-store" });
    if (!r.ok) return null;
    return normalizeAccountsConfig(await r.json());
  } catch {
    return null;
  }
}
