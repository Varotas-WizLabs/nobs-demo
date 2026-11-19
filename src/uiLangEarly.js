// web/src/uiLangEarly.js — a classic script in <head>, before any module:
// picks the interface language (same rules as detectUiLang in src/uiLang.js)
// and puts it on <html data-ui-lang lang>, so src/i18n.js knows it from the
// first label any module draws.
(function () {
  var langs = ["ru", "en"];
  var russian = ["ru", "uk", "be", "kk"];
  var lang = null;
  try {
    var q = new URLSearchParams(location.search).get("lang");
    if (langs.indexOf(q) >= 0) {
      lang = q;
      try { localStorage.setItem("nobs.lang", q); } catch (e) {}
    }
  } catch (e) {}
  if (!lang) {
    try {
      var saved = localStorage.getItem("nobs.lang");
      if (langs.indexOf(saved) >= 0) lang = saved;
    } catch (e) {}
  }
  if (!lang) {
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ""];
    for (var i = 0; i < list.length && !lang; i++) {
      var b = String(list[i] || "").split(/[-_]/)[0].toLowerCase();
      if (russian.indexOf(b) >= 0) lang = "ru";
      else if (b === "en") lang = "en";
    }
  }
  lang = lang || "en";
  document.documentElement.setAttribute("data-ui-lang", lang);
  document.documentElement.lang = lang;
})();
