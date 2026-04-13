import {
  APPID,
  CURRENCY,
  DEFAULT_LANGUAGE,
  SEARCH_PAGE_SIZE,
  SEARCH_URL,
  USER_AGENT,
  WEAR_MAP,
} from "../Config/constants.mjs";
import {
  centsFromPossibleSteamValue,
  eurosFromUsdCents,
  extractCentsFromPriceText,
} from "../utils/price-utils.mjs";
import { debugLog, sleep } from "../utils/general.mjs";

export function parseCookieHeader(rawCookie) {
  if (!rawCookie) return [];

  return rawCookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) return null;

      return {
        name: part.slice(0, eqIndex).trim(),
        value: part.slice(eqIndex + 1).trim(),
        domain: ".steamcommunity.com",
        path: "/",
      };
    })
    .filter(Boolean);
}

export function buildSearchHeaders(cookie) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://steamcommunity.com/market/",
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

export async function fetchJson(url, params, headers) {
  const target = new URL(url);

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        target.searchParams.append(key, entry);
      }
    } else if (value !== undefined && value !== null) {
      target.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(target, { headers });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} for ${target.toString()}\n${text.slice(0, 500)}`,
    );
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Expected JSON but got "${contentType}" for ${target.toString()}\n${text.slice(0, 500)}`,
    );
  }

  return response.json();
}

export function buildListingPageUrl(marketHashName) {
  return `https://steamcommunity.com/market/listings/${APPID}/${encodeURIComponent(marketHashName)}`;
}

export function extractSkinNameParts(marketHashName) {
  const separator = marketHashName.indexOf(" | ");
  if (separator === -1) {
    return { weaponName: marketHashName, skinName: marketHashName };
  }

  const weaponName = marketHashName.slice(0, separator).trim();
  const rest = marketHashName.slice(separator + 3).trim();
  const wearMatch = rest.match(/^(.*) \(([^)]+)\)$/);

  if (!wearMatch) {
    return { weaponName, skinName: rest };
  }

  return {
    weaponName,
    skinName: wearMatch[1].trim(),
    wearName: wearMatch[2].trim(),
  };
}

export function isMatchingQuality(marketHashName, requestedQuality) {
  const hasStatTrak = marketHashName.startsWith("StatTrak™ ");
  const hasSouvenir = marketHashName.startsWith("Souvenir ");

  if (hasSouvenir) return false;

  if (requestedQuality === "normal") {
    return !hasStatTrak;
  }

  if (requestedQuality === "st") {
    return hasStatTrak;
  }

  if (requestedQuality === "both") {
    return true;
  }

  return false;
}

export function isMatchingWeaponSkin(result, weapon, conditionSet, quality) {
  const marketHashName = String(
    result.hash_name ?? result.market_hash_name ?? "",
  );

  if (!marketHashName.includes(" | ")) return false;
  if (!isMatchingQuality(marketHashName, quality)) return false;

  const parts = extractSkinNameParts(marketHashName);
  let normalizedWeaponName = parts.weaponName;

  if (normalizedWeaponName.startsWith("StatTrak™ ")) {
    normalizedWeaponName = normalizedWeaponName.replace(/^StatTrak™\s+/, "");
  }

  if (normalizedWeaponName.startsWith("Souvenir ")) {
    normalizedWeaponName = normalizedWeaponName.replace(/^Souvenir\s+/, "");
  }

  if (normalizedWeaponName !== weapon) return false;

  const conditionMatches = Array.from(conditionSet).some((condition) =>
    marketHashName.endsWith(WEAR_MAP[condition].suffix),
  );

  return conditionMatches;
}

export function getBasePriceCentsFromSearchResult(result) {
  const numericCandidates = [
    result.sell_price,
    result.sale_price,
    result.sell_price_min,
  ];

  for (const candidate of numericCandidates) {
    const cents = centsFromPossibleSteamValue(candidate);
    if (cents > 0) return cents;
  }

  const textCandidates = [
    result.sell_price_text,
    result.sale_price_text,
    result.sell_price_min_text,
  ];

  for (const candidate of textCandidates) {
    const cents = extractCentsFromPriceText(candidate);
    if (cents > 0) return cents;
  }

  return 0;
}

function defaultStickerSearchMapResult(result) {
  const marketHashName = String(
    result.hash_name ?? result.market_hash_name ?? "",
  );
  const basePriceCents = getBasePriceCentsFromSearchResult(result);

  return {
    marketHashName,
    listingUrl: buildListingPageUrl(marketHashName),
    basePriceCents,
    basePriceEuro: eurosFromUsdCents(basePriceCents),
  };
}

/**
 * Float multi search: single wear (fn|bs) and quality normal|st|sv (Souvenir).
 */
export function isWeaponSkinFloatSearchMatch(
  result,
  wantedWeapon,
  wearConfig,
  quality,
) {
  const marketHashName = String(
    result.hash_name ?? result.market_hash_name ?? "",
  );

  if (!marketHashName.includes(" | ")) return false;
  if (!marketHashName.endsWith(wearConfig.suffix)) return false;

  const parts = extractSkinNameParts(marketHashName);

  let normalizedWeaponName = parts.weaponName;

  const hasStatTrak = normalizedWeaponName.startsWith("StatTrak™ ");
  const hasSouvenir = normalizedWeaponName.startsWith("Souvenir ");

  if (quality === "normal") {
    if (hasStatTrak || hasSouvenir) return false;
  } else if (quality === "st") {
    if (!hasStatTrak || hasSouvenir) return false;
    normalizedWeaponName = normalizedWeaponName.replace(/^StatTrak™\s+/, "");
  } else if (quality === "sv") {
    if (!hasSouvenir || hasStatTrak) return false;
    normalizedWeaponName = normalizedWeaponName.replace(/^Souvenir\s+/, "");
  }

  return normalizedWeaponName === wantedWeapon;
}

/**
 * Paginates market search for one weapon + one exterior tag + language (float scrapper).
 */
export async function fetchFloatWeaponSkinSearchResults(args, headers) {
  const wearConfig = WEAR_MAP[args.wear];
  const results = [];
  let start = 0;
  let totalCount = null;
  const language = args.language ?? DEFAULT_LANGUAGE;

  while (true) {
    const payload = await fetchJson(
      SEARCH_URL,
      {
        norender: 1,
        query: args.weapon,
        appid: APPID,
        start,
        count: SEARCH_PAGE_SIZE,
        currency: CURRENCY,
        l: language,
        "category_730_Exterior[]": wearConfig.searchTag,
      },
      headers,
    );

    if (!payload || !Array.isArray(payload.results)) {
      throw new Error(
        "Unexpected market search payload: missing results array",
      );
    }

    if (totalCount === null) {
      totalCount = Number(payload.total_count ?? 0);
    }

    const filtered = payload.results.filter((result) =>
      isWeaponSkinFloatSearchMatch(
        result,
        args.weapon,
        wearConfig,
        args.quality,
      ),
    );

    results.push(...filtered);

    debugLog(
      args,
      `Float search start=${start}: received ${payload.results.length}, kept ${filtered.length}, total_count=${totalCount}`,
    );

    start += Number(payload.pagesize ?? payload.results.length ?? 0);

    if (payload.results.length === 0 || start >= totalCount) {
      break;
    }

    await sleep(args.waitMs);
  }

  const deduped = new Map();

  for (const result of results) {
    const hashName = String(result.hash_name ?? result.market_hash_name ?? "");
    if (!deduped.has(hashName)) {
      deduped.set(hashName, result);
    }
  }

  let finalResults = Array.from(deduped.values()).sort((a, b) => {
    const an = String(a.hash_name ?? a.market_hash_name ?? "");
    const bn = String(b.hash_name ?? b.market_hash_name ?? "");
    return an.localeCompare(bn);
  });

  if (args.maxSkins && args.maxSkins > 0) {
    finalResults = finalResults.slice(0, args.maxSkins);
  }

  return finalResults;
}

/**
 * Optional `options.mapResult(result, args)` to replace default sticker row mapping.
 * @param {object} args
 * @param {HeadersInit} headers
 * @param {{ mapResult?: (result: object, args: object) => object | null }} [options]
 */
export async function fetchAllSkinSearchResults(args, headers, options = {}) {
  const mapResult =
    typeof options.mapResult === "function"
      ? options.mapResult
      : defaultStickerSearchMapResult;

  const results = [];
  let start = 0;
  let totalCount = null;
  const conditionTags = args.conditions.map(
    (condition) => WEAR_MAP[condition].searchTag,
  );
  const conditionSet = new Set(args.conditions);

  while (true) {
    const payload = await fetchJson(
      SEARCH_URL,
      {
        norender: 1,
        query: args.weapon,
        appid: APPID,
        start,
        count: SEARCH_PAGE_SIZE,
        currency: CURRENCY,
        search_descriptions: 0,
        "category_730_Exterior[]": conditionTags,
        ...(args.language ? { l: args.language } : {}),
      },
      headers,
    );

    if (!payload || !Array.isArray(payload.results)) {
      throw new Error(
        "Unexpected market search payload: missing results array",
      );
    }

    if (totalCount === null) {
      totalCount = Number(payload.total_count ?? 0);
    }

    const filtered = [];

    for (const result of payload.results) {
      if (
        !isMatchingWeaponSkin(result, args.weapon, conditionSet, args.quality)
      ) {
        continue;
      }
      const mapped = mapResult(result, args);
      if (mapped) filtered.push(mapped);
    }

    results.push(...filtered);

    debugLog(
      args,
      `Search start=${start}: received ${payload.results.length}, kept ${filtered.length}, total_count=${totalCount}`,
    );

    start += Number(payload.pagesize ?? payload.results.length ?? 0);

    if (payload.results.length === 0 || start >= totalCount) {
      break;
    }

    await sleep(args.waitMs);
  }

  const deduped = new Map();

  for (const result of results) {
    if (!deduped.has(result.marketHashName)) {
      deduped.set(result.marketHashName, result);
    }
  }

  let finalResults = Array.from(deduped.values()).sort((a, b) =>
    a.marketHashName.localeCompare(b.marketHashName),
  );

  if (args.maxPrice !== null) {
    finalResults = finalResults.filter(
      (result) =>
        result.basePriceEuro > 0 && result.basePriceEuro <= args.maxPrice,
    );
  }

  return finalResults;
}
