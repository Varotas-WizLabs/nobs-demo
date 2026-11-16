// web/src/runStats.js
//
// Formats a run's `stats` (from GET /runs/{id}, /runs/{id}/status, /runs):
// how long processing took, what it cost and which models served it.

/** "claude-sonnet-5-5" -> "Sonnet 5.5"; other names are kept as they are. */
export function modelLabel(name) {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(String(name));
  if (!match) return String(name);
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return `${family} ${match[2]}.${match[3]}`;
}

/** Seconds -> "2m41s" / "48s" ("" for null). */
export function formatDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes}m${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

/** USD -> "$1.49" ("" for null). */
export function formatCost(usd) {
  if (typeof usd !== "number" || !Number.isFinite(usd)) return "";
  return `$${usd.toFixed(2)}`;
}

/** Models, most expensive first: "Sonnet 5.5 $1.10, Haiku 5.5 $0.39". */
export function formatModels(models) {
  return Object.entries(models ?? {})
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([name, cost]) => (typeof cost === "number" ? `${modelLabel(name)} ${formatCost(cost)}` : modelLabel(name)))
    .join(", ");
}

/**
 * One line: "2m41s (+24s tags) · $1.49 · Sonnet 5.5 $1.10, Haiku 5.5 $0.39 · 38 LLM calls, 50 web searches".
 * Parts the server did not report are left out; "" when nothing is known.
 */
export function formatUsage(stats) {
  if (!stats) return "";
  const parts = [];
  const duration = formatDuration(stats.duration_sec);
  // The tag stage runs after the run is marked complete: its own time.
  const tags = formatDuration(stats.tags_duration_sec);
  if (duration) parts.push(tags ? `${duration} (+${tags} tags)` : duration);
  const cost = formatCost(stats.cost_usd);
  if (cost) parts.push(cost);
  const models = formatModels(stats.models);
  if (models) parts.push(models);
  if (stats.llm_calls) {
    parts.push(`${stats.llm_calls} LLM calls, ${stats.web_searches ?? 0} web searches`);
  }
  return parts.join(" · ");
}
