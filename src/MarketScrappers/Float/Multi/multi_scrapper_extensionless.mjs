#!/usr/bin/env node

/**
 * Steam Float Scraper - Multi Skin Weapon Scanner (Playwright, no extension)
 */

import process from "node:process";
import path from "node:path";
import { parseFloatMultiArgs } from "../../../Helpers/Cli/parse-args.mjs";
import {
  buildSearchHeaders,
  fetchFloatWeaponSkinSearchResults,
} from "../../../Helpers/Steam/market-utils.mjs";
import {
  SKIP_LISTING_THRESHOLD,
  WEAR_MAP,
} from "../../../Helpers/Config/constants.mjs";
import { splitItemsForWorkers } from "../../../Helpers/Workers/worker-utils.mjs";
import { floatWeaponWorkerRun } from "../../../Helpers/Workers/float-worker-utils.mjs";
import { floatScanSkinPage } from "../../../Helpers/Scanners/float-scan-utils.mjs";
import { writeFloatWorkbook } from "../../../Helpers/Output/excel-writer.mjs";

async function main() {
  const args = parseFloatMultiArgs(process.argv);
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

  const skinResults = rawSkins.map((r) => ({
    ...r,
    marketHashName: String(r.hash_name ?? r.market_hash_name ?? ""),
  }));

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

  await writeFloatWorkbook({
    outputPath: args.out,
    skinResults: resultsInOriginalOrder,
    args,
  });

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
