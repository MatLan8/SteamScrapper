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
