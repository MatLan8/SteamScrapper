#!/usr/bin/env node

/**
 * ============================================================
 * Steam Float Scraper - Multi Skin Weapon Scanner
 * ============================================================
 *
 * This script:
 * 1. Searches Steam market for all skins of one weapon + wear
 * 2. Filters out StatTrak and Souvenir results
 * 3. Splits skins between worker browser windows
 * 4. Opens each skin listing page in Steam market
 * 5. Reads inspect links directly from the listing DOM
 * 6. Decodes floats using @csfloat/cs2-inspect-serializer
 * 7. Saves results into an XLSX workbook
 * 8. Prints a summary in the terminal
 *
 * No browser extension is used.
 * No persistent browser profiles are used.
 *
 * ------------------------------------------------------------
 * REQUIRED ARGUMENTS
 * ------------------------------------------------------------
 *
 * --weapon
 * Weapon name exactly as it appears on Steam market.
 *
 * Examples:
 * --weapon "AWP"
 * --weapon "AK-47"
 * --weapon "Desert Eagle"
 *
 * --wear
 * Wear category to scan.
 * Allowed values:
 * - fn  = Factory New
 * - bs  = Battle-Scarred
 *
 * Examples:
 * --wear fn
 * --wear bs
 *
 * --mode
 * Which floats to prioritize in final results.
 * Allowed values:
 * - lowest
 * - highest
 *
 * Examples:
 * --mode lowest
 * --mode highest
 *
 * ------------------------------------------------------------
 * OPTIONAL ARGUMENTS
 * ------------------------------------------------------------
 *
 * --top
 * How many top float rows to keep per skin.
 * Default: 10
 *
 * --out
 * Output XLSX file path.
 * Default: steam_weapon_float_scan_results.xlsx
 *
 * --language
 * Steam market search language.
 * Default: english
 *
 * --cookie
 * Optional raw Steam cookie header.
 *
 *
 *  * --quality
 * Item quality to scan.
 * Allowed values:
 * - normal = regular skins
 * - st     = StatTrak
 * - sv     = Souvenir
 *
 * Examples:
 * --quality normal
 * --quality st
 * --quality sv
 *
 * Default:
 * normal
 *
 * --wait-ms
 * Delay between major page actions in milliseconds.
 * Default: 1500
 *
 * --max-skins
 * Limit how many matching skins are scanned.
 *
 * --max-listings-per-skin
 * Stop scanning a skin after this many decoded listings.
 *
 * --workers
 * Number of worker browser windows to run in parallel.
 * Default: 3
 *
 * --headful
 * Open visible browser windows.
 *
 * --headless
 * Run browsers hidden in background.
 *
 * --debug
 * Print extra debug logs.
 *
 * ------------------------------------------------------------
 * EXAMPLE USAGE
 * ------------------------------------------------------------
 *
 * node multi_scrapper.mjs ^
 *   --weapon "AWP" ^
 *   --wear bs ^
 *   --mode highest ^
 *   --top 20 ^
 *   --out results.xlsx ^
 *   --workers 3 ^
 *   --debug
 */

import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import { decodeLink } from "@csfloat/cs2-inspect-serializer";

const SEARCH_URL = "https://steamcommunity.com/market/search/render/";
const APPID = 730;
const PAGE_SIZE_SEARCH = 100;
const TARGET_PAGE_SIZE = 100;
const SKIP_LISTING_THRESHOLD = 1000;
const DEFAULT_TOP = 10;
const DEFAULT_OUT = "steam_weapon_float_scan_results.xlsx";
const DEFAULT_WAIT_MS = 1500;
const DEFAULT_WORKERS = 3;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const WEAR_MAP = {
  fn: {
    display: "Factory New",
    suffix: "(Factory New)",
    searchTag: "tag_WearCategory0",
  },
  bs: {
    display: "Battle-Scarred",
    suffix: "(Battle-Scarred)",
    searchTag: "tag_WearCategory4",
  },
};

function parseArgs(argv) {
  const args = {
    weapon: null,
    wear: null,
    mode: null,
    top: DEFAULT_TOP,
    out: DEFAULT_OUT,
    language: "english",
    cookie: null,
    waitMs: DEFAULT_WAIT_MS,
    headful: true,
    maxSkins: null,
    maxListingsPerSkin: null,
    workers: DEFAULT_WORKERS,
    debug: false,
    quality: "normal",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    switch (key) {
      case "--weapon":
        args.weapon = next;
        i += 1;
        break;
      case "--wear":
        args.wear = next?.toLowerCase();
        i += 1;
        break;
      case "--mode":
        args.mode = next?.toLowerCase();
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
      case "--language":
        args.language = next;
        i += 1;
        break;
      case "--cookie":
        args.cookie = next;
        i += 1;
        break;
      case "--wait-ms":
        args.waitMs = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--max-skins":
        args.maxSkins = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--max-listings-per-skin":
        args.maxListingsPerSkin = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--workers":
        args.workers = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--headful":
        args.headful = true;
        break;
      case "--headless":
        args.headful = false;
        break;
      case "--debug":
        args.debug = true;
        break;
      case "--quality":
        args.quality = next?.toLowerCase();
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.weapon) {
    throw new Error("Missing required argument: --weapon");
  }
  if (!["normal", "st", "sv"].includes(args.quality)) {
    throw new Error("--quality must be one of: normal, st, sv");
  }

  if (!args.wear || !(args.wear in WEAR_MAP)) {
    throw new Error("--wear must be either 'fn' or 'bs'");
  }

  if (!["lowest", "highest"].includes(args.mode)) {
    throw new Error("--mode must be either 'lowest' or 'highest'");
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

  if (
    args.maxSkins !== null &&
    (!Number.isInteger(args.maxSkins) || args.maxSkins <= 0)
  ) {
    throw new Error("--max-skins must be a positive integer");
  }

  if (
    args.maxListingsPerSkin !== null &&
    (!Number.isInteger(args.maxListingsPerSkin) || args.maxListingsPerSkin <= 0)
  ) {
    throw new Error("--max-listings-per-skin must be a positive integer");
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      `HTTP ${response.status} for ${target.toString()}\n${text.slice(0, 800)}`,
    );
  }

  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Expected JSON but got content-type "${contentType}" for ${target.toString()}\n${text.slice(0, 800)}`,
    );
  }

  return response.json();
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

function isWeaponSkinResult(result, wantedWeapon, wearConfig, quality) {
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

async function fetchAllSkinSearchResults(args, headers) {
  const wearConfig = WEAR_MAP[args.wear];
  const results = [];
  let start = 0;
  let totalCount = null;

  while (true) {
    const payload = await fetchJson(
      SEARCH_URL,
      {
        norender: 1,
        query: args.weapon,
        appid: APPID,
        start,
        count: PAGE_SIZE_SEARCH,
        l: args.language,
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
      isWeaponSkinResult(result, args.weapon, wearConfig, args.quality),
    );

    results.push(...filtered);

    if (args.debug) {
      console.log(
        `Search page start=${start}: received ${payload.results.length}, kept ${filtered.length}, total_count=${totalCount}`,
      );
    }

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

  const finalResults = Array.from(deduped.values()).sort((a, b) => {
    const an = String(a.hash_name ?? a.market_hash_name ?? "");
    const bn = String(b.hash_name ?? b.market_hash_name ?? "");
    return an.localeCompare(bn);
  });

  if (args.maxSkins && args.maxSkins > 0) {
    return finalResults.slice(0, args.maxSkins);
  }

  return finalResults;
}

function buildListingPageUrl(marketHashName) {
  return `https://steamcommunity.com/market/listings/${APPID}/${encodeURIComponent(marketHashName)}`;
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

function rankListings(listings, mode, top) {
  const sorted = [...listings].sort((a, b) => {
    if (mode === "lowest") {
      if (a.floatValue !== b.floatValue) return a.floatValue - b.floatValue;
      return a.priceCents - b.priceCents;
    }

    if (a.floatValue !== b.floatValue) return b.floatValue - a.floatValue;
    return a.priceCents - b.priceCents;
  });

  return sorted.slice(0, top);
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

async function waitForListingPageStable(page, args) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(args.waitMs);

  await page
    .locator(".market_listing_row[id^='listing_']")
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
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
  await page.evaluate(
    ({ size }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.m_cPageSize = size;
      g.GoToPage(0, true);
      return true;
    },
    { size },
  );

  await page.waitForTimeout(args.waitMs);

  await page
    .waitForFunction(
      ({ size }) => {
        const g = globalThis.g_oSearchResults;
        return !!g && Number(g.m_cPageSize) === size;
      },
      { size },
      { timeout: 10000 },
    )
    .catch(() => {});
}

async function goToResultPage(page, args, pageIndex) {
  const beforeFirstId = await getFirstVisibleListingId(page);

  await page.evaluate(
    ({ pageIndex }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.GoToPage(pageIndex, true);
      return true;
    },
    { pageIndex },
  );

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
    return false;
  }

  await page.waitForTimeout(args.waitMs);
  return true;
}

async function extractListingsFromCurrentPage(
  page,
  args,
  seenIds,
  workerLabel,
) {
  await page.waitForTimeout(800);

  const listingRows = page.locator(".market_listing_row[id^='listing_']");
  const totalRows = await listingRows.count();
  const meta = await getSearchResultsMeta(page);

  if (args.debug) {
    console.log(
      `${workerLabel}    page=${meta.currentPage + 1} pageSize=${meta.pageSize} visible listing rows=${totalRows}`,
    );
  }

  const results = [];

  for (let i = 0; i < totalRows; i += 1) {
    if (args.maxListingsPerSkin && seenIds.size >= args.maxListingsPerSkin) {
      break;
    }

    const row = listingRows.nth(i);
    const idAttr = await row.getAttribute("id");
    const listingId = idAttr?.replace(/^listing_/, "") ?? `row_${i}`;

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
      if (args.debug) {
        console.log(
          `${workerLabel}    decode failed for listingId=${listingId}: ${error?.message || String(error)}`,
        );
      }
      continue;
    }

    const floatValue = Number(decoded?.paintwear);
    if (!Number.isFinite(floatValue)) continue;

    results.push({
      listingId,
      priceText,
      priceCents: extractCentsFromPriceText(priceText),
      floatValue,
      inspectLink,
    });

    if (args.debug && results.length <= 3) {
      console.log(
        `${workerLabel}    sample row ${results.length}: listingId=${listingId} price="${priceText}" float=${floatValue}`,
      );
    }
  }

  return results;
}

async function scanSkinPage(page, marketHashName, args, workerLabel) {
  if (args.debug) {
    console.log(`${workerLabel}  Scanning skin: ${marketHashName}`);
  }

  const url = buildListingPageUrl(marketHashName);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForListingPageStable(page, args);
  await forcePageSize(page, args, TARGET_PAGE_SIZE);

  const meta = await getSearchResultsMeta(page);

  if (args.debug) {
    console.log(
      `${workerLabel}    after page-size apply: totalCount=${meta.totalCount} pageSize=${meta.pageSize} currentPage=${meta.currentPage}`,
    );
  }

  if (meta.totalCount > SKIP_LISTING_THRESHOLD) {
    return {
      marketHashName,
      skinName: extractSkinNameParts(marketHashName).skinName,
      listingCount: 0,
      decodedCount: 0,
      failedDecodeCount: 0,
      missingInspectCount: 0,
      topResults: [],
      cheapestListing: null,
      skipped: true,
      skippedReason: `Skipped because listing count ${meta.totalCount} is greater than ${SKIP_LISTING_THRESHOLD}`,
      totalCount: meta.totalCount,
    };
  }

  const effectivePageSize = meta.pageSize > 0 ? meta.pageSize : 10;
  const totalPages =
    meta.totalCount > 0 ? Math.ceil(meta.totalCount / effectivePageSize) : 1;

  const listings = [];
  const seenIds = new Set();
  let missingInspectCount = 0;
  let failedDecodeCount = 0;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (args.maxListingsPerSkin && seenIds.size >= args.maxListingsPerSkin) {
      break;
    }

    if (pageIndex > 0) {
      if (args.debug) {
        console.log(`${workerLabel}    going to page index ${pageIndex}`);
      }

      const moved = await goToResultPage(page, args, pageIndex);
      if (!moved) {
        if (args.debug) {
          console.log(
            `${workerLabel}    failed to move to page index ${pageIndex}, stopping this skin`,
          );
        }
        break;
      }
    }

    const beforeCount = listings.length;
    const beforeSeen = seenIds.size;

    const currentPageResults = await extractListingsFromCurrentPage(
      page,
      args,
      seenIds,
      workerLabel,
    );

    listings.push(...currentPageResults);

    const addedThisPage = listings.length - beforeCount;
    const seenThisPage = seenIds.size - beforeSeen;

    if (seenThisPage > addedThisPage) {
      const dropped = seenThisPage - addedThisPage;
      // These are rows that were seen but not kept.
      // They are a mix of missing inspect links and decode failures.
      // We do not separate them precisely without adding more instrumentation.
      missingInspectCount += dropped;
    }

    if (args.debug) {
      console.log(
        `${workerLabel}    collected so far: ${seenIds.size} listings after page index ${pageIndex}`,
      );
    }

    if (currentPageResults.length === 0) {
      if (args.debug) {
        console.log(
          `${workerLabel}    no new listings found on page index ${pageIndex}, stopping this skin`,
        );
      }
      break;
    }
  }

  const { skinName } = extractSkinNameParts(marketHashName);
  const topResults = rankListings(listings, args.mode, args.top);
  const cheapestListing = listings.length > 0 ? listings[0] : null;

  return {
    marketHashName,
    skinName,
    listingCount: listings.length,
    decodedCount: listings.length,
    failedDecodeCount,
    missingInspectCount,
    topResults,
    cheapestListing,
    skipped: false,
    totalCount: meta.totalCount,
  };
}

function splitSkinsForWorkers(skins, workerCount) {
  const buckets = Array.from({ length: workerCount }, () => []);

  skins.forEach((skin, index) => {
    buckets[index % workerCount].push({
      ...skin,
      originalIndex: index,
      totalCount: skins.length,
      displayIndex: index + 1,
    });
  });

  return buckets;
}

async function workerRun(workerIndex, assignedSkins, args) {
  const workerLabel = `[W${workerIndex + 1}]`;
  const { browser, context } = await setupBrowserContext(args);
  const page = await context.newPage();
  const results = [];
  const skippedSkins = [];

  try {
    for (const skin of assignedSkins) {
      const marketHashName = String(
        skin.hash_name ?? skin.market_hash_name ?? "",
      );

      console.log(
        `${workerLabel} [${skin.displayIndex}/${skin.totalCount}] ${marketHashName}`,
      );

      try {
        const scannedSkin = await scanSkinPage(
          page,
          marketHashName,
          args,
          workerLabel,
        );

        results.push({
          originalIndex: skin.originalIndex,
          result: scannedSkin,
        });

        if (scannedSkin.skipped) {
          skippedSkins.push({
            originalIndex: skin.originalIndex,
            marketHashName,
            totalCount: scannedSkin.totalCount,
            reason: scannedSkin.skippedReason,
          });

          console.log(
            `${workerLabel}   skipped: ${marketHashName} (${scannedSkin.totalCount} listings)`,
          );
        } else {
          console.log(
            `${workerLabel}   total listings collected: ${scannedSkin.listingCount}, kept: ${scannedSkin.topResults.length}`,
          );
        }
      } catch (error) {
        console.log(
          `${workerLabel}   Failed skin: ${error?.message || String(error)}`,
        );

        results.push({
          originalIndex: skin.originalIndex,
          result: {
            marketHashName,
            skinName: extractSkinNameParts(marketHashName).skinName,
            listingCount: 0,
            decodedCount: 0,
            failedDecodeCount: 0,
            missingInspectCount: 0,
            topResults: [],
            cheapestListing: null,
            skipped: false,
            error: error?.message || String(error),
          },
        });
      }

      await sleep(args.waitMs);
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return { results, skippedSkins };
}

function safeSheetName(name, usedNames) {
  let clean = name.replace(/[\\/*?:[\]]/g, " ").trim();
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

async function writeWorkbook(resultsInOriginalOrder, args) {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set();

  for (const skin of resultsInOriginalOrder) {
    const sheetName = safeSheetName(skin.marketHashName, usedNames);
    const ws = workbook.addWorksheet(sheetName);

    ws.columns = [
      { header: "Skin", key: "skin", width: 42 },
      { header: "Price", key: "price", width: 40 },
      { header: "Float", key: "float", width: 18 },
    ];

    const rows = [...skin.topResults].sort((a, b) =>
      args.mode === "highest"
        ? b.floatValue - a.floatValue
        : a.floatValue - b.floatValue,
    );

    if (skin.skipped) {
      ws.addRow({
        skin: skin.marketHashName,
        price: skin.skippedReason,
        float: "",
      });
    } else if (rows.length === 0) {
      ws.addRow({
        skin: skin.marketHashName,
        price: skin.error ? `ERROR: ${skin.error}` : "No results",
        float: "",
      });
    } else {
      for (const row of rows) {
        ws.addRow({
          skin: skin.marketHashName,
          price: row.priceText,
          float: row.floatValue,
        });
      }

      ws.addRow({ skin: "", price: "", float: "" });

      if (skin.cheapestListing) {
        ws.addRow({
          skin: "Cheapest listing",
          price: skin.cheapestListing.priceText,
          float: skin.cheapestListing.floatValue,
        });
      }
    }

    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.getColumn("float").numFmt = "0.00000000000000";
  }

  await workbook.xlsx.writeFile(path.resolve(args.out));
}

async function main() {
  const args = parseArgs(process.argv);
  const searchHeaders = buildSearchHeaders(args.cookie);
  const wearConfig = WEAR_MAP[args.wear];

  const qualityLabel =
    args.quality === "normal"
      ? "Normal"
      : args.quality === "st"
        ? "StatTrak"
        : "Souvenir";

  console.log(
    `Searching Steam market for ${qualityLabel} ${args.weapon} ${wearConfig.display} skins...`,
  );

  const skinResults = await fetchAllSkinSearchResults(args, searchHeaders);
  console.log(`Found ${skinResults.length} matching skins.`);

  const workerBuckets = splitSkinsForWorkers(skinResults, args.workers);

  workerBuckets.forEach((bucket, idx) => {
    console.log(`Worker ${idx + 1} assigned ${bucket.length} skins.`);
  });

  const workerOutputs = await Promise.all(
    workerBuckets.map((bucket, idx) => workerRun(idx, bucket, args)),
  );

  const flattened = workerOutputs.flatMap((worker) => worker.results);
  flattened.sort((a, b) => a.originalIndex - b.originalIndex);

  const allSkippedSkins = workerOutputs
    .flatMap((worker) => worker.skippedSkins)
    .sort((a, b) => a.originalIndex - b.originalIndex);

  const resultsInOriginalOrder = flattened.map((entry) => entry.result);

  await writeWorkbook(resultsInOriginalOrder, args);

  console.log("\nDone.");
  console.log(`Saved XLSX: ${path.resolve(args.out)}`);

  console.log("\nSummary");
  console.log("=======");

  for (const skin of resultsInOriginalOrder) {
    if (skin.skipped) {
      console.log(
        `${skin.marketHashName}: skipped (${skin.totalCount} listings > ${SKIP_LISTING_THRESHOLD})`,
      );
      continue;
    }

    const best = skin.topResults?.[0];
    if (!best) {
      console.log(`${skin.marketHashName}: no float rows found`);
      continue;
    }

    console.log(
      `${skin.marketHashName}: ${best.floatValue.toFixed(14)} at ${best.priceText}`,
    );
  }

  console.log("\nSkipped skins");
  console.log("=============");

  if (allSkippedSkins.length === 0) {
    console.log("None");
  } else {
    for (const skipped of allSkippedSkins) {
      console.log(`${skipped.marketHashName}: ${skipped.totalCount} listings`);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:");
  console.error(error?.stack || String(error));
  process.exit(1);
});
