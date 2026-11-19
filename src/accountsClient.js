// web/src/accountsClient.js
//
// The browser side of accounts (spec 2026-11-18-accounts §1, §2a): a thin
// wrapper over supabase-js (web/vendor/supabase.js, a classic script that
// defines globalThis.supabase) with the publishable key only. Sign-in by an
// e-mail link or the 6-10 digit code from the same e-mail (PKCE), Google only
// when the project enables it. Everything else goes through the database's
// own functions (RLS + security definer): balance, redeem, requests, «Мои
// видео», visibility, share links, access to a non-public analysis.
//
// Every method resolves to {data} or {error: <stable code>}: the database's
// codes (P0001 messages), plus network, bad_otp, bad_email, other. Nothing
// here ever throws.

export const DB_ERRORS = [
  "not_signed_in", "blocked", "rate_limited", "bad_code", "code_revoked", "code_expired", "code_already_redeemed",
  "code_used_up", "bad_video", "bad_mode", "bad_visibility", "not_accepting", "insufficient_credits", "queue_full",
  "not_found", "not_cancellable",
];
const KNOWN = new Set(DB_ERRORS);

/** A stable code for a supabase-js error object. */
export function errorCode(error) {
  if (!error) return null;
  const message = String(error.message ?? "");
  const code = String(error.code ?? "");
  if (KNOWN.has(message)) return message;
  if (KNOWN.has(code)) return code;
  if (error.name === "AuthRetryableFetchError" || error.status === 0 ||
      /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message)) return "network";
  if (code === "otp_expired" || code === "otp_disabled" || /token has expired|invalid.*(otp|token)/i.test(message)) return "bad_otp";
  if (code === "email_address_invalid" || code === "validation_failed" || /email.*invalid|invalid.*email/i.test(message)) return "bad_email";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) return "rate_limited";
  if (code === "PGRST301" || code === "PGRST303" || error.status === 401 || /jwt/i.test(message)) return "not_signed_in";
  return "other";
}

async function call(fn, pick = (data) => data) {
  try {
    const { data, error } = await fn();
    if (error) return { error: errorCode(error) };
    return { data: pick(data) };
  } catch (e) {
    return { error: errorCode(e) === "other" ? "network" : errorCode(e) };
  }
}

/**
 * The client for `config` ({url, publishableKey, googleEnabled}), or null
 * when supabase-js is not loaded.
 */
export function createAccountsClient(config, { createClient = globalThis.supabase?.createClient, redirectTo = null } = {}) {
  if (!config || typeof createClient !== "function") return null;
  const sb = createClient(config.url, config.publishableKey, {
    auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
  });
  // Tell the top bar's account corner (src/accountMenu.js) that the stored
  // session changed in this tab (the storage event fires only in other tabs).
  try {
    sb.auth.onAuthStateChange(() => {
      setTimeout(() => globalThis.dispatchEvent?.(new Event("nobs:auth-changed")), 0);
    });
  } catch {
    /* a client without auth events */
  }
  const rpc = (name, args) => call(() => sb.rpc(name, args));

  const client = {
    raw: sb,
    googleEnabled: Boolean(config.googleEnabled),
    async session() {
      const r = await call(() => sb.auth.getSession(), (data) => data?.session ?? null);
      return r.error ? { data: null, error: r.error } : r;
    },
    onAuthChange(cb) {
      try {
        const { data } = sb.auth.onAuthStateChange((event, session) => cb(session ?? null, event));
        return () => data?.subscription?.unsubscribe?.();
      } catch {
        return () => {};
      }
    },
    sendEmailLink(email) {
      return call(
        () => sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo ?? undefined, shouldCreateUser: true } }),
        () => true,
      );
    },
    verifyCode(email, token) {
      return call(() => sb.auth.verifyOtp({ email, token, type: "email" }), (data) => data?.session ?? null);
    },
    signOut() {
      return call(() => sb.auth.signOut(), () => true);
    },
    balance() {
      return call(
        () => sb.from("user_balance").select("credits,next_expiry").maybeSingle(),
        (row) => ({ credits: Number(row?.credits ?? 0) || 0, next_expiry: row?.next_expiry ?? null }),
      );
    },
    async redeem(code) {
      const r = await rpc("redeem_code", { p_code: code });
      if (r.error) return r;
      if (!r.data?.ok) return { error: KNOWN.has(r.data?.error) ? r.data.error : "other" };
      return { data: { credits: Number(r.data.credits) || 0, balance: Number(r.data.balance) || 0 } };
    },
    createRequest(videoId, mode, visibility = "public") {
      return rpc("create_request", { p_video: videoId, p_mode: mode, p_visibility: visibility });
    },
    async myVideos() {
      const r = await rpc("my_videos");
      return r.error ? r : { data: Array.isArray(r.data) ? r.data : [] };
    },
    cancel(id) {
      return rpc("cancel_request", { p_id: id });
    },
    setVisibility(videoId, visibility) {
      return rpc("set_video_visibility", { p_video: videoId, p_visibility: visibility });
    },
    rotateToken(videoId) {
      return rpc("rotate_share_token", { p_video: videoId });
    },
    runAccess(videoId, token = null) {
      return rpc("get_run_access", { p_video: videoId, p_token: token || null });
    },
    serverStatus() {
      return call(
        () => sb.from("server_status").select("heartbeat_at,version").eq("id", 1).maybeSingle(),
        (row) => ({ heartbeat_at: row?.heartbeat_at ?? null }),
      );
    },
    publicSettings() {
      return rpc("public_settings");
    },
  };
  if (client.googleEnabled) {
    client.signInGoogle = () =>
      call(() => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo ?? undefined } }), () => true);
  }
  return client;
}
