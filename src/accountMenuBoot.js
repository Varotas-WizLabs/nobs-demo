// web/src/accountMenuBoot.js — shows the account corner of the top bar
// (src/accountMenu.js) on the page that loads it.
import { mountAccountMenu } from "./accountMenu.js?v=cc372a02d2";

mountAccountMenu().catch(() => {});
