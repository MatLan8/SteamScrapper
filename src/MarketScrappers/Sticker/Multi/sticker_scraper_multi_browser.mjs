#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  CHARM_DB_PATH,
  STICKER_DB_PATH,
} from "../../../Helpers/Config/constants.mjs";
import { parseWeaponSearchArgs } from "../../../Helpers/Cli/parse-args.mjs";
import {
  loadCharmDb,
  loadStickerDb,
} from "../../../Helpers/db/load-databases.mjs";
import {
  buildSearchHeaders,
  fetchAllSkinSearchResults,
} from "../../../Helpers/Steam/market-utils.mjs";
import { scanSkinPage } from "../../../Helpers/Scanners/sticker-charm-scan-utils.mjs";
import {
  createMissingTracker,
  splitItemsForWorkers,
  workerRun,
} from "../../../Helpers/Workers/worker-utils.mjs";
import { sortListings } from "../../../Helpers/Utils/sort-utils.mjs";
import { sortedNumericStrings } from "../../../Helpers/utils/general.mjs";

/**
 * @param {object} args - same shape as `parseWeaponSearchArgs` output
 */
export async function runStickerCharmMulti(args) {
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
        (page, skin, labelArgs, workerLabel) =>
          scanSkinPage(
            page,
            skin,
            labelArgs,
            stickerMap,
            charmMap,
            highlightReelMap,
            missingTracker,
            workerLabel,
          ),
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

  const realFailed = failedSkins.filter(
    (f) => f.marketHashName !== "[WORKER_FATAL]" && f.marketHashName !== "[WORKER_RECOVERY]",
  );

  return {
    summary: {
      weapon: args.weapon,
      conditions: args.conditions,
      quality: args.quality,
      sortBy: args.sortBy,
      totalSkinsFound: skinResults.length,
      totalSkinsProcessed: processedSkins.length,
      totalSkinsSkipped: skippedSkins.length,
      totalSkinsFailed: realFailed.length,
      totalListingsCollected: allListings.length,
      topResultsCount: topResults.length,
    },
    topResults,
    processedSkins,
    skippedSkins,
    failedSkins: realFailed,
    missingIds: {
      stickers: sortedNumericStrings(missingTracker.stickers),
      charms: sortedNumericStrings(missingTracker.charms),
      highlightReels: sortedNumericStrings(missingTracker.highlightReels),
    },
    missingTracker,
  };
}

async function main() {
  const args = parseWeaponSearchArgs(process.argv);
  const result = await runStickerCharmMulti(args);

  const {
    topResults,
    processedSkins,
    skippedSkins,
    failedSkins,
    missingTracker,
  } = result;
  const allListingsCount = result.summary.totalListingsCollected;

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

  console.log(`\nDone.`);
  console.log(`Collected listings: ${allListingsCount}`);
  console.log(`Top results: ${topResults.length}`);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(async (error) => {
    console.error("Fatal error:");
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
