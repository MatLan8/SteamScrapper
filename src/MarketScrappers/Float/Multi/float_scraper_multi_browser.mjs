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

  // #region agent log
  fetch('http://127.0.0.1:7886/ingest/4e27bff3-ffff-4c42-9349-997b4cf16f56',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'af75e4'},body:JSON.stringify({sessionId:'af75e4',location:'float_scraper_multi_browser.mjs:42',message:'raw search results sample',data:{count:rawSkins.length,maxListingsPerSkin:args.maxListingsPerSkin,firstSkinKeys:rawSkins[0]?Object.keys(rawSkins[0]):[],firstSkinSellListings:rawSkins[0]?.sell_listings,firstSkinName:rawSkins[0]?.hash_name,sampleListingCounts:rawSkins.slice(0,5).map(r=>({name:r.hash_name,sell_listings:r.sell_listings}))},timestamp:Date.now(),hypothesisId:'H1+H2'})}).catch(()=>{});
  // #endregion

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

  const allSkippedSkins = workerOutputs
    .flatMap((worker) => worker.skippedSkins)
    .sort((a, b) => a.originalIndex - b.originalIndex);

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
