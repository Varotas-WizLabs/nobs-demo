// Every claim is on screen for at least this long, even when its span is
// shorter or other claims overlap it.
export const MIN_VISIBLE_SEC = 4;

const schedules = new WeakMap();

// When each claim is on screen: [show, hide) per claim, in (start, end) order.
// Overlaps are resolved deterministically so no claim is ever hidden for good:
// - a claim nested inside another (ends no later) interrupts it once the outer
//   one has been visible MIN_VISIBLE_SEC, then the outer claim resumes;
// - a claim that runs past the one on screen waits until that one ends;
// - a claim is visible at least MIN_VISIBLE_SEC from the moment it is shown.
export function displaySchedule(claims) {
  const cached = schedules.get(claims);
  if (cached) return cached;
  const sorted = [...claims].sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);
  const slots = [];
  for (const claim of sorted) {
    let show = claim.start_sec;
    for (let changed = true, guard = 0; changed && guard <= slots.length; guard += 1) {
      changed = false;
      for (const slot of slots) {
        if (show < slot.show || show >= slot.hide) continue;
        const next = claim.end_sec <= slot.claim.end_sec ? slot.show + MIN_VISIBLE_SEC : slot.hide;
        if (next > show) {
          show = next;
          changed = true;
        }
      }
    }
    slots.push({ claim, show, hide: Math.max(claim.end_sec, show + MIN_VISIBLE_SEC) });
  }
  schedules.set(claims, slots);
  return slots;
}

// The claim on screen at currentTimeSec (see displaySchedule): of the claims
// being shown, the one shown most recently.
export function findActiveClaim(claims, currentTimeSec) {
  let active = null;
  for (const slot of displaySchedule(claims)) {
    if (currentTimeSec >= slot.show && currentTimeSec < slot.hide) {
      if (active === null || slot.show >= active.show) active = slot;
    }
  }
  return active ? active.claim : null;
}

// Relations recorded with `claimId` on the claim_id side only.
export function findRelationsForClaim(relations, claimId) {
  return relations.filter((r) => r.claim_id === claimId);
}

// Every relation the claim takes part in, on either side. A relation links two
// claims, so the chain icon shows while either of them is playing -- not only
// the one the model happened to list as claim_id.
export function findRelationsInvolvingClaim(relations, claimId) {
  return relations.filter((r) => r.claim_id === claimId || r.related_claim_id === claimId);
}

export function formatConfidence(confidence) {
  return `${Math.round(confidence)}%`;
}

// Seconds -> "M:SS" (or "H:MM:SS" for an hour or more).
export function formatTimecode(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
