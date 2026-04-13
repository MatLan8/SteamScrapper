#!/usr/bin/env node

/**
 * float_scraper_single_endpoint.mjs — Float single listing (HTTP render API, no browser).
 */

import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TARGET_PAGE_SIZE } from "../../../Helpers/Config/constants.mjs";
import { parseSingleUrlArgs } from "../../../Helpers/Cli/parse-args.mjs";
import { extractMarketHashNameFromUrl } from "../../../Helpers/Utils/url-utils.mjs";
import {
  buildRenderUrl,
  buildRenderHeaders,
  fetchRenderPageJson,
} from "../../../Helpers/Steam/endpoint-utils.mjs";
import {
  extractFloatListingsFromRenderPayload,
  rankFloatListings,
} from "../../../Helpers/Scanners/float-scan-utils.mjs";
import {
  buildHttpWorkerPlan,
  httpWorkerRun,
} from "../../../Helpers/Workers/endpoint-worker-utils.mjs";

const PAGE_SIZE = TARGET_PAGE_SIZE;

/**
 * @param {object} args - same shape as `parseSingleUrlArgs` output
 */
export async function runFloatSingleEndpoint(args) {
  const marketHashName = extractMarketHashNameFromUrl(args.url);

  async function fetchRenderPage(start, count = PAGE_SIZE) {
    const url = buildRenderUrl(
      marketHashName,
      start,
      count,
      args.currency,
    );
    const headers = buildRenderHeaders(args.url, args.cookie);
    return fetchRenderPageJson(url, headers);
  }

  const firstPage = await fetchRenderPage(0, PAGE_SIZE);

  const totalCount = Number(firstPage.total_count ?? 0);
  const pageSize = Number(firstPage.pagesize ?? PAGE_SIZE);

  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    throw new Error(`Invalid total listing count from endpoint: ${totalCount}`);
  }

  const plan = buildHttpWorkerPlan(totalCount, PAGE_SIZE, args.maxWindows);
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

  const allResultsNested = await Promise.all(
    plan.workers.map(async (workerPlan) => {
      const collected = [];

      await httpWorkerRun(
        workerPlan,
        args,
        requestSpacingMs,
        PAGE_SIZE,
        async (start) => {
          let data;
          try {
            data = await fetchRenderPage(start, PAGE_SIZE);
          } catch (error) {
            throw error;
          }

          const workerLabel = `Worker ${workerPlan.workerIndex + 1}`;
          const { results, stats } = extractFloatListingsFromRenderPayload(
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
        },
      );

      return collected;
    }),
  );

  const allResultsRaw = allResultsNested.flat();

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

  return {
    summary: {
      url: args.url,
      marketHashName,
      mode: args.mode,
      totalListings: totalCount,
      totalDecoded: allResults.length,
      topCount: ranked.length,
    },
    topResults: ranked.map((row) => ({
      floatValue: row.floatValue,
      priceText: row.priceText ?? null,
      listingId: row.listingId,
      inspectLink: row.inspectLink ?? null,
      start: row.start,
    })),
    allResults,
  };
}

async function main() {
  const args = parseSingleUrlArgs(process.argv);
  const marketHashName = extractMarketHashNameFromUrl(args.url);

  console.log(`Steam URL: ${args.url}`);
  console.log(`Market hash name: ${marketHashName}`);
  console.log(`Workers: ${args.maxWindows}`);
  console.log(`Single worker cooldown: ${args.waitMs}ms`);
  console.log("");

  const result = await runFloatSingleEndpoint(args);

  if (result.topResults.length === 0) {
    console.log("No float rows found.");
    return;
  }

  console.log(`\nTop ${result.topResults.length} results (${args.mode} floats):`);
  console.log("============================================================");

  for (const row of result.topResults) {
    console.log(
      `Float: ${row.floatValue.toFixed(14)} | Price: ${row.priceText || "N/A"} | Start: ${row.start} | ListingId: ${row.listingId}`,
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
