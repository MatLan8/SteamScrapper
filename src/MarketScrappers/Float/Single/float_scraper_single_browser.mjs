#!/usr/bin/env node

/**
 * float_scraper_single_browser.mjs — Float single listing (Playwright, controller + workers).
 */

import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSingleUrlArgs } from "../../../Helpers/Cli/parse-args.mjs";
import { extractMarketHashNameFromUrl } from "../../../Helpers/Utils/url-utils.mjs";
import { setupBrowserContext } from "../../../Helpers/Steam/browser-utils.mjs";
import { sleep } from "../../../Helpers/utils/general.mjs";
import { TARGET_PAGE_SIZE } from "../../../Helpers/Config/constants.mjs";
import {
  buildListingBrowserWorkerPlan,
  extractFloatListingsFromCurrentPageInRange,
  floatSoftForcePageSize,
  getSearchResultsMeta,
  goToResultPageWithRetry,
  rankFloatListings,
  waitForListingPageStableSoft,
} from "../../../Helpers/Scanners/float-scan-utils.mjs";

const PAGE_SIZE = TARGET_PAGE_SIZE;

async function scanChunkWithPage(page, args, plan, workerLabel, seenIds) {
  const collected = [];

  console.log(
    `${workerLabel}: listings ${plan.listingStart}-${plan.listingEnd} | pages ${plan.pageStart + 1}-${plan.pageEnd + 1} | assigned listings=${plan.assignedListings}`,
  );

  const currentMeta = await getSearchResultsMeta(page);

  if (currentMeta.pageSize !== PAGE_SIZE) {
    await floatSoftForcePageSize(page, args, PAGE_SIZE);
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

    const extracted = await extractFloatListingsFromCurrentPageInRange(
      page,
      args,
      pageIndex,
      PAGE_SIZE,
      plan.listingStart,
      plan.listingEnd,
      seenIds,
    );

    const { results: pageResults, pageIds, stats } = extracted;

    for (const id of pageIds) {
      seenIds.add(id);
    }

    collected.push(...pageResults);

    if (args.debug) {
      console.log(
        `${workerLabel}: page ${pageIndex + 1} collected=${stats.collected}, duplicates=${stats.duplicateSkipped}, total=${collected.length}`,
      );
    }

    const assignedPages = plan.pageEnd - plan.pageStart + 1;
    const currentPageInChunk = pageIndex - plan.pageStart + 1;
    args.onProgress?.({
      type: "page:done",
      workerIndex: plan.workerIndex,
      currentPage: currentPageInChunk,
      totalPages: assignedPages,
      marketHashName: args._progressMarketHashName ?? null,
      listingsCollected: collected.length,
    });

    await sleep(args.waitMs);
  }

  return collected;
}

async function scanWorkerChunk(args, plan) {
  const { browser, context } = await setupBrowserContext(args);
  const page = await context.newPage();
  const seenIds = new Set();

  try {
    await page.goto(args.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForListingPageStableSoft(page, args);
    await floatSoftForcePageSize(page, args, PAGE_SIZE);

    return await scanChunkWithPage(page, args, plan, `Worker ${plan.workerIndex + 1}`, seenIds);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Core scan (CLI and HTTP server). Passes `_progressMarketHashName` for onProgress.
 * @param {object} args - same shape as `parseSingleUrlArgs` output
 */
export async function runFloatSinglePlaywright(args) {
  const marketHashName = extractMarketHashNameFromUrl(args.url);
  const runArgs = { ...args, _progressMarketHashName: marketHashName };

  console.log("Opening controller window...");
  const { browser: controllerBrowser, context: controllerContext } =
    await setupBrowserContext(runArgs);
  const controllerPage = await controllerContext.newPage();
  const controllerSeenIds = new Set();

  try {
    await controllerPage.goto(runArgs.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await waitForListingPageStableSoft(controllerPage, runArgs);
    await floatSoftForcePageSize(controllerPage, runArgs, PAGE_SIZE);

    const meta = await getSearchResultsMeta(controllerPage);

    if (!meta.hasSearchResults) {
      throw new Error("Could not access g_oSearchResults on the listing page");
    }

    if (!Number.isFinite(meta.totalCount) || meta.totalCount <= 0) {
      throw new Error(
        `Invalid total listing count from page: ${meta.totalCount}`,
      );
    }

    const plan = buildListingBrowserWorkerPlan(
      meta.totalCount,
      runArgs.maxWindows,
      PAGE_SIZE,
    );

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
      runArgs,
      controllerPlan,
      "Controller",
      controllerSeenIds,
    );

    const workerResultsPromise = Promise.all(
      otherWorkerPlans.map((worker) => scanWorkerChunk(runArgs, worker)),
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
    const ranked = rankFloatListings(allResults, runArgs.mode, runArgs.top);

    console.log("\nAll workers finished.");
    console.log(`Total decoded listings: ${allResults.length}`);

    return {
      summary: {
        url: runArgs.url,
        marketHashName,
        mode: runArgs.mode,
        totalListings: meta.totalCount,
        totalDecoded: allResults.length,
        topCount: ranked.length,
      },
      topResults: ranked.map((row) => ({
        floatValue: row.floatValue,
        priceText: row.priceText ?? null,
        listingId: row.listingId,
        inspectLink: row.inspectLink ?? null,
        page: row.page,
        globalListingIndex: row.globalListingIndex,
        start: row.start,
      })),
      allResults,
    };
  } finally {
    console.log("\nClosing controller window...");
    await controllerPage.close().catch(() => {});
    await controllerContext.close().catch(() => {});
    await controllerBrowser.close().catch(() => {});
  }
}

async function main() {
  const args = parseSingleUrlArgs(process.argv);
  const marketHashName = extractMarketHashNameFromUrl(args.url);

  console.log(`Steam URL: ${args.url}`);
  console.log(`Market hash name: ${marketHashName}`);
  console.log(`Max windows: ${args.maxWindows}`);
  console.log("");

  const result = await runFloatSinglePlaywright(args);

  if (result.topResults.length === 0) {
    console.log("No float rows found.");
    return;
  }

  console.log(
    `\nTop ${result.topResults.length} results (${args.mode} floats):`,
  );
  console.log("============================================================");

  for (const row of result.topResults) {
    console.log(
      `Float: ${row.floatValue.toFixed(14)} | Price: ${row.priceText || "N/A"} | Page: ${row.page} | ListingIndex: ${row.globalListingIndex} | ListingId: ${row.listingId}`,
    );
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error("Fatal error:");
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
