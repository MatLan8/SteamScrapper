/**
 * Extracts the market_hash_name segment from a Steam Community Market listing URL.
 * Path: /market/listings/730/{encodedName...}
 */
export function extractMarketHashNameFromUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/");
  const encodedName = parts.slice(4).join("/");
  return decodeURIComponent(encodedName);
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateSteamListingUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, message: "--url must be a valid URL" };
  }

  if (
    parsedUrl.hostname !== "steamcommunity.com" ||
    !parsedUrl.pathname.startsWith("/market/listings/")
  ) {
    return {
      ok: false,
      message:
        "--url must be a Steam market listing URL like https://steamcommunity.com/market/listings/730/...",
    };
  }

  return { ok: true };
}
