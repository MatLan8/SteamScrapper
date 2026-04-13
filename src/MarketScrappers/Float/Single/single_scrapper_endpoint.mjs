#!/usr/bin/env node

/**
 * ============================================================
 * Steam Float Scraper - Single Listing URL Endpoint Scanner
 * ============================================================
 *
 * This script:
 * 1. Calls the Steam market render endpoint once to get total listing count
 * 2. Splits the listing range into chunks based on worker count
 * 3. Uses async workers to fetch listing chunks from the endpoint
 * 4. Extracts inspect links from results_html
 * 5. Decodes floats using @csfloat/cs2-inspect-serializer
 * 6. Prints top lowest/highest floats
 *
 * No browser windows are used.
 * No Playwright is used.
 *
 * ------------------------------------------------------------
 * REQUIRED ARGUMENTS
 * ------------------------------------------------------------
 *
 * --url
 * Direct Steam market listing URL
 *
 * Example:
 * --url "https://steamcommunity.com/market/listings/730/AWP%20%7C%20Safari%20Mesh%20%28Battle-Scarred%29"
 *
 * ------------------------------------------------------------
 * OPTIONAL ARGUMENTS
 * ------------------------------------------------------------
 *
 * --max-windows
 * Worker count.
 * Kept under old argument name for compatibility.
 * Default: 10
 *
 * --mode
 * lowest | highest
 * Default: lowest
 *
 * --top
 * How many best results to print
 * Default: 10
 *
 * --wait-ms
 * Cooldown for a single worker between its requests.
 * Also used to calculate worker stagger interval.
 * Default: 1500
 *
 * Example:
 * --wait-ms 2000 --max-windows 4
 * => each worker has 2000ms cooldown
 * => workers start staggered by 2000 / 4 = 500ms
 *
 * --cookie
 * Optional raw Steam cookie header
 *
 * --headful
 * Ignored, kept only for compatibility
 *
 * --headless
 * Ignored, kept only for compatibility
 *
 * --debug
 * Extra logs
 */

// node single_scrapper_endpoint.mjs --url "https://steamcommunity.com/market/listings/730/AWP%20%7C%20Safari%20Mesh%20%28Battle-Scarred%29" --mode lowest --top 30 --wait-ms 2000 --max-windows 4 --debug

import process from "node:process";
import fetch from "node-fetch";
import { decodeLink } from "@csfloat/cs2-inspect-serializer";

const PAGE_SIZE = 100;
const DEFAULT_TOP = 10;
const DEFAULT_WAIT_MS = 1500;
const DEFAULT_MAX_WINDOWS = 10;
const DEFAULT_CURRENCY = 3;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const args = {
    url: null,
    maxWindows: DEFAULT_MAX_WINDOWS,
    mode: "lowest",
    top: DEFAULT_TOP,
    waitMs: DEFAULT_WAIT_MS,
    cookie: null,
    headful: false,
    debug: false,
    currency: DEFAULT_CURRENCY,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    switch (key) {
      case "--url":
        args.url = next;
        i += 1;
        break;
      case "--max-windows":
        args.maxWindows = Number.parseInt(next, 10);
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
      case "--debug":
        args.debug = true;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.url) {
    throw new Error("Missing required argument: --url");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(args.url);
  } catch {
    throw new Error("--url must be a valid URL");
  }

  if (
    parsedUrl.hostname !== "steamcommunity.com" ||
    !parsedUrl.pathname.startsWith("/market/listings/")
  ) {
    throw new Error(
      "--url must be a Steam market listing URL like https://steamcommunity.com/market/listings/730/...",
    );
  }

  if (!Number.isInteger(args.maxWindows) || args.maxWindows <= 0) {
    throw new Error("--max-windows must be a positive integer");
  }

  if (!["lowest", "highest"].includes(args.mode)) {
    throw new Error("--mode must be either 'lowest' or 'highest'");
  }

  if (!Number.isInteger(args.top) || args.top <= 0) {
    throw new Error("--top must be a positive integer");
  }

  if (!Number.isInteger(args.waitMs) || args.waitMs < 0) {
    throw new Error("--wait-ms must be a non-negative integer");
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMarketHashNameFromUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/");
  const encodedName = parts.slice(4).join("/");
  return decodeURIComponent(encodedName);
}

function buildRenderUrl(
  marketHashName,
  start,
  count,
  currency = DEFAULT_CURRENCY,
) {
  const encodedName = encodeURIComponent(marketHashName);
  return `https://steamcommunity.com/market/listings/730/${encodedName}/render?currency=${currency}&start=${start}&count=${count}`;
}

function buildFetchHeaders(args, refererUrl) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    Referer: refererUrl,
  };

  if (args.cookie) {
    headers.Cookie = args.cookie;
  }

  return headers;
}

function decodeHtmlEntities(text) {
  return String(text ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractInspectLinksFromResultsHtml(resultsHtml) {
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

function currencyCodeFromSteamCurrencyId(currencyId) {
  const map = {
    1: "USD",
    2: "GBP",
    3: "EUR",
  };
  return map[currencyId] ?? "EUR";
}

function formatSteamMoney(amountMinorUnits, currencyId = DEFAULT_CURRENCY) {
  if (!Number.isFinite(amountMinorUnits)) return "N/A";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCodeFromSteamCurrencyId(currencyId),
  }).format(amountMinorUnits / 100);
}

function extractPriceText(listing, currencyId = DEFAULT_CURRENCY) {
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

function extractCentsFromListing(listing) {
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

function buildWorkerPlan(totalListings, workerCount) {
  const totalRequests = Math.ceil(totalListings / PAGE_SIZE);
  const actualWorkerCount = Math.min(workerCount, Math.max(1, totalRequests));
  const requestsPerWorker = Math.ceil(totalRequests / actualWorkerCount);
  const workers = [];

  for (let workerIndex = 0; workerIndex < actualWorkerCount; workerIndex += 1) {
    const requestIndexStart = workerIndex * requestsPerWorker;
    if (requestIndexStart >= totalRequests) break;

    const requestIndexEnd = Math.min(
      totalRequests - 1,
      requestIndexStart + requestsPerWorker - 1,
    );

    const requestStart = requestIndexStart * PAGE_SIZE;
    const requestEnd = requestIndexEnd * PAGE_SIZE;

    workers.push({
      workerIndex,
      requestIndexStart,
      requestIndexEnd,
      requestStart,
      requestEnd,
      assignedRequests: requestIndexEnd - requestIndexStart + 1,
    });
  }

  return {
    totalListings,
    totalRequests,
    workerCount: workers.length,
    requestsPerWorker,
    workers,
  };
}

async function fetchRenderPage(args, marketHashName, start, count = PAGE_SIZE) {
  const url = buildRenderUrl(marketHashName, start, count, args.currency);
  const headers = buildFetchHeaders(args, args.url);

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} for start=${start}\n${text.slice(0, 500)}`,
    );
  }

  const data = await res.json();

  if (!data || typeof data !== "object") {
    throw new Error(`Unexpected payload for start=${start}`);
  }

  return data;
}

function extractListingsFromRenderPayload(data, args, start, workerLabel) {
  const listinginfo = data.listinginfo ?? {};
  const listingIds = Object.keys(listinginfo);
  const inspectLinksByListingId = extractInspectLinksFromResultsHtml(
    data.results_html,
  );

  const results = [];
  const stats = {
    returnedListings: listingIds.length,
    missingInspectLink: 0,
    decodeFailed: 0,
    missingFloat: 0,
    collected: 0,
  };

  for (const listingId of listingIds) {
    const listing = listinginfo[listingId];
    const inspectLink = inspectLinksByListingId.get(listingId) ?? null;

    if (!inspectLink) {
      stats.missingInspectLink += 1;
      continue;
    }

    let decoded;
    try {
      decoded = decodeLink(inspectLink);
    } catch (error) {
      if (args.debug) {
        console.log(
          `${workerLabel}: decode failed for listingId=${listingId} start=${start}: ${error?.message || String(error)}`,
        );
      }
      stats.decodeFailed += 1;
      continue;
    }

    const floatValue = Number(decoded?.paintwear);

    if (!Number.isFinite(floatValue)) {
      stats.missingFloat += 1;
      continue;
    }

    results.push({
      listingId,
      inspectLink,
      priceText: extractPriceText(listing, args.currency),
      priceCents: extractCentsFromListing(listing),
      floatValue,
      start,
    });

    stats.collected += 1;
  }

  return { results, stats };
}

async function workerRun(args, marketHashName, plan, requestSpacingMs) {
  const workerLabel = `Worker ${plan.workerIndex + 1}`;
  const collected = [];

  console.log(
    `${workerLabel}: requestIndexes ${plan.requestIndexStart}-${plan.requestIndexEnd} | starts ${plan.requestStart}-${plan.requestEnd} | assigned requests=${plan.assignedRequests}`,
  );

  const initialDelay = Math.floor(plan.workerIndex * requestSpacingMs);
  if (initialDelay > 0) {
    if (args.debug) {
      console.log(`${workerLabel}: initial stagger ${initialDelay}ms`);
    }
    await sleep(initialDelay);
  }

  for (
    let start = plan.requestStart;
    start <= plan.requestEnd;
    start += PAGE_SIZE
  ) {
    const startedAt = Date.now();

    let data;
    try {
      data = await fetchRenderPage(args, marketHashName, start, PAGE_SIZE);
    } catch (error) {
      console.log(
        `${workerLabel}: failed request start=${start}: ${error?.message || String(error)}`,
      );
      const elapsed = Date.now() - startedAt;
      const remainingCooldown = Math.max(0, args.waitMs - elapsed);
      if (remainingCooldown > 0) {
        await sleep(remainingCooldown);
      }
      break;
    }

    const { results, stats } = extractListingsFromRenderPayload(
      data,
      args,
      start,
      workerLabel,
    );

    collected.push(...results);

    if (args.debug) {
      console.log(
        `${workerLabel}: start=${start} returned=${stats.returnedListings}, collected=${stats.collected}, missingInspect=${stats.missingInspectLink}, decodeFailed=${stats.decodeFailed}, missingFloat=${stats.missingFloat}, total=${collected.length}`,
      );
    }

    const elapsed = Date.now() - startedAt;
    const remainingCooldown = Math.max(0, args.waitMs - elapsed);
    if (remainingCooldown > 0) {
      await sleep(remainingCooldown);
    }
  }

  return collected;
}

async function main() {
  const args = parseArgs(process.argv);
  const marketHashName = extractMarketHashNameFromUrl(args.url);

  console.log(`Steam URL: ${args.url}`);
  console.log(`Market hash name: ${marketHashName}`);
  console.log(`Workers: ${args.maxWindows}`);
  console.log(`Single worker cooldown: ${args.waitMs}ms`);
  console.log("");

  const firstPage = await fetchRenderPage(args, marketHashName, 0, PAGE_SIZE);

  const totalCount = Number(firstPage.total_count ?? 0);
  const pageSize = Number(firstPage.pagesize ?? PAGE_SIZE);

  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    throw new Error(`Invalid total listing count from endpoint: ${totalCount}`);
  }

  const plan = buildWorkerPlan(totalCount, args.maxWindows);
  const requestSpacingMs = args.waitMs / plan.workerCount;

  console.log(`Detected total listings from Steam: ${totalCount}`);
  console.log(`Detected page size: ${pageSize}`);
  console.log(`Workers needed: ${plan.workerCount}`);
  console.log(`Total endpoint requests needed: ${plan.totalRequests}`);
  console.log(`Requests per worker: ${plan.requestsPerWorker}`);
  console.log(`Inter-worker request spacing: ${requestSpacingMs}ms`);
  console.log("");

  for (const worker of plan.workers) {
    console.log(
      `Worker ${worker.workerIndex + 1}: requestIndexes ${worker.requestIndexStart}-${worker.requestIndexEnd} | starts ${worker.requestStart}-${worker.requestEnd} | requests=${worker.assignedRequests}`,
    );
  }

  console.log("\nStarting workers...\n");

  const workerResults = await Promise.all(
    plan.workers.map((worker) =>
      workerRun(args, marketHashName, worker, requestSpacingMs),
    ),
  );

  const allResultsRaw = workerResults.flat();

  const dedupedByListingId = new Map();
  for (const row of allResultsRaw) {
    if (!dedupedByListingId.has(row.listingId)) {
      dedupedByListingId.set(row.listingId, row);
    }
  }

  const allResults = Array.from(dedupedByListingId.values());
  const ranked = rankListings(allResults, args.mode, args.top);

  console.log("\nAll workers finished.");
  console.log(`Total decoded listings: ${allResults.length}`);

  if (ranked.length === 0) {
    console.log("No float rows found.");
    return;
  }

  console.log(`\nTop ${ranked.length} results (${args.mode} floats):`);
  console.log("============================================================");

  for (const row of ranked) {
    console.log(
      `Float: ${row.floatValue.toFixed(14)} | Price: ${row.priceText || "N/A"} | Start: ${row.start} | ListingId: ${row.listingId}`,
    );
  }
}

main().catch((error) => {
  console.error("Fatal error:");
  console.error(error?.stack || String(error));
  process.exit(1);
});
