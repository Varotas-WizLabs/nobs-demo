// web/src/accountMenuBoot.js — the top bar of the page that loads it: the
// interface language (src/uiLang.js: RU / EN switch, [data-i18n] labels of
// the bar and footer) and the account corner (src/accountMenu.js).
import { mountAccountMenu } from "./accountMenu.js?v=8999e255c1";
import { initUiLang, reloadWithout, renderLangSwitch, translatePage } from "./uiLang.js?v=8999e255c1";

const lang = initUiLang();
const bar = document.querySelector(".nobs-topbar");
for (const root of [bar, document.querySelector(".nobs-footer")]) if (root) translatePage(root, lang);
if (bar) renderLangSwitch(document, bar, { lang, storage: globalThis.localStorage, reload: () => reloadWithout() });
mountAccountMenu().catch(() => {});
