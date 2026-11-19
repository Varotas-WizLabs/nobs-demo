// web/src/accountMenuBoot.js — shows the account corner of the top bar
// (src/accountMenu.js) on the page that loads it.
import { mountAccountMenu } from "./accountMenu.js?v=2a52d7b88c";

mountAccountMenu().catch(() => {});
