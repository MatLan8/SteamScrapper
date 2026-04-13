import { APPID, CURRENCY, USER_AGENT } from "../Config/constants.mjs";
import { extractCentsFromListingInfo } from "../utils/price-utils.mjs";

/**
 * @param {string} marketHashName
 * @param {number} start
 * @param {number} count
 * @param {number} [currency]
 */
export function buildRenderUrl(
  marketHashName,
  start,
  count,
  currency = CURRENCY,
) {
  const encodedName = encodeURIComponent(marketHashName);
  return `https://steamcommunity.com/market/listings/${APPID}/${encodedName}/render?currency=${currency}&start=${start}&count=${count}`;
}

/**
 * Headers for GET listing render JSON (non-search).
 */
export function buildRenderHeaders(refererUrl, cookie) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    Referer: refererUrl,
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

export function decodeHtmlEntities(text) {
  return String(text ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/**
 * @returns {Map<string, string>} listingId -> steam:// inspect href
 */
export function extractInspectLinksFromResultsHtml(resultsHtml) {
  const inspectLinksByListingId = new Map();
  const html = String(resultsHtml ?? "");

  const rowRegex =
    /<div class="market_listing_row[\s\S]*?\sid="listing_(\d+)"[\s\S]*?<div class="market_listing_row_action"><a href="(steam:\/\/[^"]+)">Inspect in Game\.\.\.<\/a><\/div>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const listingId = match[1];
    const inspectLink = decodeHtmlEntities(match[2]);
    inspectLinksByListingId.set(listingId, inspectLink);
  }

  return inspectLinksByListingId;
}

export function currencyCodeFromSteamCurrencyId(currencyId) {
  const map = {
    1: "USD",
    2: "GBP",
    3: "EUR",
  };
  return map[currencyId] ?? "EUR";
}

export function formatSteamMoney(amountMinorUnits, currencyId = CURRENCY) {
  if (!Number.isFinite(amountMinorUnits)) return "N/A";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCodeFromSteamCurrencyId(currencyId),
  }).format(amountMinorUnits / 100);
}

export function extractPriceTextFromListingInfo(listing, currencyId = CURRENCY) {
  const convertedPrice = Number(listing?.converted_price);
  const convertedFee = Number(listing?.converted_fee);

  if (Number.isFinite(convertedPrice) && Number.isFinite(convertedFee)) {
    return formatSteamMoney(convertedPrice + convertedFee, currencyId);
  }

  const price = Number(listing?.price);
  const fee = Number(listing?.fee);

  if (Number.isFinite(price) && Number.isFinite(fee)) {
    return formatSteamMoney(price + fee, currencyId);
  }

  return "N/A";
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 */
export async function fetchRenderPageJson(url, headers) {
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${text.slice(0, 500)}`);
  }

  const data = await res.json();

  if (!data || typeof data !== "object") {
    throw new Error(`Unexpected JSON payload for ${url}`);
  }

  return data;
}

export { extractCentsFromListingInfo as extractCentsFromListing };
