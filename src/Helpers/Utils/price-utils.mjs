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

/**
 * Parses a Steam/market price string with mixed `,` / `.` locale rules.
 * Returns null when empty or unparseable (charm price collection behavior).
 * For sticker-style "0 when missing", use `parseSteamLocalePriceDisplay(str) ?? 0`.
 */
export function parseSteamLocalePriceDisplay(str) {
  if (!str) return null;

  const cleaned = String(str).replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized = cleaned;

  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Total price in minor units from Steam render API `listinginfo` entry.
 * Prefers converted_price + converted_fee, else price + fee.
 */
export function extractCentsFromListingInfo(listing) {
  const convertedPrice = Number(listing?.converted_price);
  const convertedFee = Number(listing?.converted_fee);

  if (Number.isFinite(convertedPrice) && Number.isFinite(convertedFee)) {
    return convertedPrice + convertedFee;
  }

  const price = Number(listing?.price);
  const fee = Number(listing?.fee);

  if (Number.isFinite(price) && Number.isFinite(fee)) {
    return price + fee;
  }

  return 0;
}
