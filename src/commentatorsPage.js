// web/src/commentatorsPage.js
//
// The commentator management page (web/commentators.html), spec §9.2:
// a list of personas (cards with «встроенный», «пародия», «изменён» badges;
// edit, duplicate, delete -- or "reset to default" for a built-in), and a
// form that asks the profile questions in Russian, validated with the same
// rules as the server (src/commentators.js). Preview: one line of the draft
// for a finished run (POST /commentators/{id}/preview, nothing is saved),
// shown with the guard's verdict and playable with the persona's voice,
// speech rate and entry sound.
//
// Safety rules (G1-G7) are shown read-only and cannot be switched off here:
// the parody label is derived from the manner and the knobs, crude humour
// stops at 2, free-form wishes go inside the rules on the server.
//
// Demo (<html data-demo="1">, the static public build): the page is built
// from the exported files, the form is read-only and every button that
// would change something (and the preview) is hidden.

import {
  DEFAULT_COMMENTATOR,
  FALLBACK_MANNERS,
  FLAGS,
  INTENSITY_KNOBS,
  LANGS,
  LIMITS,
  OPENER_KEYS,
  RATE_BY_LEVEL,
  duplicateProfile,
  emptyProfile,
  fetchCommentators,
  isParody,
  normalizeProfile,
  profilePayload,
  validateProfile,
} from "./commentators.js?v=fd4b41a77f";
import { ENGINE_IDS, fetchVoiceEngines, localEngines } from "./voiceEngines.js?v=fd4b41a77f";
import { t } from "./i18n.js?v=fd4b41a77f";

const FLAG_LABEL = { red: "🔴 красный (неверно)", yellow: "🟡 жёлтый (неточно)", green: "🟢 зелёный (верно)", white: "⚪ белый (не проверить)", scoop: "🕵️ скуп" };
const KNOB_LABEL = {
  exaggeration: "Преувеличивает",
  humor: "Шутит",
  slang: "Сыплет сленгом",
  drama: "Драматизирует",
  crude: "Грубоват в шутках",
};
const COMPLEXITY_HINT = { 1: "совсем просто", 2: "просто", 3: "обычная речь", 4: "с терминами", 5: "академично" };
const RATE_HINT = { 1: "медленно", 2: "спокойно", 3: "обычно", 4: "быстро", 5: "очень быстро" };
const ENTRY_LABEL = { click: "клик пробела", error_on_red: "звук ошибки на красном, иначе клик", error: "звук ошибки всегда", none: "без звука" };
const EXIT_LABEL = { click: "клик пробела", none: "без звука" };
const EMOJI_CHOICES = ["🤓", "📱", "🎙️", "🧐", "😎", "🤡", "📰", "🎓", "🔥", "🦉"];
const LANG_LABEL = { ru: "русский", he: "иврит" };

export const DEMO_NOTE = "Это публичное демо: профили только для просмотра. Создавать и менять комментаторов можно в локальном приложении.";

const GUARDRAILS_FALLBACK = [
  "Персона-пародия всегда помечена «пародия» в меню, на кнопке и под знаком паузы.",
  "Реплики строятся только из материалов этого разбора: утверждение, итог проверки, скупы. Профили спикеров не подаются.",
  "Нельзя: новые обвинения о реальных людях (преступления, болезни, личная жизнь), мотивы как факт сверх найденного проверкой.",
  "Нельзя: выпады по этничности, религии, полу, ориентации, инвалидности, национальности, возрасту.",
  "Нельзя: сексуальные шутки о спикерах. Предел «грубости» — 2: бытовой юмор о ситуации.",
  "Нельзя: призывы травить, писать, искать кого-либо; адреса, телефоны, аккаунты. К спикеру не обращаются по имени.",
  "Зелёный флажок нельзя называть ложью; белый — нельзя называть неправдой.",
  "Пожелания профиля работают только внутри этих правил; спорные строки отсеивает проверка (guard), без замены.",
].join("\n");

function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

/** The engines offered for a language: [{id, label}] ("" = as in the settings). */
export function voiceChoices(lang, enginesBody = {}) {
  const asSettings = { id: "", label: "как в настройках" };
  if (lang === "he") {
    return [asSettings, { id: "system", label: t("settings.voiceEngine.he.system", "ru") }, ...localEngines(enginesBody, "he").map((o) => ({ id: o.id, label: o.label ?? o.id }))];
  }
  return [asSettings, ...ENGINE_IDS.map((id) => ({ id, label: t(`settings.voiceEngine.${id}`, "ru") }))];
}

/**
 * Read the form into a profile (the draft). Only fields the form has are
 * set; the rest comes from `base`.
 */
export function readForm(form, base = emptyProfile()) {
  const p = normalizeProfile(JSON.parse(JSON.stringify(base)));
  const value = (name) => form.elements.namedItem(name)?.value ?? "";
  const checked = (name) => Boolean(form.elements.namedItem(name)?.checked);
  if (form.elements.namedItem("id")) p.id = value("id").trim();
  p.name = value("name");
  p.emoji = value("emoji").trim();
  p.color = value("color");
  p.description = value("description");
  p.languages = LANGS.filter((lang) => checked(`lang.${lang}`));
  p.speech_rate = Number(value("speech_rate"));
  p.complexity = Number(value("complexity"));
  const manner = form.querySelector('input[name="manner"]:checked');
  if (manner) p.manner = manner.value;
  for (const knob of INTENSITY_KNOBS) p.intensity[knob] = Number(value(`intensity.${knob}`));
  p.triggers.flags = FLAGS.filter((flag) => checked(`flag.${flag}`));
  p.triggers.scoops = checked("scoops");
  p.triggers.frequency = form.querySelector('input[name="frequency"]:checked')?.value ?? "all";
  p.triggers.top_n = Number(value("top_n"));
  p.triggers.min_gap_sec = Number(value("min_gap_sec"));
  p.max_words = Number(value("max_words"));
  for (const lang of LANGS) {
    for (const key of OPENER_KEYS) {
      p.openers[lang][key] = value(`openers.${lang}.${key}`)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
    p.voices[lang] = value(`voices.${lang}`) || null;
  }
  p.sounds.entry = value("sounds.entry");
  p.sounds.exit = value("sounds.exit");
  if (form.elements.namedItem("text_mode")) p.text_mode = value("text_mode");
  p.extra_instructions = value("extra_instructions");
  p.enabled = checked("enabled");
  p.parody = isParody(p); // G1: derived, never a form field
  return p;
}

/**
 * Mount the page into `root`. Returns {ready, state}; `ready` resolves once
 * the list, the manners and the runs are loaded.
 */
export function mountCommentatorsPage(root, {
  fetchImpl = globalThis.fetch?.bind(globalThis),
  doc = root.ownerDocument,
  demo = doc.documentElement.dataset.demo === "1",
  confirmImpl = (message) => globalThis.confirm?.(message) ?? false,
  listen = null,
  storage = null,
} = {}) {
  const state = { list: [], meta: null, runs: [], engines: {}, editing: null, isNew: false, dirty: false, base: null, preview: null };
  const win = doc.defaultView ?? globalThis;

  const listBox = el(doc, "section", { class: "nobs-cm-list", "aria-label": "Комментаторы" });
  const formBox = el(doc, "section", { class: "nobs-cm-editor", "aria-live": "polite" });
  const status = el(doc, "p", { class: "nobs-cm-status", role: "status" });
  root.replaceChildren(
    ...(demo ? [el(doc, "p", { class: "nobs-cm-demo", role: "note", text: DEMO_NOTE })] : []),
    status,
    el(doc, "div", { class: "nobs-cm-layout" }, listBox, formBox)
  );

  function say(text, kind = "info") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  async function getJson(url, fallback) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) return fallback;
      return await response.json();
    } catch {
      return fallback;
    }
  }

  async function send(method, url, body) {
    const response = await fetchImpl(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = response.status === 204 ? null : await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : Array.isArray(data?.detail) ? data.detail.map((d) => d.msg ?? String(d)).join("; ") : `HTTP ${response.status}`;
      const err = new Error(detail);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const manners = () => (Array.isArray(state.meta?.manners) && state.meta.manners.length ? state.meta.manners : FALLBACK_MANNERS);

  // ---- List ----
  function renderList() {
    const cards = state.list.map((profile) => {
      const badges = el(doc, "span", { class: "nobs-cm-badges" });
      if (profile.built_in) badges.append(el(doc, "span", { class: "nobs-cm-badge", text: "встроенный" }));
      if (profile.parody || isParody(profile)) badges.append(el(doc, "span", { class: "nobs-parody-badge", text: "пародия" }));
      if (profile.customized) badges.append(el(doc, "span", { class: "nobs-cm-badge", text: "изменён" }));
      if (profile.enabled === false) badges.append(el(doc, "span", { class: "nobs-cm-badge", text: "выключен" }));
      const actions = el(doc, "div", { class: "nobs-cm-actions" });
      const button = (label, action, cls = "") =>
        el(doc, "button", { type: "button", class: `nobs-cm-button ${cls}`.trim(), text: label, dataset: { action } });
      actions.append(button(demo ? "Открыть" : "Изменить", "edit"));
      if (!demo) {
        actions.append(button("Дублировать", "duplicate"));
        if (profile.built_in) {
          const reset = button("Сбросить к умолчанию", "reset");
          reset.disabled = !profile.customized;
          actions.append(reset);
        } else actions.append(button("Удалить", "delete", "is-danger"));
      }
      actions.addEventListener("click", (event) => {
        const action = event.target?.dataset?.action;
        if (action === "edit") guard(() => edit(profile));
        if (action === "duplicate") guard(() => edit(duplicateProfile(profile, state.list.map((p) => p.id)), { isNew: true }));
        if (action === "reset") reset(profile);
        if (action === "delete") remove(profile);
      });
      const card = el(
        doc,
        "article",
        { class: "nobs-cm-card", dataset: { id: profile.id } },
        el(doc, "span", { class: "nobs-cm-emoji", "aria-hidden": "true", text: profile.emoji }),
        el(doc, "div", { class: "nobs-cm-card-text" }, el(doc, "strong", { text: profile.name || profile.id }), el(doc, "code", { text: profile.id }), badges, profile.description ? el(doc, "small", { text: profile.description }) : null),
        actions
      );
      card.style.setProperty("--nobs-persona-color", profile.color ?? "transparent");
      if (state.editing && state.editing.id === profile.id && !state.isNew) card.setAttribute("aria-current", "true");
      return card;
    });
    const header = el(doc, "div", { class: "nobs-cm-list-head" }, el(doc, "h2", { text: "Профили" }));
    if (!demo) {
      const add = el(doc, "button", { type: "button", class: "nobs-cm-button is-primary nobs-cm-new", text: "+ Новый комментатор" });
      add.addEventListener("click", () => guard(() => edit(emptyProfile(), { isNew: true })));
      header.append(add);
    }
    listBox.replaceChildren(header, ...cards);
  }

  // Leaving unsaved changes asks first.
  function guard(fn) {
    if (state.dirty && !confirmImpl("Есть несохранённые изменения. Отбросить их?")) return;
    state.dirty = false;
    fn();
  }

  // ---- Form ----
  function fieldset(legend, ...children) {
    return el(doc, "fieldset", { class: "nobs-cm-group" }, el(doc, "legend", { text: legend }), ...children);
  }

  function question(label, control, hint = "", name = "") {
    const wrap = el(doc, "label", { class: "nobs-cm-q" }, el(doc, "span", { class: "nobs-cm-q-label", text: label }), control);
    if (hint) wrap.append(el(doc, "small", { class: "nobs-cm-hint", text: hint }));
    wrap.append(el(doc, "small", { class: "nobs-cm-error", dataset: { error: name || control.name || "" } }));
    return wrap;
  }

  function range(name, min, max, value, describe) {
    const input = el(doc, "input", { type: "range", name, min: String(min), max: String(max), step: "1", value: String(value) });
    const out = el(doc, "output", { class: "nobs-cm-out", for: name });
    const show = () => {
      out.textContent = describe ? describe(Number(input.value)) : input.value;
    };
    input.addEventListener("input", show);
    show();
    return el(doc, "span", { class: "nobs-cm-range" }, input, out);
  }

  function edit(profile, { isNew = false } = {}) {
    state.editing = normalizeProfile(profile);
    state.base = state.editing;
    state.isNew = isNew;
    state.dirty = false;
    state.preview = null;
    renderForm();
    renderList();
  }

  function renderForm() {
    const p = state.editing;
    if (!p) {
      formBox.replaceChildren(el(doc, "p", { class: "nobs-cm-empty", text: demo ? "Выберите комментатора слева, чтобы посмотреть его профиль." : "Выберите комментатора слева или создайте нового." }));
      return;
    }
    const form = el(doc, "form", { class: "nobs-cm-form", novalidate: true });
    const title = state.isNew ? "Новый комментатор" : `${p.emoji} ${p.name || p.id}`;
    const parodyNote = el(doc, "p", { class: "nobs-cm-parody-note", role: "note" }, el(doc, "span", { class: "nobs-parody-badge", text: "пародия" }), " Эта персона будет помечена как пародия: в меню, на кнопке и под знаком паузы, пока она говорит.");

    // Who
    const idInput = el(doc, "input", { type: "text", name: "id", value: p.id, maxlength: "32", autocomplete: "off", spellcheck: "false", pattern: "[a-z][a-z0-9-]{1,31}" });
    const idQuestion = state.isNew
      ? question("Как к нему обращаться в коде?", idInput, "Латиница, цифры и дефис; потом не меняется.")
      : el(doc, "p", { class: "nobs-cm-q" }, el(doc, "span", { class: "nobs-cm-q-label", text: "id" }), el(doc, "code", { text: p.id }));
    const emojiInput = el(doc, "input", { type: "text", name: "emoji", value: p.emoji, maxlength: "16", class: "nobs-cm-emoji-input" });
    const quick = el(doc, "span", { class: "nobs-cm-emoji-quick" }, ...EMOJI_CHOICES.map((e) => {
      const b = el(doc, "button", { type: "button", class: "nobs-cm-chip", text: e, "aria-label": `значок ${e}` });
      b.addEventListener("click", () => {
        emojiInput.value = e;
        form.dispatchEvent(new win.Event("input", { bubbles: true }));
      });
      return b;
    }));
    const who = fieldset(
      "Кто он",
      idQuestion,
      question("Как его зовут?", el(doc, "input", { type: "text", name: "name", value: p.name, maxlength: String(LIMITS.name) })),
      question("Его значок?", el(doc, "span", { class: "nobs-cm-row" }, emojiInput, quick), "Один эмодзи.", "emoji"),
      question("Его цвет в меню?", el(doc, "input", { type: "color", name: "color", value: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#8ab4ff" })),
      question("Кто он, в двух словах?", el(doc, "textarea", { name: "description", rows: "2", maxlength: String(LIMITS.description), text: p.description }), `До ${LIMITS.description} символов; модель видит это как описание роли.`),
      question(
        "На каких языках говорит?",
        el(doc, "span", { class: "nobs-cm-row" }, ...LANGS.map((lang) => el(doc, "label", { class: "nobs-cm-check" }, el(doc, "input", { type: "checkbox", name: `lang.${lang}`, checked: p.languages.includes(lang) }), ` ${LANG_LABEL[lang]}`))),
        "На других языках прогона он недоступен (в меню — серым).",
        "languages"
      )
    );

    // How he speaks
    const mannerCards = el(doc, "div", { class: "nobs-cm-manners", role: "radiogroup", "aria-label": "Манера речи" }, ...manners().map((m) =>
      el(doc, "label", { class: "nobs-cm-manner" },
        el(doc, "input", { type: "radio", name: "manner", value: m.key, checked: m.key === p.manner }),
        el(doc, "span", { text: m.label_ru ?? m.key }),
        m.parody ? el(doc, "span", { class: "nobs-parody-badge", text: "пародия" }) : null)
    ));
    const knobs = INTENSITY_KNOBS.map((knob) => {
      const max = knob === "crude" ? LIMITS.crude[1] : LIMITS.intensity[1];
      const hint = knob === "crude" ? "Максимум 2: бытовой юмор о ситуации, без пошлостей о людях." : "";
      return question(`${KNOB_LABEL[knob]}?`, range(`intensity.${knob}`, 0, max, Math.min(p.intensity[knob] ?? 0, max)), hint, `intensity.${knob}`);
    });
    const speech = fieldset(
      "Как говорит",
      question("Как быстро говорит? (1 — медленно … 5 — очень быстро)", range("speech_rate", 1, 5, p.speech_rate, (v) => `${v} · ×${RATE_BY_LEVEL[v]} · ${RATE_HINT[v]}`), "", "speech_rate"),
      question("Насколько сложно говорит? (1 — совсем просто … 5 — академично)", range("complexity", 1, 5, p.complexity, (v) => `${v} · ${COMPLEXITY_HINT[v]}`), "", "complexity"),
      el(doc, "div", { class: "nobs-cm-q" }, el(doc, "span", { class: "nobs-cm-q-label", text: "Какая у него манера речи?" }), mannerCards, el(doc, "small", { class: "nobs-cm-error", dataset: { error: "manner" } })),
      el(doc, "p", { class: "nobs-cm-sub", text: "Насколько он преувеличивает / шутит / сыплет сленгом / драматизирует (0 — нет, 5 — максимум)?" }),
      ...knobs,
      question("Сколько слов максимум в реплике?", el(doc, "input", { type: "number", name: "max_words", min: String(LIMITS.max_words[0]), max: String(LIMITS.max_words[1]), value: String(p.max_words) }), `${LIMITS.max_words[0]}–${LIMITS.max_words[1]}.`)
    );
    if (p.id === DEFAULT_COMMENTATOR) {
      speech.append(question("Что зачитывает?", el(doc, "select", { name: "text_mode" },
        el(doc, "option", { value: "generated", text: "сгенерированный текст (фривольный)", selected: p.text_mode !== "summary" }),
        el(doc, "option", { value: "summary", text: "итог проверки как есть", selected: p.text_mode === "summary" })), "У душнилы это же переключается в настройках плеера."));
    }

    // When he stops
    const freq = p.triggers.frequency === "top_n" ? "top_n" : "all";
    const when = fieldset(
      "Когда вмешивается",
      question("Где он останавливает видео?", el(doc, "span", { class: "nobs-cm-row" }, ...FLAGS.map((flag) => el(doc, "label", { class: "nobs-cm-check" }, el(doc, "input", { type: "checkbox", name: `flag.${flag}`, checked: p.triggers.flags.includes(flag) }), ` ${FLAG_LABEL[flag]}`))), "", "triggers.flags"),
      question("Читает ли он скупы?", el(doc, "label", { class: "nobs-cm-check" }, el(doc, "input", { type: "checkbox", name: "scoops", checked: Boolean(p.triggers.scoops) }), " да, останавливается на показанных скупах"), "Скуп — гипотеза анализа; при низкой уверенности звучит как подозрение.", "scoops"),
      el(doc, "div", { class: "nobs-cm-q" },
        el(doc, "span", { class: "nobs-cm-q-label", text: "Как часто вмешивается?" }),
        el(doc, "label", { class: "nobs-cm-check" }, el(doc, "input", { type: "radio", name: "frequency", value: "all", checked: freq === "all" }), " на каждой метке"),
        el(doc, "label", { class: "nobs-cm-check" }, el(doc, "input", { type: "radio", name: "frequency", value: "top_n", checked: freq === "top_n" }), " только ", el(doc, "input", { type: "number", name: "top_n", min: "1", max: "50", value: String(p.triggers.top_n ?? 8), class: "nobs-cm-small", "aria-label": "сколько самых важных" }), " самых важных за видео"),
        el(doc, "label", { class: "nobs-cm-check" }, "не чаще раза в ", el(doc, "input", { type: "number", name: "min_gap_sec", min: "0", max: "600", value: String(p.triggers.min_gap_sec ?? 0), class: "nobs-cm-small", "aria-label": "секунд между остановками" }), " секунд"),
        el(doc, "small", { class: "nobs-cm-hint", text: "Важность: красный, скуп, жёлтый, белый, зелёный." }),
        el(doc, "small", { class: "nobs-cm-error", dataset: { error: "triggers.top_n" } }),
        el(doc, "small", { class: "nobs-cm-error", dataset: { error: "triggers.min_gap_sec" } }))
    );

    // Openers, per language and colour
    const openerTabs = el(doc, "div", { class: "nobs-cm-openers" }, ...LANGS.map((lang) =>
      el(doc, "details", { class: "nobs-cm-opener-lang", open: lang === "ru" },
        el(doc, "summary", { text: LANG_LABEL[lang] }),
        ...OPENER_KEYS.map((key) => question(FLAG_LABEL[key], el(doc, "textarea", { name: `openers.${lang}.${key}`, rows: "3", dir: lang === "he" ? "rtl" : "auto", text: (p.openers[lang][key] ?? []).join("\n") }), "", `openers.${lang}.${key}`)))
    ));
    const voiceSelect = (lang) =>
      el(doc, "select", { name: `voices.${lang}` }, ...voiceChoices(lang, state.engines).map((o) => el(doc, "option", { value: o.id, text: o.label, selected: (p.voices[lang] ?? "") === o.id })));
    const sound = fieldset(
      "Голос и звук",
      question("Его коронные фразы для начала (по одной в строке, по цветам)", openerTabs, "Образцы начала реплики; модель обязана их варьировать. До 8 фраз по 80 символов.", "openers"),
      ...LANGS.map((lang) => question(`Каким голосом говорит (${LANG_LABEL[lang]})?`, voiceSelect(lang))),
      question("Какой звук перед репликой?", el(doc, "select", { name: "sounds.entry" }, ...Object.entries(ENTRY_LABEL).map(([v, label]) => el(doc, "option", { value: v, text: label, selected: p.sounds.entry === v })))),
      question("Какой звук после?", el(doc, "select", { name: "sounds.exit" }, ...Object.entries(EXIT_LABEL).map(([v, label]) => el(doc, "option", { value: v, text: label, selected: p.sounds.exit === v }))))
    );

    const extra = fieldset(
      "Ещё",
      question("Что ещё ему сказать? (работает только внутри правил безопасности ниже)", el(doc, "textarea", { name: "extra_instructions", rows: "3", maxlength: String(LIMITS.extra_instructions), text: p.extra_instructions }), `До ${LIMITS.extra_instructions} символов.`),
      question("Включён?", el(doc, "label", { class: "nobs-cm-check" }, el(doc, "input", { type: "checkbox", name: "enabled", checked: p.enabled !== false }), " показывать в меню плеера"), "", "enabled")
    );

    const rules = el(doc, "section", { class: "nobs-cm-rules", "aria-label": "Правила безопасности" },
      el(doc, "h3", { text: "Правила безопасности (не настраиваются)" }),
      el(doc, "pre", { class: "nobs-cm-rules-text", text: state.meta?.guardrails_text_ru || GUARDRAILS_FALLBACK }));

    const buttons = el(doc, "div", { class: "nobs-cm-form-actions" });
    if (!demo) {
      buttons.append(
        el(doc, "button", { type: "submit", class: "nobs-cm-button is-primary", text: state.isNew ? "Создать" : "Сохранить" }),
        el(doc, "button", { type: "button", class: "nobs-cm-button", text: "Отмена", dataset: { action: "cancel" } })
      );
    }

    form.append(el(doc, "h2", { text: title }), parodyNote, who, speech, when, sound, extra, rules, buttons);
    if (!demo) form.append(previewSection());
    if (demo) for (const control of form.querySelectorAll("input, textarea, select")) control.disabled = true;
    if (demo) for (const chip of form.querySelectorAll(".nobs-cm-chip")) chip.hidden = true;

    const refreshParody = () => {
      const draft = readForm(form, state.base);
      parodyNote.hidden = !draft.parody;
    };
    refreshParody();
    form.addEventListener("input", () => {
      state.dirty = !demo;
      refreshParody();
    });
    form.addEventListener("change", () => {
      state.dirty = !demo;
      refreshParody();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save(form);
    });
    form.querySelector('[data-action="cancel"]')?.addEventListener("click", () =>
      guard(() => {
        state.editing = null;
        renderForm();
        renderList();
      })
    );
    formBox.replaceChildren(form);
    state.form = form;
  }

  function showErrors(form, errors) {
    for (const node of form.querySelectorAll(".nobs-cm-error")) {
      const key = node.dataset.error;
      const message = errors[key] ?? (key === "openers" ? Object.entries(errors).find(([k]) => k.startsWith("openers."))?.[1] : undefined);
      node.textContent = message ?? "";
    }
    return Object.keys(errors).length === 0;
  }

  async function save(form) {
    const draft = readForm(form, state.base);
    const errors = validateProfile(draft, { isNew: state.isNew, takenIds: state.list.map((p) => p.id) });
    if (!showErrors(form, errors)) {
      say("Проверьте поля, отмеченные красным.", "error");
      form.querySelector(".nobs-cm-error:not(:empty)")?.closest(".nobs-cm-q")?.querySelector("input, textarea, select")?.focus?.();
      return null;
    }
    const body = profilePayload(draft);
    try {
      const saved = state.isNew
        ? await send("POST", "/commentators", body)
        : await send("PUT", `/commentators/${encodeURIComponent(draft.id)}`, body);
      state.dirty = false;
      say(state.isNew ? `Создан «${draft.name}».` : `Сохранено: «${draft.name}».`);
      await reload();
      const fresh = state.list.find((p) => p.id === draft.id) ?? normalizeProfile(saved ?? draft);
      edit(fresh);
      return fresh;
    } catch (err) {
      if (err.status === 409) showErrors(form, { id: "Такой id уже есть или зарезервирован." });
      say(`Не сохранено: ${err.message}`, "error");
      return null;
    }
  }

  async function reset(profile) {
    if (!confirmImpl(`Вернуть «${profile.name}» к настройкам по умолчанию? Ваши изменения пропадут.`)) return;
    try {
      await send("POST", `/commentators/${encodeURIComponent(profile.id)}/reset`);
      say(`«${profile.name}» сброшен к умолчанию.`);
      state.dirty = false;
      await reload();
      if (state.editing?.id === profile.id) edit(state.list.find((p) => p.id === profile.id) ?? profile);
    } catch (err) {
      say(`Не сброшено: ${err.message}`, "error");
    }
  }

  async function remove(profile) {
    if (!confirmImpl(`Удалить комментатора «${profile.name}»? Его реплики во всех разборах тоже удалятся.`)) return;
    try {
      await send("DELETE", `/commentators/${encodeURIComponent(profile.id)}`);
      // The player's choice falls back to душнила.
      try {
        const store = storage ?? win.localStorage;
        const settings = JSON.parse(store?.getItem("nobs.settings") ?? "{}") ?? {};
        if (settings.commentator === profile.id) {
          settings.commentator = DEFAULT_COMMENTATOR;
          store.setItem("nobs.settings", JSON.stringify(settings));
        }
      } catch {
        // storage blocked: the player falls back by itself
      }
      say(`«${profile.name}» удалён.`);
      if (state.editing?.id === profile.id) {
        state.editing = null;
        state.dirty = false;
      }
      await reload();
      renderForm();
    } catch (err) {
      say(`Не удалено: ${err.message}`, "error");
    }
  }

  // ---- Preview ----
  function previewSection() {
    const runSelect = el(doc, "select", { name: "preview.run", "aria-label": "Разбор для примера" },
      ...state.runs.map((run) => el(doc, "option", { value: String(run.run_id), text: `#${run.run_id} · ${run.title || run.video_id || ""} (${run.caption_language ?? "?"})` })));
    const itemInput = el(doc, "input", { type: "text", name: "preview.item", placeholder: "c:123 или s:9 — необязательно", class: "nobs-cm-small-wide", "aria-label": "Утверждение или скуп" });
    const go = el(doc, "button", { type: "button", class: "nobs-cm-button", text: "Сгенерировать пример", dataset: { action: "preview" } });
    const out = el(doc, "div", { class: "nobs-cm-preview-out", "aria-live": "polite" });
    go.disabled = !state.runs.length;
    go.addEventListener("click", () => preview(runSelect.value, itemInput.value, out, go));
    return el(doc, "section", { class: "nobs-cm-preview", "aria-label": "Превью" },
      el(doc, "h3", { text: "Превью" }),
      el(doc, "p", { class: "nobs-cm-hint", text: "Одна реплика текущего черновика для готового разбора. Ничего не сохраняется; занимает 10–30 секунд." }),
      el(doc, "div", { class: "nobs-cm-row" }, runSelect, itemInput, go),
      out);
  }

  async function preview(runId, itemRef, out, go) {
    const form = state.form;
    const draft = readForm(form, state.base);
    const errors = validateProfile(draft, { isNew: false });
    delete errors.id;
    if (!showErrors(form, errors)) {
      say("Сначала исправьте поля, отмеченные красным.", "error");
      return null;
    }
    const body = { run_id: Number(runId), profile: profilePayload({ ...draft, id: draft.id || "draft" }) };
    const ref = String(itemRef ?? "").trim().match(/^([cs]):(\d+)$/);
    if (ref) body[ref[1] === "c" ? "claim_id" : "scoop_id"] = Number(ref[2]);
    go.disabled = true;
    out.replaceChildren(el(doc, "p", { class: "nobs-cm-spinner", text: "Генерируем пример…" }));
    const id = state.isNew || !draft.id ? encodeURIComponent(draft.id || "draft") : encodeURIComponent(draft.id);
    try {
      const result = await send("POST", `/commentators/${id}/preview`, body);
      state.preview = result;
      const ok = result?.guard?.ok !== false;
      const play = el(doc, "button", { type: "button", class: "nobs-cm-button", text: "▶ Прослушать" });
      play.addEventListener("click", () => (listen ?? defaultListen)(result, draft, runLang(runId)));
      out.replaceChildren(
        el(doc, "p", { class: "nobs-cm-preview-meta" },
          el(doc, "span", { class: `nobs-cm-guard ${ok ? "is-ok" : "is-bad"}`, text: ok ? "guard ✓" : `guard ✗ ${result?.guard?.rule ?? ""}` }),
          ` ${result?.kind === "scoop" ? `скуп ${result.scoop_id}` : `утверждение ${result?.claim_id ?? ""}`}`,
          draft.parody ? el(doc, "span", { class: "nobs-parody-badge", text: "пародия" }) : null),
        el(doc, "blockquote", { class: "nobs-cm-preview-text", text: result?.text ?? "" }),
        play
      );
      return result;
    } catch (err) {
      const message = err.status === 422 ? `Проверка отклонила реплику: ${err.message}` : err.status === 409 ? "Уже идёт другой пример, подождите." : `Не получилось: ${err.message}`;
      out.replaceChildren(el(doc, "p", { class: "nobs-cm-guard is-bad", text: message }));
      return null;
    } finally {
      go.disabled = false;
    }
  }

  function runLang(runId) {
    const run = state.runs.find((r) => String(r.run_id) === String(runId));
    const base = String(run?.caption_language ?? "ru").split(/[-_]/)[0].toLowerCase();
    return base === "iw" ? "he" : base;
  }

  async function defaultListen(result, draft, lang) {
    const voice = await import("./voice.js?v=fd4b41a77f");
    const engines = await import("./voiceEngines.js?v=fd4b41a77f");
    const settings = await import("./settings.js?v=fd4b41a77f");
    const text = String(result?.text ?? "");
    if (!text) return;
    const flags = lang === "he"
      ? { system: engines.systemSupported() && Boolean(engines.findSystemVoice("he")), local: settings.localVoiceIds("he") }
      : { piper: engines.piperSupported(), system: engines.systemSupported(), silero: await voice.checkVoiceHealth(fetchImpl) };
    settings.setLocalVoices(state.engines);
    const own = draft.voices?.[lang];
    const id = own && engines.resolveEngineId(own, flags, lang) === own ? own : engines.resolveEngineId(settings.voiceEngine(lang), flags, lang);
    if (!id) {
      say("Нет голоса для этого языка в браузере.", "error");
      return;
    }
    const rate = RATE_BY_LEVEL[draft.speech_rate] ?? 1.1;
    voice.primeClick();
    const entry = draft.sounds?.entry ?? "click";
    let wait = 0;
    if (entry === "error" || (entry === "error_on_red" && result?.flag === "red")) wait = voice.playErrorSound(1);
    if (!wait && entry !== "none") wait = voice.playKeyClick(1);
    const engine = id === "system" ? engines.createSystemEngine({ lang }) : engines.createEngine(id, { fetchImpl, lang });
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (engine.kind === "speech") {
      engine.speak(text, { rate });
      return;
    }
    await engine.prepare?.();
    const blob = await engine.synthesize(text, { isWanted: () => true });
    const audio = new win.Audio(URL.createObjectURL(blob));
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    await audio.play();
  }

  async function reload() {
    const { list } = await fetchCommentators(fetchImpl, { all: true });
    state.list = list;
    renderList();
  }

  win.addEventListener?.("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const ready = (async () => {
    say("Загружаем…");
    const [meta, runs, engines] = await Promise.all([
      getJson("/commentators/meta", null),
      demo ? Promise.resolve({ runs: [] }) : getJson("/runs", { runs: [] }),
      demo ? Promise.resolve({}) : fetchVoiceEngines(fetchImpl).catch(() => ({})),
    ]);
    state.meta = meta;
    state.runs = (runs?.runs ?? []).filter((run) => (run.status ?? "complete") === "complete");
    state.engines = engines ?? {};
    await reload();
    renderForm();
    say(demo ? "" : `${state.list.length} комментатор(ов).`);
  })();

  return {
    ready,
    state,
    edit,
    save: () => (state.form ? save(state.form) : Promise.resolve(null)),
    preview: () => {
      const section = state.form?.querySelector(".nobs-cm-preview");
      if (!section) return Promise.resolve(null);
      return preview(section.querySelector('[name="preview.run"]').value, section.querySelector('[name="preview.item"]').value, section.querySelector(".nobs-cm-preview-out"), section.querySelector('[data-action="preview"]'));
    },
  };
}
