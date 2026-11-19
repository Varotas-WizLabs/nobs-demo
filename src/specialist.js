// web/src/specialist.js
//
// The science specialist's SECOND OPINION on a claim (backend:
// nobs.sources.specialist, shadow mode). It never changes the flag: the
// claim popup shows it under the verdict as «Второе мнение специалиста»,
// and the sources page lists every opinion, disagreements first.

import { labelLanguage } from "./i18n.js?v=4f390fa6da";

const FLAG_TEXT = {
  ru: { green: "верно", yellow: "неточно", red: "неверно", white: "не проверить" },
  en: { green: "true", yellow: "inaccurate", red: "false", white: "can't check" },
};

export const EVIDENCE_LABELS = {
  systematic_review: "систематический обзор / метаанализ",
  guideline: "клиническая рекомендация",
  rct: "РКИ",
  cohort_observational: "когортное / наблюдательное",
  official_data: "официальные данные",
  primary_document: "первоисточник",
  case_report: "описание случая",
  animal_in_vitro: "на животных / in vitro",
  reference: "справочник",
  expert_opinion: "мнение эксперта",
  news_retelling: "пересказ в СМИ",
  preprint: "препринт",
  other: "прочее",
  unknown: "не указан",
};

const TEXT = {
  ru: {
    title: "Второе мнение специалиста",
    agrees: "согласен с вердиктом",
    disagrees: "не согласен",
    note: "Это второе мнение (теневой режим): флаг оно не меняет.",
    evidence: "Уровень доказательств",
    effect: "Размер эффекта",
    contradicting: "Что противоречит",
    reused: "по пилоту, без окна расшифровки",
    sources: "Источники специалиста",
  },
  en: {
    title: "Specialist's second opinion",
    agrees: "agrees with the verdict",
    disagrees: "disagrees",
    note: "A second opinion (shadow mode): it does not change the flag.",
    evidence: "Evidence level",
    effect: "Effect size",
    contradicting: "Contradicting evidence",
    reused: "from the pilot, without the transcript window",
    sources: "Specialist's sources",
  },
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

export function flagText(flag, lang = "ru") {
  lang = labelLanguage(lang);
  return (FLAG_TEXT[lang] ?? FLAG_TEXT.ru)[flag] ?? flag ?? "";
}

/** One-line headline: «Второе мнение специалиста: неточно — не согласен». */
export function specialistHeadline(op, lang = "ru") {
  lang = labelLanguage(lang);
  const t = TEXT[lang] ?? TEXT.ru;
  return `${t.title}: ${flagText(op.verdict, lang)} — ${op.agrees ? t.agrees : t.disagrees}`;
}

/** The popup block for a claim with `claim.specialist` ('' without one). */
export function specialistBlockHtml(claim, lang = "ru") {
  lang = labelLanguage(lang);
  const op = claim?.specialist;
  if (!op || !op.verdict) return "";
  const t = TEXT[lang] ?? TEXT.ru;
  const level = EVIDENCE_LABELS[op.evidence_level] ?? op.evidence_level ?? "";
  const sources = (op.sources ?? [])
    .filter((s) => safeUrl(s.url))
    .slice(0, 6)
    .map((s) => {
      const label = s.title || s.url;
      const doi = s.doi_check?.exists ? " · DOI ✓" : "";
      return `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>${esc(
        s.study_type ? ` (${EVIDENCE_LABELS[s.study_type] ?? s.study_type}${doi})` : doi,
      )}</li>`;
    })
    .join("");
  return `
    <details class="claim-specialist" data-agrees="${op.agrees ? "true" : "false"}" data-verdict="${esc(op.verdict)}">
      <summary>${esc(specialistHeadline(op, lang))}</summary>
      <p class="claim-specialist-note">${esc(t.note)}${op.reused_from ? ` (${esc(t.reused)})` : ""}</p>
      ${op.disagreement ? `<p class="claim-specialist-disagreement">${esc(op.disagreement)}</p>` : ""}
      <p class="claim-specialist-argument">${esc(op.argument)}</p>
      ${level ? `<p class="claim-specialist-meta">${esc(t.evidence)}: ${esc(level)}</p>` : ""}
      ${op.effect ? `<p class="claim-specialist-meta">${esc(t.effect)}: ${esc(op.effect)}</p>` : ""}
      ${op.contradicting ? `<p class="claim-specialist-meta">${esc(t.contradicting)}: ${esc(op.contradicting)}</p>` : ""}
      ${sources ? `<ul class="claim-specialist-sources" aria-label="${esc(t.sources)}">${sources}</ul>` : ""}
    </details>`;
}

function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

/** The sources page section: every opinion, disagreements first. */
export function renderSpecialistSection(doc, data) {
  const sec = el(doc, "section", { class: "nobs-src-specialist" });
  const opinions = data?.opinions ?? [];
  sec.append(
    el(doc, "h2", { text: "Второе мнение специалиста (теневой режим)" }),
    el(doc, "p", {
      class: "nobs-src-muted",
      text:
        `Мнений: ${data?.total ?? opinions.length}; расходятся с вердиктом: ${data?.disagree ?? 0}; ` +
        `стоимость новых вызовов $${data?.cost_usd ?? 0}` +
        (data?.reused ? `; взято из пилота: ${data.reused}` : "") +
        ". Специалист (протокол темы + научные базы) проверяет вердикт как гипотезу с фрагментом расшифровки ±60 с. Флаг не меняется.",
    }),
  );
  if (!opinions.length) {
    sec.append(el(doc, "p", { class: "nobs-src-muted", text: "Пока нет ни одного мнения." }));
    return sec;
  }
  const ul = el(doc, "ul", { class: "nobs-src-specialist-list" });
  for (const op of opinions) {
    const li = el(doc, "li", { class: op.agrees ? "is-agree" : "is-disagree" });
    const t = Math.max(0, Math.floor(Number(op.start_sec) || 0));
    const link = el(doc, "a", {
      href: `player.html?run_id=${encodeURIComponent(op.run_id)}&t=${t}`,
      target: "_blank",
      rel: "noopener",
      text: op.claim_text,
    });
    li.append(
      el(doc, "div", { class: "nobs-src-specialist-head" },
        el(doc, "span", { class: `nobs-src-flag is-${op.current_flag}`, text: flagText(op.current_flag) }),
        " → ",
        el(doc, "span", { class: `nobs-src-flag is-${op.verdict}`, text: flagText(op.verdict) }),
        " ",
        link,
      ),
      el(doc, "div", {
        class: "nobs-src-use-meta",
        text: [
          op.topic_label || op.topic,
          EVIDENCE_LABELS[op.evidence_level] ?? op.evidence_level,
          op.reused_from ? "из пилота" : op.cost_usd != null ? `$${Number(op.cost_usd).toFixed(2)}` : null,
          `прогон ${op.run_id}`,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    );
    if (op.disagreement) li.append(el(doc, "p", { class: "nobs-src-specialist-why", text: op.disagreement }));
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}
