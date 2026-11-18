// web/src/commentatorMenu.js
//
// The commentator menu that rises above the narrator button (double-click,
// long press, right click or ArrowUp on it; see controlBar.js). One entry
// per persona: emoji, name, the «пародия» badge for a parody persona (G1:
// always labelled), ✓ on the current one; a persona that does not speak the
// run's language is shown disabled with the reason. Under a separator, a
// link to the management page (a new tab, so playback is not lost).
//
// Lives inside #player-container (works in fullscreen). role="menu" with
// menuitemradio entries; arrow keys move, Enter / Space pick, Escape or a
// click outside closes and gives the focus back to the button.

import { isParody, parodyWord, supportsLang } from "./commentators.js?v=9e27a1be87";
import { t } from "./i18n.js?v=9e27a1be87";

export const MANAGE_HREF = "commentators.html";

/**
 * @param {{container: HTMLElement, anchor?: HTMLElement, onSelect: (id: string) => void,
 *   onToggle?: (open: boolean) => void, manageHref?: string, doc?: Document}} options
 */
export function createCommentatorMenu({ container, anchor = null, onSelect = () => {}, onToggle = () => {}, manageHref = MANAGE_HREF, doc = container.ownerDocument }) {
  const menu = doc.createElement("div");
  menu.className = "nobs-commentator-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  container.appendChild(menu);
  let open = false;
  // A long press opens the menu while the finger is still down; on a phone
  // the menu (a bottom sheet) may appear under that finger, and lifting it
  // would "click" an entry. A pointer click counts only when it was pressed
  // after the menu opened (keyboard clicks, detail 0, always count).
  let pressedSinceOpen = false;
  menu.addEventListener("pointerdown", () => {
    pressedSinceOpen = true;
  }, true);
  const strayClick = (event) => event.detail > 0 && !pressedSinceOpen;

  function entries() {
    return [...menu.querySelectorAll('[role^="menuitem"]:not([aria-disabled="true"])')];
  }

  function focusAt(index) {
    const list = entries();
    if (!list.length) return;
    list[(index + list.length) % list.length].focus();
  }

  function position() {
    if (!anchor) return;
    try {
      const box = container.getBoundingClientRect();
      const at = anchor.getBoundingClientRect();
      // Rises from the button: its bottom edge just above the button's top.
      menu.style.bottom = `${Math.max(0, box.bottom - at.top + 6)}px`;
      const right = Math.max(4, box.right - at.right);
      menu.style.right = `${right}px`;
    } catch {
      // no layout (tests): CSS defaults
    }
  }

  // `unavailable`: {personaId: reason} -- shown disabled with the reason
  // (the public demo: a persona with no lines for this run).
  function build({ items = [], current = null, lang = "ru", unavailable = {} } = {}) {
    menu.replaceChildren();
    menu.setAttribute("aria-label", t("commentator.menu", lang));
    const heading = doc.createElement("p");
    heading.className = "nobs-commentator-menu-title";
    heading.textContent = t("commentator.menu", lang);
    menu.appendChild(heading);
    const runLang = String(lang ?? "").split(/[-_]/)[0].toLowerCase() === "iw" ? "he" : String(lang ?? "").split(/[-_]/)[0].toLowerCase();
    for (const profile of items) {
      if (profile.enabled === false) continue;
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "nobs-commentator-item";
      item.setAttribute("role", "menuitemradio");
      item.dataset.id = profile.id;
      const checked = profile.id === current;
      item.setAttribute("aria-checked", String(checked));
      item.tabIndex = -1;
      if (profile.color) item.style.setProperty("--nobs-persona-color", profile.color);
      const mark = doc.createElement("span");
      mark.className = "nobs-commentator-check";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = checked ? "✓" : "";
      const emoji = doc.createElement("span");
      emoji.className = "nobs-commentator-emoji";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = profile.emoji ?? "";
      const name = doc.createElement("span");
      name.className = "nobs-commentator-name";
      name.textContent = profile.name || profile.id;
      item.append(mark, emoji, name);
      if (profile.parody || isParody(profile)) {
        const badge = doc.createElement("span");
        badge.className = "nobs-parody-badge";
        badge.textContent = parodyWord(lang);
        item.appendChild(badge);
      }
      const speaks = !["ru", "he"].includes(runLang) || supportsLang(profile, runLang);
      const missing = unavailable?.[profile.id];
      if (!speaks || missing) {
        item.setAttribute("aria-disabled", "true");
        const why = speaks ? String(missing) : t(`commentator.noLang.${runLang}`, lang);
        item.title = why;
        const note = doc.createElement("small");
        note.className = "nobs-commentator-note";
        note.textContent = why;
        item.appendChild(note);
      }
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        if (strayClick(event)) return;
        if (item.getAttribute("aria-disabled") === "true") return;
        close();
        onSelect(profile.id);
      });
      menu.appendChild(item);
    }
    const separator = doc.createElement("div");
    separator.className = "nobs-commentator-sep";
    separator.setAttribute("role", "separator");
    const manage = doc.createElement("a");
    manage.className = "nobs-commentator-manage";
    manage.setAttribute("role", "menuitem");
    manage.href = manageHref;
    manage.target = "_blank";
    manage.rel = "noopener";
    manage.tabIndex = -1;
    manage.textContent = t("commentator.manage", lang);
    manage.addEventListener("click", (event) => {
      event.stopPropagation();
      if (strayClick(event)) {
        event.preventDefault();
        return;
      }
      close({ restoreFocus: false });
    });
    menu.append(separator, manage);
  }

  function onKey(event) {
    if (!open) return;
    const list = entries();
    const index = list.indexOf(doc.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index < 0 ? list.length - 1 : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(list.length - 1);
    } else if (event.key === "Tab") {
      close({ restoreFocus: false });
    }
  }

  function onOutside(event) {
    if (!open) return;
    if (menu.contains(event.target) || anchor?.contains(event.target)) return;
    close({ restoreFocus: false });
  }

  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onOutside, true);

  function close({ restoreFocus = true } = {}) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    onToggle(false);
    if (restoreFocus) anchor?.focus?.();
  }

  return {
    element: menu,
    /** Show the menu with `items` (profiles), the `current` id and the run's `lang`. */
    open(state = {}) {
      build(state);
      menu.hidden = false;
      open = true;
      pressedSinceOpen = false;
      position();
      onToggle(true);
      const list = entries();
      (list.find((el) => el.getAttribute("aria-checked") === "true") ?? list[0])?.focus?.();
    },
    close,
    toggle(state) {
      if (open) close();
      else this.open(state);
    },
    isOpen: () => open,
    destroy() {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onOutside, true);
      menu.remove();
    },
  };
}
