import { USD_TO_EUR_RATE } from "../Config/constants.mjs";

export function eurosFromUsdCents(cents) {
  return (cents / 100) * USD_TO_EUR_RATE;
}

export function centsFromPossibleSteamValue(value) {
  if (Number.isInteger(value)) return value;
  return 0;
}

export function extractCentsFromPriceText(priceText) {
  const match = String(priceText ?? "")
    .replace(/\s+/g, " ")
    .match(/([\d.,]+)/);

  if (!match) return 0;

  let value = match[1];

  if (value.includes(",") && value.includes(".")) {
    if (value.lastIndexOf(",") > value.lastIndexOf(".")) {
      value = value.replaceAll(".", "").replace(",", ".");
    } else {
      value = value.replaceAll(",", "");
    }
  } else if (value.includes(",")) {
    value = value.replace(",", ".");
  }

  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return 0;

  return Math.round(number * 100);
}

export function normalizeNumberPrice(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}
