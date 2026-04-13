export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debugLog(args, ...parts) {
  if (args.debug) {
    console.log(...parts);
  }
}

export function formatEuro(value) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2);
}

export function formatEfficiencyDisplay(value) {
  if (value === Number.POSITIVE_INFINITY) return "INF";
  if (!Number.isFinite(value)) return "";
  return value.toFixed(4);
}

export function sortedNumericStrings(values) {
  return [...values].sort((a, b) => Number(a) - Number(b));
}

/** Human-readable duration for logging (e.g. rate-limit sleeps). */
export function formatDurationMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}
