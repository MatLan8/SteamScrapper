#!/usr/bin/env node

/**
 * Steam Float Scraper - Single Listing URL (Playwright, controller + workers)
 */

import process from "node:process";
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

async function main() {
  const args = parseSingleUrlArgs(process.argv);
  const marketHashName = extractMarketHashNameFromUrl(args.url);

  console.log(`Steam URL: ${args.url}`);
  console.log(`Market hash name: ${marketHashName}`);
  console.log(`Max windows: ${args.maxWindows}`);
  console.log("");

  console.log("Opening controller window...");
  const { browser: controllerBrowser, context: controllerContext } =
    await setupBrowserContext(args);
  const controllerPage = await controllerContext.newPage();
  const controllerSeenIds = new Set();

  try {
    await controllerPage.goto(args.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await waitForListingPageStableSoft(controllerPage, args);
    await floatSoftForcePageSize(controllerPage, args, PAGE_SIZE);

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
      args.maxWindows,
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
      args,
      controllerPlan,
      "Controller",
      controllerSeenIds,
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
    const ranked = rankFloatListings(allResults, args.mode, args.top);

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
