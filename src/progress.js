// web/src/progress.js
//
// Progressive delivery (spec 2026-11-17 §4.5): the helpers the player uses
// while a streaming run is still being analysed -- a claim's check state,
// merging a GET /runs/{id}/delta into the run the page holds, and the
// processing line «Проанализировано 7:40 / 41:20 · 23 утверждения · 5
// проверяются». Pure functions; no DOM.

import { formatTimecode } from "./claimSync.js?v=206d8c0082";
import { t } from "./i18n.js?v=206d8c0082";

const STATES = new Set(["pending", "checking", "done", "failed", "superseded"]);

/** A claim's check state; a claim without one (a batch run's) is done. */
export function claimState(claim) {
  const state = claim?.verify_state;
  return STATES.has(state) ? state : "done";
}

/** Found but not checked yet (grey «проверяется»): pending or checking. */
export function isUnchecked(claim) {
  const state = claimState(claim);
  return state === "pending" || state === "checking";
}

/** A claim with its verdict (the only ones the narrator reads). */
export function isVerified(claim) {
  return claimState(claim) === "done";
}

function byPlayback(a, b) {
  return a.start_sec - b.start_sec || a.end_sec - b.end_sec || (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Merge a delta into `run`. Returns {run, added, changed, revised, removed}:
 * `run` is a new object with a new `claims` array (claimSync caches its
 * schedule per array, so it must be a fresh one), claims merged by id and in
 * playback order; a superseded claim leaves the list (its marker goes).
 * `changed` holds the claims whose state or flag changed, `revised` those
 * with a new revision (revised_from_flag), `removed` the ids dropped.
 */
export function mergeDelta(run, delta) {
  const byId = new Map((run?.claims ?? []).map((c) => [c.id, c]));
  const added = [];
  const changed = [];
  const revised = [];
  const removed = [];
  for (const claim of delta?.claims ?? []) {
    const before = byId.get(claim.id);
    if (claimState(claim) === "superseded") {
      if (before) {
        byId.delete(claim.id);
        removed.push(claim.id);
      }
      continue;
    }
    byId.set(claim.id, claim);
    if (!before) {
      added.push(claim);
      continue;
    }
    if (claimState(before) !== claimState(claim) || (before.flag ?? null) !== (claim.flag ?? null)) changed.push(claim);
    if (claim.revised_from_flag && claim.revised_from_flag !== before.revised_from_flag) revised.push(claim);
  }
  const relations = new Map((run?.relations ?? []).map((r) => [r.id ?? `${r.claim_id}:${r.related_claim_id}`, r]));
  for (const relation of delta?.relations ?? []) {
    relations.set(relation.id ?? `${relation.claim_id}:${relation.related_claim_id}`, relation);
  }
  const next = {
    ...run,
    claims: [...byId.values()].sort(byPlayback),
    relations: [...relations.values()],
  };
  if (delta && typeof delta.rev === "number") next.rev = delta.rev;
  // Not `status`: the run stays live until the full run replaces it (a
  // delta served just after the final commit says "complete", and taking
  // that here would skip the in-place finish).
  for (const key of ["phase", "processed_until_sec", "verified_until_sec", "ready_ranges", "failed_ranges"]) {
    if (delta && delta[key] !== undefined) next[key] = delta[key];
  }
  return { run: next, added, changed, revised, removed };
}

function plural(lang, n, base) {
  const ru = String(lang ?? "").toLowerCase().startsWith("ru");
  if (!ru) return t(`${base}.${n === 1 ? "one" : "many"}`, lang);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return t(`${base}.one`, lang);
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t(`${base}.few`, lang);
  return t(`${base}.many`, lang);
}

/**
 * The processing line of a streaming run from its GET /status body:
 * «Проанализировано 7:40 / 41:20 · 23 утверждения · 5 проверяются».
 * Null when the run is not a streaming one or nothing is known yet.
 */
export function progressLine(status, lang = "en") {
  if (!status?.streaming) return null;
  const parts = [];
  const until = Number(status.processed_until_sec);
  const total = Number(status.duration_sec);
  if (Number.isFinite(until) && Number.isFinite(total) && total > 0) {
    parts.push(`${t("progress.analysed", lang)} ${formatTimecode(Math.min(until, total))} / ${formatTimecode(total)}`);
  }
  const claims = Number(status.claims_so_far) || 0;
  parts.push(`${claims} ${plural(lang, claims, "progress.claims")}`);
  const pending = Number(status.pending_count) || 0;
  if (pending > 0) {
    // «1 проверяется», «5 проверяются» (Russian verb agreement).
    const one = pending % 10 === 1 && pending % 100 !== 11;
    parts.push(`${pending} ${t(`progress.checking.${one ? "one" : "many"}`, lang)}`);
  }
  return parts.join(" · ");
}

/**
 * What the player does with a run handed to showRun (player.html):
 * "finish" -- a run shown live completed: update in place, then what only a
 * finished run has; "settle" -- a run shown live failed: update the list in
 * place (its unfinished checks now failed) and drop the frontier, no export
 * or scoops; "build" -- (re)build the view; "ignore" -- nothing to show.
 * `liveRunId` is the run shown live (null when none), `hasList` whether the
 * claim list exists.
 */
export function showRunAction(run, { liveRunId = null, hasList = false } = {}) {
  const shownLive = hasList && liveRunId !== null && liveRunId === run?.run_id;
  if (run?.status === "complete") return shownLive ? "finish" : "build";
  if (run?.status === "failed") return shownLive ? "settle" : "ignore";
  if (run?.status === "pending" || run?.status === "running") return "build";
  return "ignore";
}
