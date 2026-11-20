// web/src/themeEarly.js — a classic script in <head>, before the stylesheet
// draws anything: puts the saved theme (settings: dark / light / monochrome /
// system) on <html data-theme>, so the page never flashes the wrong one.
// Same rules as resolvedTheme() in src/settings.js.
(function () {
  var themes = ["dark", "light", "monochrome"];
  var theme = "dark";
  try {
    var saved = JSON.parse(localStorage.getItem("nobs.settings") || "{}").theme;
    if (saved === "system") {
      theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } else if (themes.indexOf(saved) >= 0) {
      theme = saved;
    }
  } catch (e) {
    theme = "dark";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
