// web/src/accountMenuBoot.js — the top bar of the page that loads it: the
// interface language (src/uiLang.js: [data-i18n] labels of
// the bar and footer) and the account corner (src/accountMenu.js).
import { mountAccountMenu } from "./accountMenu.js?v=fc9b98c915";
import { initUiLang, translatePage } from "./uiLang.js?v=fc9b98c915";

const lang = initUiLang();
const bar = document.querySelector(".nobs-topbar");
for (const root of [bar, document.querySelector(".nobs-footer")]) if (root) translatePage(root, lang);
mountAccountMenu().catch(() => {});
