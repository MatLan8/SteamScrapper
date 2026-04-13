/**
 * Shared URL builders and fetch helpers for Steam Community Market
 * price-collection scripts (sticker/charm JSON DB scrapers).
 */
import { APPID, CURRENCY, SEARCH_URL, USER_AGENT } from "../Config/constants.mjs";
import { formatDurationMs, sleep } from "../utils/general.mjs";

export const STEAM_PRICE_HISTORY_URL =
  "https://steamcommunity.com/market/pricehistory/";

export const STICKER_SEARCH_REFERER =
  "https://steamcommunity.com/market/search?appid=730";

export const CHARM_SEARCH_REFERER =
  "https://steamcommunity.com/market/search?appid=730&q=charm";

/** Default headers for market search JSON (sticker tool category). */
export function buildStickerToolSearchHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/javascript, */*; q=0.01",
    Referer: STICKER_SEARCH_REFERER,
  };
}

/** Default headers for charm keychain capsule search JSON. */
export function buildCharmSearchHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/javascript, */*; q=0.01",
    Referer: CHARM_SEARCH_REFERER,
  };
}

/**
 * Sticker tool search (tag_CSGO_Tool_Sticker), paginated.
 * Matches legacy `buildSearchUrl(start)` query shape.
 */
export function buildStickerToolSearchUrl(start, currency = CURRENCY) {
  const u = new URL(SEARCH_URL);

  u.searchParams.set("query", "");
  u.searchParams.set("start", String(start));
  u.searchParams.set("count", "10");
  u.searchParams.set("search_descriptions", "0");
  u.searchParams.set("sort_column", "name");
  u.searchParams.set("sort_dir", "desc");
  u.searchParams.set("appid", String(APPID));
  u.searchParams.set("norender", "1");
  u.searchParams.set("currency", String(currency));

  u.searchParams.append("category_730_ItemSet[]", "any");
  u.searchParams.append("category_730_ProPlayer[]", "any");
  u.searchParams.append("category_730_StickerCapsule[]", "any");
  u.searchParams.append("category_730_Tournament[]", "any");
  u.searchParams.append("category_730_TournamentTeam[]", "any");
  u.searchParams.append("category_730_Type[]", "tag_CSGO_Tool_Sticker");
  u.searchParams.append("category_730_Weapon[]", "any");

  return u.toString();
}

/**
 * Charm search with fixed keychain capsule filters (legacy behavior).
 */
export function buildCharmSearchUrl(start, currency = CURRENCY) {
  const params = new URLSearchParams({
    query: "charm",
    start: String(start),
    count: "10",
    search_descriptions: "0",
    sort_column: "name",
    sort_dir: "desc",
    appid: String(APPID),
    norender: "1",
    currency: String(currency),
  });

  params.append("category_730_ItemSet[]", "any");
  params.append("category_730_ProPlayer[]", "any");
  params.append("category_730_StickerCapsule[]", "any");
  params.append("category_730_Tournament[]", "any");
  params.append("category_730_TournamentTeam[]", "any");
  params.append("category_730_Type[]", "any");
  params.append("category_730_Weapon[]", "any");

  const capsules = [
    "tag_keychain_pack_kc_weapon_01_lootlist",
    "tag_keychain_pack_kc_missinglink_lootlist",
    "tag_keychain_pack_kc_drboom_lootlist",
    "tag_keychain_pack_kc_ml_community_01_lootlist",
    "tag_keychain_pack_kc_aus2025_lootlist",
    "tag_keychain_pack_kc_bud2025_lootlist",
  ];

  for (const c of capsules) {
    params.append("category_730_KeychainCapsule[]", c);
  }

  return `${SEARCH_URL}?${params.toString()}`;
}

export function buildPriceHistoryUrl(
  marketHashName,
  { appId = APPID, currency = CURRENCY } = {},
) {
  const u = new URL(STEAM_PRICE_HISTORY_URL);
  u.searchParams.set("appid", String(appId));
  u.searchParams.set("currency", String(currency));
  u.searchParams.set("market_hash_name", marketHashName);
  return u.toString();
}

/**
 * Fetch URL and parse JSON from body (legacy charm/sticker behavior: no `response.ok` gate).
 */
export async function fetchSteamJsonFromText(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Response was not JSON. HTTP ${res.status}. First 300 chars:\n${text.slice(0, 300)}`,
    );
  }
}

/**
 * Sticker scrapper: request counting, optional long sleep after N requests (price history).
 */
export function createStickerPriceCollectionFetch({
  steamCookie,
  sleepMode = false,
  requestThreshold = 80,
  thresholdSleepMs = 540000,
  sleepLogIntervalMs = 10000,
} = {}) {
  const stats = {
    requestCount: 0,
    firstRequestAt: null,
    lastRequestAt: null,
    currentRequests: 0,
  };

  async function sleepWithCountdown(totalMs) {
    let remaining = totalMs;

    console.log(
      `😴 Threshold reached. Sleeping for ${formatDurationMs(totalMs)}...`,
    );

    while (remaining > 0) {
      const chunk = Math.min(sleepLogIntervalMs, remaining);
      await sleep(chunk);
      remaining -= chunk;

      console.log(
        `⏳ Sleep remaining: ${formatDurationMs(remaining)} (${remaining} ms)`,
      );
    }

    console.log("✅ Sleep finished. Continuing requests.");
  }

  async function fetchJson(url, { useCookies = false } = {}) {
    const now = Date.now();

    if (!stats.firstRequestAt) {
      stats.firstRequestAt = now;
      console.log(`First request started at: ${new Date(now).toISOString()}`);
    }

    if (sleepMode && stats.currentRequests >= requestThreshold) {
      await sleepWithCountdown(thresholdSleepMs);
      stats.currentRequests = 0;
    }

    stats.lastRequestAt = now;
    stats.requestCount++;
    stats.currentRequests++;

    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: STICKER_SEARCH_REFERER,
    };

    if (useCookies) {
      if (!steamCookie) {
        throw new Error(
          "Price history request needs cookies, but steamCookie is empty.",
        );
      }
      headers.Cookie = steamCookie;
      headers.Referer = "https://steamcommunity.com/market/";
    }

    const res = await fetch(url, { headers });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Response was not JSON. HTTP ${res.status}. First 300 chars:\n${text.slice(0, 300)}`,
      );
    }

    return data;
  }

  function printStats(reason = "Run finished") {
    const end = stats.lastRequestAt ?? Date.now();

    console.log(`\n=== ${reason} ===`);
    console.log(`Requests made: ${stats.requestCount}`);

    if (stats.firstRequestAt) {
      const windowMs = end - stats.firstRequestAt;
      const rpm = windowMs > 0 ? stats.requestCount / (windowMs / 60000) : 0;

      console.log(
        `First request at: ${new Date(stats.firstRequestAt).toISOString()}`,
      );
      console.log(`Last request at:  ${new Date(end).toISOString()}`);
      console.log(
        `Time window:      ${formatDurationMs(windowMs)} (${windowMs} ms)`,
      );
      console.log(`Avg req/min:      ${rpm.toFixed(2)}`);
    } else {
      console.log("No requests were made.");
    }
  }

  return { fetchJson, printStats, stats };
}
