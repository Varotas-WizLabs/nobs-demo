// web/src/accountMenuBoot.js — shows the account corner of the top bar
// (src/accountMenu.js) on the page that loads it.
import { mountAccountMenu } from "./accountMenu.js?v=0126c7d901";

mountAccountMenu().catch(() => {});
