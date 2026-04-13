#!/usr/bin/env node

/**
 * ============================================================
 * Steam Sticker + Charm Scraper (Playwright)
 * ============================================================
 *
 * Scans Steam market listings for one weapon, selected wears,
 * enters each matching skin listing page with ?filter=sticker,
 * decodes inspect links, values attached stickers + charms,
 * computes edge / efficiency, and outputs top deals.
 *
 * Required packages:
 *   npm install playwright exceljs @csfloat/cs2-inspect-serializer
 *
 * Example:
 *   node sticker_charm_scraper_playwright.mjs ^
 *     --weapon "AK-47" ^
 *     --condition fn mw ft ^
 *     --quality both ^
 *     --maxprice 25 ^
 *     --top 50 ^
 *     --workers 3 ^
 *     --efficiency ^
 *     --debug
 */

import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import { decodeLink } from "@csfloat/cs2-inspect-serializer";

// ============================================================
// CONFIG
// ============================================================

const SEARCH_URL = "https://steamcommunity.com/market/search/render/";
const APPID = 730;
const CURRENCY = 3; // requested, but Steam appears to still return USD in practice
const USD_TO_EUR_RATE = 0.87;
const SEARCH_PAGE_SIZE = 100;
const TARGET_PAGE_SIZE = 100;
const SKIP_LISTING_THRESHOLD = 1000;

const DEFAULT_TOP = 25;
const DEFAULT_OUT = "steam_sticker_charm_scan_results.xlsx";
const DEFAULT_WAIT_MS = 1200;
const DEFAULT_WORKERS = 3;
const DEFAULT_QUALITY = "normal";

// Universal sticker weight used in attached_value formula.
const UNIVERSAL_STICKER_WEIGHT = 0.1;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STICKER_DB_PATH = path.resolve(__dirname, "../Database/sticker_db.json");
const CHARM_DB_PATH = path.resolve(
  __dirname,
  "../../Charms/Database/charm_db.json",
);

const WEAR_MAP = {
  fn: {
    display: "Factory New",
    suffix: "(Factory New)",
    searchTag: "tag_WearCategory0",
  },
  mw: {
    display: "Minimal Wear",
    suffix: "(Minimal Wear)",
    searchTag: "tag_WearCategory1",
  },
  ft: {
    display: "Field-Tested",
    suffix: "(Field-Tested)",
    searchTag: "tag_WearCategory2",
  },
  ww: {
    display: "Well-Worn",
    suffix: "(Well-Worn)",
    searchTag: "tag_WearCategory3",
  },
  bs: {
    display: "Battle-Scarred",
    suffix: "(Battle-Scarred)",
    searchTag: "tag_WearCategory4",
  },
};

const QUALITY_VALUES = new Set(["normal", "st", "both"]);

// ============================================================
// ARGUMENTS
// ============================================================

function parseArgs(argv) {
  const args = {
    weapon: null,
    conditions: Object.keys(WEAR_MAP),
    quality: DEFAULT_QUALITY,
    maxPrice: null,
    top: DEFAULT_TOP,
    out: DEFAULT_OUT,
    workers: DEFAULT_WORKERS,
    sortBy: "efficiency",
    debug: false,
    waitMs: DEFAULT_WAIT_MS,
    cookie: null,
    headful: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    switch (key) {
      case "--weapon":
        args.weapon = next;
        i += 1;
        break;

      case "--condition": {
        const values = [];
        let j = i + 1;

        while (j < argv.length && !argv[j].startsWith("--")) {
          values.push(String(argv[j]).toLowerCase());
          j += 1;
        }

        if (values.length === 0) {
          throw new Error(
            "--condition requires one or more values: fn mw ft ww bs",
          );
        }

        args.conditions = values;
        i = j - 1;
        break;
      }

      case "--quality":
        args.quality = String(next).toLowerCase();
        i += 1;
        break;

      case "--maxprice":
        args.maxPrice = Number.parseFloat(next);
        i += 1;
        break;

      case "--top":
        args.top = Number.parseInt(next, 10);
        i += 1;
        break;

      case "--out":
        args.out = next;
        i += 1;
        break;

      case "--workers":
        args.workers = Number.parseInt(next, 10);
        i += 1;
        break;

      case "--edge":
        args.sortBy = "edge";
        break;

      case "--efficiency":
        args.sortBy = "efficiency";
        break;

      case "--debug":
        args.debug = true;
        break;

      case "--wait-ms":
        args.waitMs = Number.parseInt(next, 10);
        i += 1;
        break;

      case "--cookie":
        args.cookie = next;
        i += 1;
        break;

      case "--headful":
        args.headful = true;
        break;

      case "--headless":
        args.headful = false;
        break;

      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.weapon) {
    throw new Error("Missing required argument: --weapon");
  }

  for (const condition of args.conditions) {
    if (!(condition in WEAR_MAP)) {
      throw new Error(
        `Invalid --condition value "${condition}". Allowed: fn mw ft ww bs`,
      );
    }
  }

  if (!QUALITY_VALUES.has(args.quality)) {
    throw new Error(
      `Invalid --quality value "${args.quality}". Allowed: normal st both`,
    );
  }

  args.conditions = [...new Set(args.conditions)];

  if (
    args.maxPrice !== null &&
    (!Number.isFinite(args.maxPrice) || args.maxPrice < 0)
  ) {
    throw new Error("--maxprice must be a non-negative number");
  }

  if (!Number.isInteger(args.top) || args.top <= 0) {
    throw new Error("--top must be a positive integer");
  }

  if (!Number.isInteger(args.workers) || args.workers <= 0) {
    throw new Error("--workers must be a positive integer");
  }

  if (!Number.isInteger(args.waitMs) || args.waitMs < 0) {
    throw new Error("--wait-ms must be a non-negative integer");
  }

  return args;
}

// ============================================================
// GENERIC HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugLog(args, ...parts) {
  if (args.debug) {
    console.log(...parts);
  }
}

function eurosFromUsdCents(cents) {
  return (cents / 100) * USD_TO_EUR_RATE;
}

function centsFromPossibleSteamValue(value) {
  if (Number.isInteger(value)) return value;
  return 0;
}

function extractCentsFromPriceText(priceText) {
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

function formatEuro(value) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2);
}

function formatEfficiencyDisplay(value) {
  if (value === Number.POSITIVE_INFINITY) return "INF";
  if (!Number.isFinite(value)) return "";
  return value.toFixed(4);
}

function parseCookieHeader(rawCookie) {
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

function buildSearchHeaders(cookie) {
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

async function fetchJson(url, params, headers) {
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

function buildListingPageUrl(marketHashName) {
  return `https://steamcommunity.com/market/listings/${APPID}/${encodeURIComponent(marketHashName)}`;
}

function extractSkinNameParts(marketHashName) {
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

function isMatchingQuality(marketHashName, requestedQuality) {
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

function isMatchingWeaponSkin(result, weapon, conditionSet, quality) {
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

function splitItemsForWorkers(items, workerCount) {
  const buckets = Array.from({ length: workerCount }, () => []);

  items.forEach((item, index) => {
    buckets[index % workerCount].push({
      ...item,
      originalIndex: index,
      totalCount: items.length,
      displayIndex: index + 1,
    });
  });

  return buckets;
}

function createMissingTracker() {
  return {
    stickers: new Set(),
    charms: new Set(),
    highlightReels: new Set(),
  };
}

function addRemainingSkinsAsFailed(
  assignedSkins,
  startIndex,
  reason,
  failedSkins,
) {
  for (let i = startIndex; i < assignedSkins.length; i += 1) {
    failedSkins.push({
      marketHashName: assignedSkins[i].marketHashName,
      error: reason,
    });
  }
}

function isRateLimitText(text) {
  const value = String(text ?? "").toLowerCase();
  return (
    value.includes("too many requests") ||
    value.includes("error code: 429") ||
    value.includes("429") ||
    value.includes("rate limit")
  );
}

function isRateLimitError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("too many requests") ||
    text.includes("error code: 429") ||
    text.includes("429") ||
    text.includes("rate limit")
  );
}

// ============================================================
// DATABASE HELPERS
// ============================================================

function normalizeNumberPrice(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function hasRarePattern(ranges, pattern) {
  if (!Array.isArray(ranges) || !Number.isInteger(pattern)) {
    return false;
  }

  let left = 0;
  let right = ranges.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const range = ranges[mid];

    if (!range || typeof range !== "object") {
      return false;
    }

    const start = Number(range.start);
    const end = Number(range.end);

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return false;
    }

    if (pattern < start) {
      right = mid - 1;
    } else if (pattern > end) {
      left = mid + 1;
    } else {
      return true;
    }
  }

  return false;
}

async function loadStickerDb() {
  const raw = await fs.readFile(STICKER_DB_PATH, "utf8");
  const data = JSON.parse(raw);

  const stickerMap = new Map();

  for (const [id, value] of Object.entries(data)) {
    stickerMap.set(String(id), {
      id: String(id),
      stickerName: String(value.stickerName ?? `Unknown Sticker ${id}`),
      price: Number(value.price ?? 0),
      source: value.source ?? "",
    });
  }

  return { stickerMap };
}

async function loadCharmDb() {
  const raw = await fs.readFile(CHARM_DB_PATH, "utf8");
  const data = JSON.parse(raw);

  const charmMap = new Map();
  const highlightReelMap = new Map();

  for (const [id, value] of Object.entries(data.charms ?? {})) {
    charmMap.set(String(id), {
      id: String(id),
      charmName: String(value.charmName ?? `Unknown Charm ${id}`),
      price: Number(value.price ?? 0),
      source: value.source ?? "",
      rarePatterns: Array.isArray(value.rarePatterns) ? value.rarePatterns : [],
    });
  }

  for (const [id, value] of Object.entries(data.highlight_reels ?? {})) {
    highlightReelMap.set(String(id), {
      id: String(id),
      charmName: String(value.charmName ?? `Unknown Highlight Reel ${id}`),
      price: Number(value.price ?? 0),
      source: value.source ?? "",
    });
  }

  return { charmMap, highlightReelMap };
}

// ============================================================
// GLOBAL MARKET SEARCH
// ============================================================

function getBasePriceCentsFromSearchResult(result) {
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

async function fetchAllSkinSearchResults(args, headers) {
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

    const filtered = payload.results
      .filter((result) =>
        isMatchingWeaponSkin(result, args.weapon, conditionSet, args.quality),
      )
      .map((result) => {
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
      });

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

// ============================================================
// PLAYWRIGHT HELPERS
// ============================================================

async function setupBrowserContext(args) {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: !args.headful,
  });

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
  });

  const cookies = parseCookieHeader(args.cookie);
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  return { browser, context };
}

async function detectRateLimitOnPage(page) {
  try {
    const bodyText = await page.locator("body").innerText({ timeout: 3000 });
    return isRateLimitText(bodyText);
  } catch {
    return false;
  }
}

async function assertPageNotRateLimited(page, contextLabel = "") {
  const rateLimited = await detectRateLimitOnPage(page);
  if (rateLimited) {
    throw new Error(
      `${contextLabel ? `${contextLabel}: ` : ""}Steam page hit rate limit / 429`,
    );
  }
}

async function waitForListingPageStable(page, args) {
  await page.waitForLoadState("domcontentloaded");
  await assertPageNotRateLimited(page, "After DOMContentLoaded");

  await page.waitForTimeout(args.waitMs);
  await assertPageNotRateLimited(page, "After initial wait");

  try {
    await page
      .locator(".market_listing_row[id^='listing_']")
      .first()
      .waitFor({ timeout: 15000 });
  } catch {
    await assertPageNotRateLimited(page, "Waiting for first listing row");
  }
}

async function getSearchResultsMeta(page) {
  return page.evaluate(() => {
    const g = globalThis.g_oSearchResults;

    return {
      hasSearchResults: !!g,
      pageSize: Number(g?.m_cPageSize ?? 0),
      totalCount: Number(g?.m_cTotalCount ?? 0),
      currentPage: Number(g?.m_iCurrentPage ?? 0),
    };
  });
}

async function getFirstVisibleListingId(page) {
  const row = page.locator(".market_listing_row[id^='listing_']").first();
  return (await row.getAttribute("id").catch(() => null)) || "";
}

async function forcePageSize(page, args, size = TARGET_PAGE_SIZE) {
  await assertPageNotRateLimited(page, "Before forcing page size");

  const success = await page.evaluate(
    ({ size }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.m_cPageSize = size;
      g.GoToPage(0, true);
      return true;
    },
    { size },
  );

  if (!success) {
    await assertPageNotRateLimited(
      page,
      "Force page size missing search results",
    );
    throw new Error(
      "Steam page search results object missing while forcing page size",
    );
  }

  await page.waitForTimeout(args.waitMs);
  await assertPageNotRateLimited(page, "After forcing page size");

  const sized = await page
    .waitForFunction(
      ({ size }) => {
        const g = globalThis.g_oSearchResults;
        return !!g && Number(g.m_cPageSize) === size;
      },
      { size },
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!sized) {
    await assertPageNotRateLimited(page, "Waiting for page size update");
    throw new Error(`Failed to set page size to ${size}`);
  }
}

async function goToResultPage(page, args, pageIndex) {
  await assertPageNotRateLimited(
    page,
    `Before switching to page ${pageIndex + 1}`,
  );

  const beforeFirstId = await getFirstVisibleListingId(page);

  const invoked = await page.evaluate(
    ({ pageIndex }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.GoToPage(pageIndex, true);
      return true;
    },
    { pageIndex },
  );

  if (!invoked) {
    await assertPageNotRateLimited(
      page,
      `Switch page ${pageIndex + 1} missing search results`,
    );
    throw new Error(
      `Unable to switch to page ${pageIndex + 1}: g_oSearchResults missing`,
    );
  }

  const success = await page
    .waitForFunction(
      ({ beforeFirstId, pageIndex }) => {
        const g = globalThis.g_oSearchResults;
        const first = document.querySelector(
          ".market_listing_row[id^='listing_']",
        );
        const currentId = first?.id || "";
        const currentPage = Number(g?.m_iCurrentPage ?? -1);

        if (pageIndex === 0) {
          return currentPage === 0 && !!currentId;
        }

        return (
          currentPage === pageIndex &&
          !!currentId &&
          currentId !== beforeFirstId
        );
      },
      { beforeFirstId, pageIndex },
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!success) {
    await assertPageNotRateLimited(page, `Switching to page ${pageIndex + 1}`);
    throw new Error(`Timed out switching to result page ${pageIndex + 1}`);
  }

  await page.waitForTimeout(args.waitMs);
  await assertPageNotRateLimited(
    page,
    `After switching to page ${pageIndex + 1}`,
  );

  return true;
}

// ============================================================
// STICKER + CHARM VALUATION
// ============================================================

function valueStickers(decoded, stickerMap, missingTracker, args) {
  const stickers = Array.isArray(decoded?.stickers) ? decoded.stickers : [];
  let total = 0;
  const stickerNames = [];
  const stickerIds = [];

  for (const sticker of stickers) {
    const stickerId = String(sticker?.stickerId ?? "");
    if (!stickerId) continue;

    stickerIds.push(stickerId);

    const record = stickerMap.get(stickerId);
    if (!record) {
      missingTracker.stickers.add(stickerId);
      debugLog(args, `Sticker ID not found in DB: ${stickerId}`);
      stickerNames.push(`Unknown Sticker ${stickerId}`);
      continue;
    }

    total += Number(record.price ?? 0);
    stickerNames.push(record.stickerName);
  }

  return {
    stickersRawValue: total,
    stickerNames,
    stickerIds,
  };
}

function valueKeychains(
  decoded,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
  args,
) {
  const keychains = Array.isArray(decoded?.keychains) ? decoded.keychains : [];
  let charmsValue = 0;
  let hasRareCharmPattern = false;
  const charmDescriptions = [];

  for (const keychain of keychains) {
    const charmId = String(keychain?.stickerId ?? "");

    if (!charmId) continue;

    // Sticker Slab
    if (charmId === "37") {
      const wrappedStickerId = String(keychain?.wrappedSticker ?? "");
      const stickerRecord = stickerMap.get(wrappedStickerId);

      if (stickerRecord) {
        charmsValue += Number(stickerRecord.price ?? 0);
        charmDescriptions.push(`Sticker Slab | ${stickerRecord.stickerName}`);
      } else {
        if (wrappedStickerId) {
          missingTracker.stickers.add(wrappedStickerId);
        }
        debugLog(args, `Wrapped sticker not found in DB: ${wrappedStickerId}`);
        charmDescriptions.push(
          `Sticker Slab | Unknown Sticker ${wrappedStickerId}`,
        );
      }

      continue;
    }

    // Souvenir Austin Highlight Reel
    if (charmId === "36") {
      const highlightReelId = String(keychain?.highlightReel ?? "");
      const reelRecord = highlightReelMap.get(highlightReelId);

      if (reelRecord) {
        charmsValue += Number(reelRecord.price ?? 0);
        charmDescriptions.push(reelRecord.charmName);
      } else {
        if (highlightReelId) {
          missingTracker.highlightReels.add(highlightReelId);
        }
        debugLog(args, `Highlight reel not found in DB: ${highlightReelId}`);
        charmDescriptions.push(`Unknown Highlight Reel ${highlightReelId}`);
      }

      continue;
    }

    // Souvenir Budapest Highlight Reel
    if (charmId === "83") {
      const highlightReelId = String(keychain?.highlightReel ?? "");
      const reelRecord = highlightReelMap.get(highlightReelId);

      if (reelRecord) {
        charmsValue += Number(reelRecord.price ?? 0);
        charmDescriptions.push(reelRecord.charmName);
      } else {
        if (highlightReelId) {
          missingTracker.highlightReels.add(highlightReelId);
        }
        debugLog(args, `Highlight reel not found in DB: ${highlightReelId}`);
        charmDescriptions.push(`Unknown Highlight Reel ${highlightReelId}`);
      }

      continue;
    }

    // Normal charm
    const charmRecord = charmMap.get(charmId);

    if (!charmRecord) {
      missingTracker.charms.add(charmId);
      debugLog(args, `Charm ID not found in DB: ${charmId}`);
      charmDescriptions.push(`Unknown Charm ${charmId}`);
      continue;
    }

    charmsValue += Number(charmRecord.price ?? 0);
    charmDescriptions.push(charmRecord.charmName);

    const pattern = Number(keychain?.pattern);
    if (
      Number.isInteger(pattern) &&
      hasRarePattern(charmRecord.rarePatterns, pattern)
    ) {
      hasRareCharmPattern = true;
    }
  }

  return {
    charmsValue,
    hasRareCharmPattern,
    charmDescriptions,
  };
}

function computeScores(
  basePriceEuro,
  listingPriceEuro,
  stickersRawValue,
  charmsValue,
) {
  const premiumPaid = listingPriceEuro - basePriceEuro;
  const attachedValue =
    stickersRawValue * UNIVERSAL_STICKER_WEIGHT + charmsValue;
  const edge = attachedValue - premiumPaid;

  let efficiency;

  if (premiumPaid <= 0) {
    efficiency = attachedValue > 0 ? Number.POSITIVE_INFINITY : 0;
  } else {
    efficiency = attachedValue / premiumPaid;
  }

  return {
    premiumPaid,
    attachedValue,
    edge,
    efficiency,
  };
}

// ============================================================
// LISTING EXTRACTION
// ============================================================

async function extractListingsFromCurrentPage(
  page,
  skinInfo,
  args,
  seenIds,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
  workerLabel,
  pageNumber,
) {
  await page.waitForTimeout(700);
  await assertPageNotRateLimited(page, `${workerLabel} page ${pageNumber}`);

  const listingRows = page.locator(".market_listing_row[id^='listing_']");
  const totalRows = await listingRows.count();

  debugLog(
    args,
    `${workerLabel}    page=${pageNumber} visible listing rows=${totalRows}`,
  );

  const results = [];
  let shouldStopByPrice = false;

  for (let i = 0; i < totalRows; i += 1) {
    const row = listingRows.nth(i);
    const idAttr = await row.getAttribute("id");
    const listingId =
      idAttr?.replace(/^listing_/, "") ?? `row_${pageNumber}_${i}`;

    if (seenIds.has(listingId)) continue;
    seenIds.add(listingId);

    let priceText = "";
    const priceLocators = [
      row.locator(".market_listing_price.market_listing_price_with_fee"),
      row.locator(".market_listing_their_price .market_table_value span"),
      row.locator(".market_listing_price"),
    ];

    for (const locator of priceLocators) {
      if (await locator.count()) {
        priceText = (await locator.first().innerText()).trim();
        if (priceText) break;
      }
    }

    const listingPriceCents = extractCentsFromPriceText(priceText);
    const listingPriceEuro = eurosFromUsdCents(listingPriceCents);

    if (
      args.maxPrice !== null &&
      listingPriceEuro > 0 &&
      listingPriceEuro > args.maxPrice
    ) {
      shouldStopByPrice = true;
      break;
    }

    const inspectLink = await row
      .locator('.market_listing_row_action a[href^="steam://"]')
      .first()
      .getAttribute("href")
      .catch(() => null);

    if (!inspectLink) continue;

    let decoded;
    try {
      decoded = decodeLink(inspectLink);
    } catch (error) {
      debugLog(
        args,
        `${workerLabel}    decode failed for listingId=${listingId}: ${
          error?.message || String(error)
        }`,
      );
      continue;
    }

    const stickerValueData = valueStickers(
      decoded,
      stickerMap,
      missingTracker,
      args,
    );

    const charmValueData = valueKeychains(
      decoded,
      stickerMap,
      charmMap,
      highlightReelMap,
      missingTracker,
      args,
    );

    const hasAnyAttachments =
      stickerValueData.stickerNames.length > 0 ||
      charmValueData.charmDescriptions.length > 0;

    if (!hasAnyAttachments) {
      continue;
    }

    const scoreData = computeScores(
      skinInfo.basePriceEuro,
      listingPriceEuro,
      stickerValueData.stickersRawValue,
      charmValueData.charmsValue,
    );

    results.push({
      skinName: skinInfo.marketHashName,
      pageFound: pageNumber,
      listingId,
      basePrice: skinInfo.basePriceEuro,
      listingPrice: listingPriceEuro,
      stickersRawValue: stickerValueData.stickersRawValue,
      charmsValue: charmValueData.charmsValue,
      hasRareCharmPattern: charmValueData.hasRareCharmPattern,
      premiumPaid: scoreData.premiumPaid,
      attachedValue: scoreData.attachedValue,
      edge: scoreData.edge,
      efficiency: scoreData.efficiency,
      stickerNames: stickerValueData.stickerNames.join(" ; "),
      charmNames: charmValueData.charmDescriptions.join(" ; "),
      inspectLink,
    });
  }

  return {
    results,
    shouldStopByPrice,
  };
}

// ============================================================
// SKIN SCAN
// ============================================================

async function scanSkinPage(
  page,
  skinInfo,
  args,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
  workerLabel,
) {
  debugLog(args, `${workerLabel}  Scanning skin: ${skinInfo.marketHashName}`);

  const filteredUrl = `${skinInfo.listingUrl}?filter=sticker`;

  await page.goto(filteredUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await waitForListingPageStable(page, args);
  await forcePageSize(page, args, TARGET_PAGE_SIZE);

  const meta = await getSearchResultsMeta(page);

  if (!meta.hasSearchResults) {
    await assertPageNotRateLimited(
      page,
      `${workerLabel} no search results object`,
    );
    throw new Error(
      `${workerLabel} Steam listing page missing g_oSearchResults for ${skinInfo.marketHashName}`,
    );
  }

  debugLog(
    args,
    `${workerLabel}    filtered totalCount=${meta.totalCount} pageSize=${meta.pageSize} currentPage=${meta.currentPage}`,
  );

  if (meta.totalCount > SKIP_LISTING_THRESHOLD) {
    return {
      marketHashName: skinInfo.marketHashName,
      scannedListings: [],
      skipped: true,
      skippedReason: `Filtered listing count ${meta.totalCount} exceeded threshold ${SKIP_LISTING_THRESHOLD}`,
      totalCount: meta.totalCount,
    };
  }

  const effectivePageSize = meta.pageSize > 0 ? meta.pageSize : 10;
  const totalPages =
    meta.totalCount > 0 ? Math.ceil(meta.totalCount / effectivePageSize) : 1;

  const seenIds = new Set();
  const scannedListings = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) {
      await goToResultPage(page, args, pageIndex);
    }

    const { results, shouldStopByPrice } = await extractListingsFromCurrentPage(
      page,
      skinInfo,
      args,
      seenIds,
      stickerMap,
      charmMap,
      highlightReelMap,
      missingTracker,
      workerLabel,
      pageIndex + 1,
    );

    scannedListings.push(...results);

    if (shouldStopByPrice) {
      debugLog(
        args,
        `${workerLabel}    stopping ${skinInfo.marketHashName} because listing price exceeded maxprice`,
      );
      break;
    }

    if (results.length === 0) {
      debugLog(
        args,
        `${workerLabel}    no useful listings on page ${pageIndex + 1}, stopping skin`,
      );
      break;
    }
  }

  return {
    marketHashName: skinInfo.marketHashName,
    scannedListings,
    skipped: false,
    totalCount: meta.totalCount,
  };
}

// ============================================================
// WORKER RUN
// ============================================================

async function workerRun(
  workerIndex,
  assignedSkins,
  args,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
) {
  const workerLabel = `[W${workerIndex + 1}]`;
  const processedSkins = [];
  const skippedSkins = [];
  const workerListings = [];
  const failedSkins = [];

  let browser = null;
  let context = null;
  let page = null;

  async function safeCloseAll() {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    page = null;
    context = null;
    browser = null;
  }

  async function createFreshPage() {
    if (!context) {
      throw new Error("Cannot create fresh page: browser context is missing");
    }

    await page?.close().catch(() => {});
    page = await context.newPage();
  }

  try {
    const setup = await setupBrowserContext(args);
    browser = setup.browser;
    context = setup.context;
    page = await context.newPage();

    for (let skinIndex = 0; skinIndex < assignedSkins.length; skinIndex += 1) {
      const skin = assignedSkins[skinIndex];

      console.log(
        `${workerLabel} [${skin.displayIndex}/${skin.totalCount}] ${skin.marketHashName}`,
      );

      try {
        const scanned = await scanSkinPage(
          page,
          skin,
          args,
          stickerMap,
          charmMap,
          highlightReelMap,
          missingTracker,
          workerLabel,
        );

        processedSkins.push(skin.marketHashName);

        if (scanned.skipped) {
          skippedSkins.push({
            marketHashName: skin.marketHashName,
            totalCount: scanned.totalCount,
            reason: scanned.skippedReason,
          });

          console.log(
            `${workerLabel}   skipped by threshold: ${skin.marketHashName} (${scanned.totalCount})`,
          );
        } else {
          workerListings.push(...scanned.scannedListings);

          console.log(
            `${workerLabel}   scanned listings kept: ${scanned.scannedListings.length}`,
          );
        }
      } catch (error) {
        const errorMessage = error?.message || String(error);

        console.log(
          `${workerLabel}   failed skin: ${skin.marketHashName} | ${errorMessage}`,
        );

        failedSkins.push({
          marketHashName: skin.marketHashName,
          error: errorMessage,
        });

        if (isRateLimitError(error)) {
          console.log(
            `${workerLabel}   fatal rate limit detected, closing worker and marking remaining queue as failed`,
          );

          addRemainingSkinsAsFailed(
            assignedSkins,
            skinIndex + 1,
            `Worker aborted after rate limit on ${skin.marketHashName}`,
            failedSkins,
          );

          await safeCloseAll();
          return {
            processedSkins,
            skippedSkins,
            failedSkins,
            listings: workerListings,
          };
        }

        // Try to recover and continue with next skin
        try {
          await createFreshPage();
        } catch (recoveryError) {
          const recoveryMessage =
            recoveryError?.message || String(recoveryError);

          failedSkins.push({
            marketHashName: "[WORKER_RECOVERY]",
            error: recoveryMessage,
          });

          addRemainingSkinsAsFailed(
            assignedSkins,
            skinIndex + 1,
            `Worker aborted after recovery failure on ${skin.marketHashName}: ${recoveryMessage}`,
            failedSkins,
          );

          await safeCloseAll();
          return {
            processedSkins,
            skippedSkins,
            failedSkins,
            listings: workerListings,
          };
        }
      }

      await sleep(args.waitMs);
    }
  } catch (error) {
    const fatalMessage = error?.message || String(error);

    failedSkins.push({
      marketHashName: "[WORKER_FATAL]",
      error: fatalMessage,
    });

    addRemainingSkinsAsFailed(
      assignedSkins,
      0,
      `Worker fatal setup/runtime error: ${fatalMessage}`,
      failedSkins,
    );
  } finally {
    await safeCloseAll();
  }

  return {
    processedSkins,
    skippedSkins,
    failedSkins,
    listings: workerListings,
  };
}

// ============================================================
// SORTING + OUTPUT
// ============================================================

function sortListings(listings, sortBy) {
  return [...listings].sort((a, b) => {
    if (sortBy === "edge") {
      if (b.edge !== a.edge) return b.edge - a.edge;

      const aEff =
        a.efficiency === Number.POSITIVE_INFINITY
          ? Number.MAX_SAFE_INTEGER
          : a.efficiency;
      const bEff =
        b.efficiency === Number.POSITIVE_INFINITY
          ? Number.MAX_SAFE_INTEGER
          : b.efficiency;
      if (bEff !== aEff) return bEff - aEff;

      return a.listingPrice - b.listingPrice;
    }

    const aEff =
      a.efficiency === Number.POSITIVE_INFINITY
        ? Number.MAX_SAFE_INTEGER
        : a.efficiency;
    const bEff =
      b.efficiency === Number.POSITIVE_INFINITY
        ? Number.MAX_SAFE_INTEGER
        : b.efficiency;

    if (bEff !== aEff) return bEff - aEff;
    if (b.edge !== a.edge) return b.edge - a.edge;

    return a.listingPrice - b.listingPrice;
  });
}

function safeSheetName(name, usedNames) {
  let clean = String(name)
    .replace(/[\\/*?:[\]]/g, " ")
    .trim();
  if (!clean) clean = "Sheet";
  clean = clean.slice(0, 31);

  let finalName = clean;
  let counter = 2;

  while (usedNames.has(finalName)) {
    const suffix = ` ${counter}`;
    finalName = clean.slice(0, 31 - suffix.length) + suffix;
    counter += 1;
  }

  usedNames.add(finalName);
  return finalName;
}

function sortedNumericStrings(values) {
  return [...values].sort((a, b) => Number(a) - Number(b));
}

async function writeWorkbook({
  outputPath,
  topResults,
  processedSkins,
  skippedSkins,
  failedSkins,
  allCollectedCount,
  sortBy,
  args,
  missingTracker,
}) {
  const workbook = new ExcelJS.Workbook();

  const resultsWs = workbook.addWorksheet("Results");
  resultsWs.columns = [
    { header: "Skin Name", key: "skinName", width: 42 },
    { header: "Page Found", key: "pageFound", width: 12 },
    { header: "Base Price EUR", key: "basePrice", width: 14 },
    { header: "Listing Price EUR", key: "listingPrice", width: 16 },
    { header: "Stickers Raw Value", key: "stickersRawValue", width: 18 },
    { header: "Charms Value", key: "charmsValue", width: 14 },
    { header: "Rare Charm Pattern", key: "hasRareCharmPattern", width: 18 },
    { header: "Premium Paid", key: "premiumPaid", width: 14 },
    { header: "Attached Value", key: "attachedValue", width: 14 },
    { header: "Edge", key: "edge", width: 12 },
    { header: "Efficiency", key: "efficiency", width: 14 },
    { header: "Sticker Names", key: "stickerNames", width: 60 },
    { header: "Charm Names", key: "charmNames", width: 60 },
    { header: "Listing ID", key: "listingId", width: 20 },
    { header: "Inspect Link", key: "inspectLink", width: 90 },
  ];

  for (const row of topResults) {
    resultsWs.addRow({
      skinName: row.skinName,
      pageFound: row.pageFound,
      basePrice: row.basePrice,
      listingPrice: row.listingPrice,
      stickersRawValue: row.stickersRawValue,
      charmsValue: row.charmsValue,
      hasRareCharmPattern: row.hasRareCharmPattern,
      premiumPaid: row.premiumPaid,
      attachedValue: row.attachedValue,
      edge: row.edge,
      efficiency:
        row.efficiency === Number.POSITIVE_INFINITY ? "INF" : row.efficiency,
      stickerNames: row.stickerNames,
      charmNames: row.charmNames,
      listingId: row.listingId,
      inspectLink: row.inspectLink,
    });
  }

  resultsWs.getRow(1).font = { bold: true };
  resultsWs.views = [{ state: "frozen", ySplit: 1 }];

  for (const key of [
    "basePrice",
    "listingPrice",
    "stickersRawValue",
    "charmsValue",
    "premiumPaid",
    "attachedValue",
    "edge",
  ]) {
    resultsWs.getColumn(key).numFmt = "0.00";
  }

  const processedWs = workbook.addWorksheet("Processed Skins");
  processedWs.columns = [
    { header: "Market Hash Name", key: "marketHashName", width: 60 },
  ];
  for (const skinName of processedSkins) {
    processedWs.addRow({ marketHashName: skinName });
  }
  processedWs.getRow(1).font = { bold: true };

  const skippedWs = workbook.addWorksheet("Skipped Threshold");
  skippedWs.columns = [
    { header: "Market Hash Name", key: "marketHashName", width: 60 },
    { header: "Filtered Listing Count", key: "totalCount", width: 20 },
    { header: "Reason", key: "reason", width: 70 },
  ];
  for (const skipped of skippedSkins) {
    skippedWs.addRow(skipped);
  }
  skippedWs.getRow(1).font = { bold: true };

  const failedWs = workbook.addWorksheet("Failed Skins");
  failedWs.columns = [
    { header: "Market Hash Name", key: "marketHashName", width: 60 },
    { header: "Error", key: "error", width: 100 },
  ];
  for (const failed of failedSkins) {
    failedWs.addRow(failed);
  }
  failedWs.getRow(1).font = { bold: true };

  const missingStickerWs = workbook.addWorksheet("Missing Stickers");
  missingStickerWs.columns = [{ header: "Sticker ID", key: "id", width: 20 }];
  for (const id of sortedNumericStrings(missingTracker.stickers)) {
    missingStickerWs.addRow({ id });
  }
  missingStickerWs.getRow(1).font = { bold: true };

  const missingCharmWs = workbook.addWorksheet("Missing Charms");
  missingCharmWs.columns = [{ header: "Charm ID", key: "id", width: 20 }];
  for (const id of sortedNumericStrings(missingTracker.charms)) {
    missingCharmWs.addRow({ id });
  }
  missingCharmWs.getRow(1).font = { bold: true };

  const missingReelsWs = workbook.addWorksheet("Missing Highlight Reels");
  missingReelsWs.columns = [
    { header: "Highlight Reel ID", key: "id", width: 20 },
  ];
  for (const id of sortedNumericStrings(missingTracker.highlightReels)) {
    missingReelsWs.addRow({ id });
  }
  missingReelsWs.getRow(1).font = { bold: true };

  const summaryWs = workbook.addWorksheet("Summary");
  summaryWs.columns = [
    { header: "Key", key: "key", width: 30 },
    { header: "Value", key: "value", width: 40 },
  ];
  summaryWs.addRows([
    { key: "Total collected listings", value: allCollectedCount },
    { key: "Top exported", value: topResults.length },
    { key: "Sorted by", value: sortBy },
    { key: "Sticker weight", value: UNIVERSAL_STICKER_WEIGHT },
    { key: "USD->EUR rate", value: USD_TO_EUR_RATE },
    { key: "Quality filter", value: args.quality },
    { key: "Missing sticker IDs", value: missingTracker.stickers.size },
    { key: "Missing charm IDs", value: missingTracker.charms.size },
    {
      key: "Missing highlight reel IDs",
      value: missingTracker.highlightReels.size,
    },
  ]);
  summaryWs.getRow(1).font = { bold: true };

  await workbook.xlsx.writeFile(path.resolve(outputPath));
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  const args = parseArgs(process.argv);
  const searchHeaders = buildSearchHeaders(args.cookie);
  const missingTracker = createMissingTracker();

  console.log(
    `Loading databases...\nStickers: ${STICKER_DB_PATH}\nCharms:   ${CHARM_DB_PATH}`,
  );

  const [{ stickerMap }, { charmMap, highlightReelMap }] = await Promise.all([
    loadStickerDb(),
    loadCharmDb(),
  ]);

  console.log(
    `Loaded DB entries: ${stickerMap.size} stickers | ${charmMap.size} charms | ${highlightReelMap.size} highlight reels`,
  );

  console.log(
    `Searching Steam market for ${args.weapon} | conditions: ${args.conditions.join(", ")} | quality: ${args.quality}`,
  );

  const skinResults = await fetchAllSkinSearchResults(args, searchHeaders);

  console.log(
    `Found ${skinResults.length} matching skins after base-price filtering.`,
  );

  const workerBuckets = splitItemsForWorkers(skinResults, args.workers);

  workerBuckets.forEach((bucket, idx) => {
    console.log(`Worker ${idx + 1} assigned ${bucket.length} skins.`);
  });

  const workerOutputs = await Promise.all(
    workerBuckets.map((bucket, idx) =>
      workerRun(
        idx,
        bucket,
        args,
        stickerMap,
        charmMap,
        highlightReelMap,
        missingTracker,
      ),
    ),
  );

  const processedSkins = workerOutputs.flatMap(
    (worker) => worker.processedSkins,
  );
  const skippedSkins = workerOutputs.flatMap((worker) => worker.skippedSkins);
  const failedSkins = workerOutputs.flatMap((worker) => worker.failedSkins);
  const allListings = workerOutputs.flatMap((worker) => worker.listings);

  const sortedListings = sortListings(allListings, args.sortBy);
  const topResults = sortedListings.slice(0, args.top);

  console.log("\nSkipped by threshold");
  console.log("====================");
  if (skippedSkins.length === 0) {
    console.log("None");
  } else {
    for (const skipped of skippedSkins) {
      console.log(
        `${skipped.marketHashName} | ${skipped.totalCount} | ${skipped.reason}`,
      );
    }
  }

  console.log("\nFailed skins");
  console.log("============");
  if (failedSkins.length === 0) {
    console.log("None");
  } else {
    for (const failed of failedSkins) {
      console.log(`${failed.marketHashName} | ${failed.error}`);
    }
  }

  console.log("\nMissing sticker IDs");
  console.log("===================");
  if (missingTracker.stickers.size === 0) {
    console.log("None");
  } else {
    console.log(sortedNumericStrings(missingTracker.stickers).join(", "));
  }

  console.log("\nMissing charm IDs");
  console.log("=================");
  if (missingTracker.charms.size === 0) {
    console.log("None");
  } else {
    console.log(sortedNumericStrings(missingTracker.charms).join(", "));
  }

  console.log("\nMissing highlight reel IDs");
  console.log("==========================");
  if (missingTracker.highlightReels.size === 0) {
    console.log("None");
  } else {
    console.log(sortedNumericStrings(missingTracker.highlightReels).join(", "));
  }

  await writeWorkbook({
    outputPath: args.out,
    topResults,
    processedSkins,
    skippedSkins,
    failedSkins,
    allCollectedCount: allListings.length,
    sortBy: args.sortBy,
    args,
    missingTracker,
  });

  console.log(`\nDone.`);
  console.log(`Collected listings: ${allListings.length}`);
  console.log(`Top exported: ${topResults.length}`);
  console.log(`Saved XLSX: ${path.resolve(args.out)}`);
}

main().catch(async (error) => {
  console.error("Fatal error:");
  console.error(error?.stack || String(error));
  process.exit(1);
});
