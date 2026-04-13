#!/usr/bin/env node

/**
 * float_scraper_multi_browser.mjs — Float multi weapon scan (Playwright).
 */

import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFloatMultiArgs } from "../../../Helpers/Cli/parse-args.mjs";
import {
  buildSearchHeaders,
  fetchFloatWeaponSkinSearchResults,
  getBasePriceCentsFromSearchResult,
} from "../../../Helpers/Steam/market-utils.mjs";
import {
  SKIP_LISTING_THRESHOLD,
  WEAR_MAP,
} from "../../../Helpers/Config/constants.mjs";
import { splitItemsForWorkers } from "../../../Helpers/Workers/worker-utils.mjs";
import { floatWeaponWorkerRun } from "../../../Helpers/Workers/float-worker-utils.mjs";
import { floatScanSkinPage } from "../../../Helpers/Scanners/float-scan-utils.mjs";
/**
 * @param {object} args - same shape as `parseFloatMultiArgs` output
 */
export async function runFloatMultiWeapon(args) {
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

  const rawSkins = await fetchFloatWeaponSkinSearchResults(args, searchHeaders);
  console.log(`Found ${rawSkins.length} matching skins.`);

  let skinResults = rawSkins.map((r) => ({
    ...r,
    marketHashName: String(r.hash_name ?? r.market_hash_name ?? ""),
  }));

  if (args.maxPrice != null) {
    const capCents = args.maxPrice * 100;
    const before = skinResults.length;
    skinResults = skinResults.filter((r) => {
      const c = getBasePriceCentsFromSearchResult(r);
      return c <= 0 || c <= capCents;
    });
    const filtered = before - skinResults.length;
    if (filtered > 0) {
      console.log(
        `Filtered ${filtered} skins above max price (€${args.maxPrice}). ${skinResults.length} skins remaining.`,
      );
    }
  }

  const listingThreshold = args.maxListingsPerSkin ?? SKIP_LISTING_THRESHOLD;
  const preSkipped = [];
  {
    const before = skinResults.length;
    skinResults = skinResults.filter((r) => {
      const count = Number(r.sell_listings ?? 0);
      if (count > listingThreshold) {
        preSkipped.push({
          marketHashName: r.marketHashName,
          totalCount: count,
          reason: `Skipped because listing count ${count} is greater than ${listingThreshold}`,
        });
        return false;
      }
      return true;
    });
    if (preSkipped.length > 0) {
      console.log(
        `Skipped ${preSkipped.length} skins above listing threshold (${listingThreshold}). ${skinResults.length} skins remaining.`,
      );
      for (const s of preSkipped) {
        args.onProgress?.({
          type: "skin:pre-skipped",
          marketHashName: s.marketHashName,
          reason: s.reason,
        });
      }
    }
  }

  const workerBuckets = splitItemsForWorkers(skinResults, args.workers);

  workerBuckets.forEach((bucket, idx) => {
    console.log(`Worker ${idx + 1} assigned ${bucket.length} skins.`);
  });

  const workerOutputs = await Promise.all(
    workerBuckets.map((bucket, idx) =>
      floatWeaponWorkerRun(idx, bucket, args, floatScanSkinPage),
    ),
  );

  const flattened = workerOutputs.flatMap((worker) => worker.results);
  flattened.sort((a, b) => a.originalIndex - b.originalIndex);

  const allSkippedSkins = [
    ...preSkipped,
    ...workerOutputs
      .flatMap((worker) => worker.skippedSkins)
      .sort((a, b) => a.originalIndex - b.originalIndex),
  ];

  const resultsInOriginalOrder = flattened.map((entry) => entry.result);

  const failedSkins = resultsInOriginalOrder
    .filter((r) => r.error && !r.skipped)
    .map((r) => ({
      marketHashName: r.marketHashName,
      error: r.error,
    }));

  const processedCount = resultsInOriginalOrder.filter(
    (r) => !r.skipped && !r.error,
  ).length;

  return {
    summary: {
      weapon: args.weapon,
      wear: args.wear,
      mode: args.mode,
      quality: args.quality,
      totalSkinsFound: skinResults.length,
      totalSkinsProcessed: processedCount,
      totalSkinsSkipped: allSkippedSkins.length,
      totalSkinsFailed: failedSkins.length,
    },
    skinResults: resultsInOriginalOrder,
    skippedSkins: allSkippedSkins.map((s) => ({
      marketHashName: s.marketHashName,
      totalCount: s.totalCount,
      reason: s.reason,
    })),
    failedSkins,
  };
}

async function main() {
  const args = parseFloatMultiArgs(process.argv);
  const result = await runFloatMultiWeapon(args);

  console.log("\nDone.");

  console.log("\nSummary");
  console.log("=======");

  for (const skin of result.skinResults) {
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

  if (result.skippedSkins.length === 0) {
    console.log("None");
  } else {
    for (const skipped of result.skippedSkins) {
      console.log(`${skipped.marketHashName}: ${skipped.totalCount} listings`);
    }
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
