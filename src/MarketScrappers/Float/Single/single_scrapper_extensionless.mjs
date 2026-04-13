#!/usr/bin/env node

/**
 * ============================================================
 * Steam Float Scraper - Single Listing URL Auto-Chunk Scanner
 * ============================================================
 *
 * This script:
 * 1. Opens one controller window first
 * 2. Reads total listing count from g_oSearchResults.m_cTotalCount
 * 3. Splits the listing into worker chunks based on max windows
 * 4. Launches worker browsers
 * 5. Each worker scans only its assigned listing/page range
 * 6. Extracts inspect links from listing rows
 * 7. Uses @csfloat/cs2-inspect-serializer to decode float values
 * 8. Prints top lowest/highest floats
 *
 * No browser extension is used.
 * No persistent user profiles are created.
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
 * Maximum total worker windows to use.
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
 * Delay between page actions
 * Default: 1500
 *
 * --cookie
 * Optional raw Steam cookie header
 *
 * --headful
 * Open visible browser windows
 *
 * --headless
 * Open hidden browser windows
 *
 * --debug
 * Extra logs
 */

// node single_scrapper.mjs --url "https://steamcommunity.com/market/listings/730/AWP%20%7C%20Safari%20Mesh%20%28Battle-Scarred%29" --mode lowest --top 30 --debug

import process from "node:process";
import { chromium } from "playwright";
import { decodeLink } from "@csfloat/cs2-inspect-serializer";

const PAGE_SIZE = 100;
const DEFAULT_TOP = 10;
const DEFAULT_WAIT_MS = 1500;
const DEFAULT_MAX_WINDOWS = 10;

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

function extractMarketHashNameFromUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/");
  const encodedName = parts.slice(4).join("/");
  return decodeURIComponent(encodedName);
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

function buildWorkerPlan(totalListings, maxWindows) {
  const workerCount = Math.min(maxWindows, Math.max(1, totalListings));
  const chunkSize = Math.ceil(totalListings / workerCount);
  const workers = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const listingStart = workerIndex * chunkSize;
    if (listingStart >= totalListings) break;

    const listingEnd = Math.min(
      totalListings - 1,
      listingStart + chunkSize - 1,
    );
    const pageStart = Math.floor(listingStart / PAGE_SIZE);
    const pageEnd = Math.floor(listingEnd / PAGE_SIZE);

    workers.push({
      workerIndex,
      listingStart,
      listingEnd,
      pageStart,
      pageEnd,
      assignedListings: listingEnd - listingStart + 1,
      assignedPages: pageEnd - pageStart + 1,
    });
  }

  return {
    totalListings,
    workerCount: workers.length,
    chunkSize,
    workers,
  };
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

async function forcePageSize(page, args, size = PAGE_SIZE) {
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

async function goToResultPageWithRetry(page, args, pageIndex, retries = 2) {
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const moved = await goToResultPage(page, args, pageIndex);

    if (moved) {
      return true;
    }

    if (args.debug) {
      console.log(
        `    retrying page ${pageIndex + 1}, attempt ${attempt}/${retries + 1}`,
      );
    }

    await page.waitForTimeout(args.waitMs * 2);
  }

  return false;
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
  pageIndex,
  listingStart,
  listingEnd,
  globalSeenIds,
) {
  await page.waitForTimeout(800);

  const listingRows = page.locator(".market_listing_row[id^='listing_']");
  const totalRows = await listingRows.count();
  const results = [];
  const pageIds = new Set();

  const stats = {
    visibleRows: totalRows,
    outOfRangeSkipped: 0,
    duplicateSkipped: 0,
    missingInspectLink: 0,
    decodeFailed: 0,
    missingFloat: 0,
    collected: 0,
  };

  if (args.debug) {
    console.log(
      `    page ${pageIndex + 1}: visible rows=${totalRows}, range=${listingStart}-${listingEnd}`,
    );
  }

  for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
    const globalListingIndex = pageIndex * PAGE_SIZE + rowIndex;

    if (globalListingIndex < listingStart || globalListingIndex > listingEnd) {
      stats.outOfRangeSkipped += 1;
      continue;
    }

    const row = listingRows.nth(rowIndex);
    const idAttr = await row.getAttribute("id");
    const listingId =
      idAttr?.replace(/^listing_/, "") ?? `page${pageIndex}_row${rowIndex}`;

    if (pageIds.has(listingId) || globalSeenIds.has(listingId)) {
      stats.duplicateSkipped += 1;
      continue;
    }

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
          `    failed to decode inspect link for listingId=${listingId}: ${error?.message || String(error)}`,
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

    pageIds.add(listingId);

    results.push({
      listingId,
      inspectLink,
      priceText,
      priceCents: extractCentsFromPriceText(priceText),
      floatValue,
      page: pageIndex + 1,
      globalListingIndex,
    });

    stats.collected += 1;
  }

  return {
    results,
    pageIds,
    stats,
  };
}

async function extractValidatedPage(
  page,
  args,
  pageIndex,
  listingStart,
  listingEnd,
  globalSeenIds,
  workerLabel,
) {
  const extracted = await extractListingsFromCurrentPage(
    page,
    args,
    pageIndex,
    listingStart,
    listingEnd,
    globalSeenIds,
  );

  const { stats } = extracted;

  if (args.debug) {
    console.log(
      `${workerLabel}: page ${pageIndex + 1} collected=${stats.collected}, missingInspect=${stats.missingInspectLink}, decodeFailed=${stats.decodeFailed}, missingFloat=${stats.missingFloat}, duplicates=${stats.duplicateSkipped}`,
    );
  }

  return extracted;
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

async function scanWorkerChunk(args, plan) {
  const { browser, context } = await setupBrowserContext(args);
  const page = await context.newPage();

  try {
    await page.goto(args.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForListingPageStable(page, args);
    await forcePageSize(page, args, PAGE_SIZE);

    return await scanChunkWithPage(
      page,
      args,
      plan,
      `Worker ${plan.workerIndex + 1}`,
    );
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function scanChunkWithPage(page, args, plan, workerLabel) {
  const seenIds = new Set();
  const collected = [];

  console.log(
    `${workerLabel}: listings ${plan.listingStart}-${plan.listingEnd} | pages ${plan.pageStart + 1}-${plan.pageEnd + 1} | assigned listings=${plan.assignedListings}`,
  );

  const currentMeta = await getSearchResultsMeta(page);

  if (currentMeta.pageSize !== PAGE_SIZE) {
    await forcePageSize(page, args, PAGE_SIZE);
  }

  if (args.debug) {
    console.log(
      `${workerLabel}: detected totalCount=${currentMeta.totalCount}, pageSize=${currentMeta.pageSize}`,
    );
  }

  for (
    let pageIndex = plan.pageStart;
    pageIndex <= plan.pageEnd;
    pageIndex += 1
  ) {
    if (pageIndex !== 0) {
      const moved = await goToResultPageWithRetry(page, args, pageIndex, 2);

      if (!moved) {
        if (args.debug) {
          console.log(
            `${workerLabel}: failed to move to page ${pageIndex + 1}`,
          );
        }
        break;
      }
    }

    const extracted = await extractValidatedPage(
      page,
      args,
      pageIndex,
      plan.listingStart,
      plan.listingEnd,
      seenIds,
      workerLabel,
    );

    const { results: pageResults, pageIds, stats } = extracted;

    for (const id of pageIds) {
      seenIds.add(id);
    }

    collected.push(...pageResults);

    if (args.debug) {
      console.log(
        `${workerLabel}: page ${pageIndex + 1} accepted | collected=${stats.collected}, duplicates=${stats.duplicateSkipped}, total=${collected.length}`,
      );
    }

    await sleep(args.waitMs);
  }

  return collected;
}

async function main() {
  const args = parseArgs(process.argv);
  const marketHashName = extractMarketHashNameFromUrl(args.url);

  console.log(`Steam URL: ${args.url}`);
  console.log(`Market hash name: ${marketHashName}`);
  console.log(`Max windows: ${args.maxWindows}`);
  console.log("");

  console.log("Opening controller window...");
  const { browser: controllerBrowser, context: controllerContext } =
    await setupBrowserContext(args);
  const controllerPage = await controllerContext.newPage();

  try {
    await controllerPage.goto(args.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await waitForListingPageStable(controllerPage, args);
    await forcePageSize(controllerPage, args, PAGE_SIZE);

    const meta = await getSearchResultsMeta(controllerPage);

    if (!meta.hasSearchResults) {
      throw new Error("Could not access g_oSearchResults on the listing page");
    }

    if (!Number.isFinite(meta.totalCount) || meta.totalCount <= 0) {
      throw new Error(
        `Invalid total listing count from page: ${meta.totalCount}`,
      );
    }

    const plan = buildWorkerPlan(meta.totalCount, args.maxWindows);

    console.log(`Detected total listings from Steam: ${meta.totalCount}`);
    console.log(`Detected page size: ${meta.pageSize || PAGE_SIZE}`);
    console.log(`Workers needed: ${plan.workerCount}`);
    console.log(`Chunk size per worker: ${plan.chunkSize}`);
    console.log("");

    for (const worker of plan.workers) {
      console.log(
        `Worker ${worker.workerIndex + 1}: listings ${worker.listingStart}-${worker.listingEnd} | pages ${worker.pageStart + 1}-${worker.pageEnd + 1} | listings=${worker.assignedListings} | pages=${worker.assignedPages}`,
      );
    }

    console.log("\nStarting controller + workers...\n");

    const [controllerPlan, ...otherWorkerPlans] = plan.workers;

    const controllerResultsPromise = scanChunkWithPage(
      controllerPage,
      args,
      controllerPlan,
      "Controller",
    );

    const workerResultsPromise = Promise.all(
      otherWorkerPlans.map((worker) => scanWorkerChunk(args, worker)),
    );

    const [controllerResults, workerResults] = await Promise.all([
      controllerResultsPromise,
      workerResultsPromise,
    ]);

    const allResultsRaw = [controllerResults, ...workerResults].flat();

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
        `Float: ${row.floatValue.toFixed(14)} | Price: ${row.priceText || "N/A"} | Page: ${row.page} | ListingIndex: ${row.globalListingIndex} | ListingId: ${row.listingId}`,
      );
    }
  } finally {
    console.log("\nClosing controller window...");
    await controllerPage.close().catch(() => {});
    await controllerContext.close().catch(() => {});
    await controllerBrowser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error("Fatal error:");
  console.error(error?.stack || String(error));
  process.exit(1);
});
