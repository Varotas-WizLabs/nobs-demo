// web/src/popup.js
import { formatConfidence, formatTimecode } from "./claimSync.js?v=7ac63d08a4";
import { isPlayerActive } from "./controlBar.js?v=7ac63d08a4";
import { t } from "./i18n.js?v=7ac63d08a4";
import { seekTarget } from "./settings.js?v=7ac63d08a4";
import { renderTagChipsHtml, renderVerdictReasonsHtml, wireTagInteractions } from "./tags.js?v=7ac63d08a4";

function closeButtonMarkup(lang) {
  return `<button data-action="close">${escapeHtml(t("close", lang))}</button>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Spec flag meanings: green (true), yellow (questionable), red (false),
// white (no fact-check available). Labels are in the run's language.
const FLAGS = ["green", "yellow", "red", "white"];

export function verdictLabel(flag, lang = "en") {
  return t(`verdict.${FLAGS.includes(flag) ? flag : "white"}`, lang);
}

// A white flag is two different outcomes: checked but the sources did not
// support it ("insufficient": "Not supported"), or not checked at all
// (opinion, prediction: "Not checked"). The verdict key tells them apart;
// the flag colour stays white for both.
export function whiteWasChecked(claim) {
  return (claim?.sources ?? []).length > 0 || (claim?.confidence ?? 0) > 0;
}

export function verdictKey(claim) {
  const flag = FLAGS.includes(claim?.flag) ? claim.flag : "white";
  if (flag !== "white") return flag;
  return whiteWasChecked(claim) ? "insufficient" : "white";
}

// A quote's flag says whether the quote is faithful, not whether its words
// are true: "Accurate quote" rather than "True". A yellow quote whose
// attribution is wrong is a sourced but not conclusive misattribution
// ("Likely misattributed").
export function claimVerdictLabel(claim, lang = "en") {
  // A claim about a discussed video: whether it renders that video right.
  if (refVerdict(claim)) return t(`ref.verdict.${refVerdict(claim)}`, lang);
  if (!isQuote(claim)) return t(`verdict.${verdictKey(claim)}`, lang);
  if (claim.flag === "yellow" && claim.quote.attribution === "wrong") return t("quoteVerdict.misattributed", lang);
  return t(`quoteVerdict.${FLAGS.includes(claim.flag) ? claim.flag : "white"}`, lang);
}

// A white flag is "no fact-check", not a scored result, so it never shows a
// confidence. It says instead whether the claim was not checked at all
// (opinion, prediction, ... -- no sources, confidence 0) or was checked but
// the evidence was too weak for a verdict.
function confidenceLine(claim, lang) {
  if (claim.flag !== "white" && FLAGS.includes(claim.flag)) {
    return `<p class="claim-confidence">${escapeHtml(t("confidence", lang))}: ${formatConfidence(claim.confidence)}</p>`;
  }
  const checked = whiteWasChecked(claim);
  const note = t(checked ? "white.insufficient" : "white.unchecked", lang);
  return `<p class="claim-confidence claim-no-check">${escapeHtml(note)}</p>`;
}

// The popup leads with the plain-language one-sentence summary; the full
// argument, confidence and sources open under "More details". A claim
// without a summary (older runs, canned white-flag notes) shows its
// argument directly, as before.
// A source is shown by its site name (the full URL is the link and tooltip).
function sourceLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// A quote: who is quoted (shown before the summary), and under "More
// details" the original verbatim (in its own language, with its page) and
// the attribution/wording/meaning/context assessment in plain labels.
export function isQuote(claim) {
  return claim?.claim_type === "quote" && claim.quote != null;
}

function quoteMark(claim, lang) {
  const author = String(claim.quote.author ?? "").trim();
  return `<p class="claim-quote-mark"><span class="claim-quote-glyph" aria-hidden="true">\u275D</span> ${escapeHtml(t("quote.label", lang))}${author ? `: ${escapeHtml(author)}` : ""}</p>`;
}

// A claim about a discussed video (nobs.refs): `claim.ref` with its kind,
// verdict, the source's verbatim words and the link at that second.
export function isRef(claim) {
  return claim?.ref != null && Boolean(claim.ref.kind);
}

// A reference not found in the discussed video was checked as usual
// (`detail.fallback: "web"`): its flag and label are the usual ones.
export function refVerdict(claim) {
  if (!isRef(claim) || !claim.ref.verdict || claim.ref.detail?.fallback === "web") return "";
  return claim.ref.verdict;
}

function safeHttpUrl(url) {
  return /^https:\/\/(www\.)?youtube\.com\//.test(String(url ?? "")) ? String(url) : "";
}

// The «В обсуждаемом видео» block: the source title, its verbatim words,
// a link opening the source at that second (new tab), the source run's own
// verdict on that place, and the critic / confidence notes.
export function refBlockHtml(claim, lang = "en") {
  if (!isRef(claim)) return "";
  const ref = claim.ref;
  const parts = [`<p class="claim-ref-heading">${escapeHtml(t("ref.heading", lang))}</p>`];
  const kind = `${t(`ref.kind.${ref.kind}`, lang)}${ref.speaker ? ` · ${ref.speaker}` : ""}`;
  parts.push(`<p class="claim-ref-kind">${escapeHtml(kind)}</p>`);
  const title = String(ref.source_title ?? "").trim();
  if (title) parts.push(`<p class="claim-ref-title">${escapeHtml(title)}</p>`);
  if (ref.detail?.fallback === "web") parts.push(`<p class="claim-ref-probable">${escapeHtml(t("ref.checkedElsewhere", lang))}</p>`);
  const words = String(ref.source_words ?? "").trim();
  if (words) parts.push(`<blockquote class="claim-ref-words">${escapeHtml(words)}</blockquote>`);
  const url = safeHttpUrl(ref.source_url);
  if (url) {
    const at = ref.source_start_sec != null ? ` ${formatTimecode(ref.source_start_sec)}` : "";
    const label = ref.source_start_sec != null ? `${t("ref.open", lang)}${at}` : title || url;
    parts.push(
      `<p class="claim-ref-link"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`
    );
  }
  const source = ref.source_claim;
  if (source && FLAGS.includes(source.flag)) {
    const runLink = source.run_id != null
      ? ` <a class="claim-ref-run" href="player.html?run_id=${encodeURIComponent(source.run_id)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("ref.sourceRun", lang))}</a>`
      : "";
    parts.push(
      `<p class="claim-ref-source-verdict">${escapeHtml(t("ref.sourceVerdict", lang))}: <span class="claim-ref-chip" data-flag="${escapeHtml(source.flag)}">${escapeHtml(t(`verdict.${source.flag}`, lang))}</span>${runLink}</p>`
    );
  }
  const critic = ref.detail?.critic_right;
  if (ref.kind === "critique" && ["yes", "no", "partly"].includes(critic)) {
    parts.push(`<p class="claim-ref-critic">${escapeHtml(t(`ref.critic.${critic}`, lang))}</p>`);
  }
  if (ref.detail?.source_confidence === "probable") {
    parts.push(`<p class="claim-ref-probable">${escapeHtml(t("ref.probable", lang))}</p>`);
  }
  return `<section class="claim-ref" data-ref-kind="${escapeHtml(ref.kind)}">${parts.join("")}</section>`;
}

function labelled(label, value, lang) {
  return `<li><span class="claim-quote-label">${escapeHtml(t(label, lang))}:</span> ${escapeHtml(value)}</li>`;
}

function quoteDetails(claim, lang) {
  const q = claim.quote;
  const original = String(q.original_quote ?? "").trim();
  const source = String(q.original_source ?? "").trim();
  let html = "";
  if (original) {
    const langAttr = q.original_language ? ` lang="${escapeHtml(q.original_language)}"` : "";
    const citeAttr = source ? ` cite="${escapeHtml(source)}"` : "";
    html += `<figure class="claim-original-figure">
        <blockquote class="claim-original"${langAttr}${citeAttr}>${escapeHtml(original)}</blockquote>`;
    if (source) {
      // Not found verbatim in what the searches returned: the page's
      // rendering, not a confirmed verbatim original.
      const label = q.original_verbatim === false ? "quote.asQuotedBy" : "quote.originalSource";
      html += `<figcaption class="claim-original-source">${escapeHtml(t(label, lang))}: <a href="${escapeHtml(source)}" title="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel(source))}</a></figcaption>`;
    }
    html += `</figure>`;
  }
  if (q.attribution) {
    const items = [labelled("quote.attribution", t(`quote.attribution.${q.attribution}`, lang), lang)];
    const actual = String(q.actual_author ?? "").trim();
    if (actual) items.push(labelled("quote.actualAuthor", actual, lang));
    if (q.wording) items.push(labelled("quote.wording", t(`quote.wording.${q.wording}`, lang), lang));
    if (q.wording && q.wording !== "not_found") {
      for (const [key, value] of [["quote.meaning", q.meaning_preserved], ["quote.context", q.context_preserved]]) {
        if (value === true || value === false) {
          items.push(labelled(key, t(value ? "quote.preserved" : "quote.changed", lang), lang));
        }
      }
    }
    html += `<ul class="claim-quote-assessment">${items.join("")}</ul>`;
  }
  const context = String(q.context ?? "").trim();
  if (context) html += `<p class="claim-quote-context">${escapeHtml(context)}</p>`;
  return html;
}

export function renderClaimPopup(claim, lang = "en") {
  const sourcesHtml = (claim.sources ?? [])
    .map(
      (source) =>
        `<li><a href="${escapeHtml(source)}" title="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel(source))}</a></li>`
    )
    .join("");
  const sourcesList = sourcesHtml ? `<ul class="claim-sources">${sourcesHtml}</ul>` : "";
  const summary = String(claim.summary ?? "").trim();
  const quote = isQuote(claim);
  const quoteHtml = quote ? quoteDetails(claim, lang) : "";

  // Presentation tags: layer A ("reason") inside the verdict details,
  // layer B chips ("how it's phrased") under the summary.
  // One disclaimer per popup: under the chips when there are any.
  const chipsHtml = renderTagChipsHtml(claim, lang);
  const reasonsHtml = renderVerdictReasonsHtml(claim, lang, { disclaimer: !chipsHtml });
  const refHtml = refBlockHtml(claim, lang);
  const body = summary
    ? `
      <p class="claim-summary">${escapeHtml(summary)}</p>
      ${refHtml}
      ${chipsHtml}
      <details class="claim-details">
        <summary>${escapeHtml(t("moreDetails", lang))}</summary>
        ${reasonsHtml}
        ${quoteHtml}
        ${confidenceLine(claim, lang)}
        <p class="claim-argument">${escapeHtml(claim.argument)}</p>
        ${sourcesList}
      </details>`
    : `
      ${refHtml}
      ${chipsHtml}
      ${reasonsHtml}
      ${quoteHtml}
      ${confidenceLine(claim, lang)}
      <p class="claim-argument">${escapeHtml(claim.argument)}</p>
      ${sourcesList}`;

  return `
    <div class="popup claim-popup" lang="${escapeHtml(lang)}" data-flag="${escapeHtml(claim.flag)}"${quote ? ' data-quote="true"' : ""}>
      <p class="claim-verdict">${escapeHtml(claimVerdictLabel(claim, lang))}</p>
      ${quote ? quoteMark(claim, lang) : ""}
      <p class="claim-text">${escapeHtml(claim.text)}</p>
      ${body}
      ${closeButtonMarkup(lang)}
    </div>
  `;
}

// Describe a relation from the active claim's side. A relation reads
// "<claim_id> <relation_type> <related_claim_id>".
function describeRelation(relation, activeClaimId, lang) {
  const activeIsSubject = activeClaimId == null || relation.claim_id === activeClaimId;
  const otherId = activeIsSubject ? relation.related_claim_id : relation.claim_id;
  let heading;
  if (relation.relation_type === "corrects") {
    heading = t(activeIsSubject ? "relation.corrects" : "relation.correctedBy", lang);
  } else if (relation.relation_type === "contradicts") {
    heading = t("relation.contradicts", lang);
  } else {
    heading = relation.relation_type;
  }
  return { heading, otherId };
}

// `context` is optional: {activeClaimId, claims, lang}. When given, each
// relation is phrased from the active claim's side and shows the other claim's
// text and timecode -- skipped silently when the other claim isn't in `claims`.
export function renderRelationPopup(relations, context = {}) {
  const { activeClaimId = null, claims = [], lang = "en" } = context;
  const itemsHtml = relations
    .map((relation) => {
      const { heading, otherId } = describeRelation(relation, activeClaimId, lang);
      const other = claims.find((c) => c.id === otherId);
      const otherHtml = other
        ? `<span class="relation-other"><span class="relation-other-time">${formatTimecode(other.start_sec)}</span> ${escapeHtml(other.text)}</span>`
        : "";
      return `
      <li class="relation-item" data-relation-type="${escapeHtml(relation.relation_type)}">
        <span class="relation-type">${escapeHtml(heading)}</span>
        ${otherHtml}
        <span class="relation-explanation">${escapeHtml(relation.explanation)}</span>
      </li>`;
    })
    .join("");

  return `
    <div class="popup relation-popup">
      <ul class="relation-list">${itemsHtml}</ul>
      ${closeButtonMarkup(lang)}
    </div>
  `;
}

// Clicking either icon pauses the player and opens a popup; closing it
// resumes playback only if the video was playing when the first popup opened
// (a video the user had already paused stays paused). Opening a second popup
// over the first keeps that original state.
export function wireFlagIconClick(flagIcon, chainIcon, player, popupContainer, getOverlayState) {
  let popupOpen = false;
  let openKind = null;
  let resumeOnClose = false;

  function closePopup() {
    if (!popupOpen) return;
    popupContainer.innerHTML = "";
    popupOpen = false;
    openKind = null;
    if (resumeOnClose) {
      player.playVideo();
    }
  }

  function openPopup(kind, html) {
    if (!popupOpen) {
      resumeOnClose = isPlayerActive(player);
      popupOpen = true;
    }
    openKind = kind;
    player.pauseVideo();
    popupContainer.innerHTML = html;
    const closeButton = popupContainer.querySelector("[data-action='close']");
    closeButton.addEventListener("click", closePopup);
  }

  // A tag's timecode seeks the video there (the popup stays open).
  wireTagInteractions(popupContainer, {
    onSeek: (seconds) => {
      player.seekTo?.(seekTarget(seconds), true);
    },
  });

  // Escape closes the open popup, like any dialog.
  const doc = popupContainer.ownerDocument;
  if (doc) {
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePopup();
    });
  }

  flagIcon.addEventListener("click", () => {
    // Clicking the icon of the popup that is already open toggles it closed.
    if (popupOpen && openKind === "claim") {
      closePopup();
      return;
    }
    const { activeClaim, language } = getOverlayState();
    if (!activeClaim) return;
    openPopup("claim", renderClaimPopup(activeClaim, language));
  });

  chainIcon.addEventListener("click", () => {
    if (popupOpen && openKind === "relation") {
      closePopup();
      return;
    }
    const { activeClaim, activeRelations, claims, language } = getOverlayState();
    openPopup(
      "relation",
      renderRelationPopup(activeRelations ?? [], {
        activeClaimId: activeClaim?.id ?? null,
        claims: claims ?? [],
        lang: language,
      })
    );
  });
}
