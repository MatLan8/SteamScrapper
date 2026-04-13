import {
  isRateLimitError,
  setupBrowserContext,
} from "../Steam/browser-utils.mjs";
import { scanSkinPage } from "../Scanners/sticker-charm-scan-utils.mjs";
import { sleep } from "../utils/general.mjs";

export function splitItemsForWorkers(items, workerCount) {
  const buckets = Array.from({ length: workerCount }, () => []);

  items.forEach((item, index) => {
    buckets[index % workerCount].push({
      ...item,
      originalIndex: index,
      totalCount: items.length,
      displayIndex: index + 1,
    });
  });

  return buckets;
}

export function createMissingTracker() {
  return {
    stickers: new Set(),
    charms: new Set(),
    highlightReels: new Set(),
  };
}

export function addRemainingSkinsAsFailed(
  assignedSkins,
  startIndex,
  reason,
  failedSkins,
) {
  for (let i = startIndex; i < assignedSkins.length; i += 1) {
    failedSkins.push({
      marketHashName: assignedSkins[i].marketHashName,
      error: reason,
    });
  }
}

export async function workerRun(
  workerIndex,
  assignedSkins,
  args,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
) {
  const workerLabel = `[W${workerIndex + 1}]`;
  const processedSkins = [];
  const skippedSkins = [];
  const workerListings = [];
  const failedSkins = [];

  let browser = null;
  let context = null;
  let page = null;

  async function safeCloseAll() {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    page = null;
    context = null;
    browser = null;
  }

  async function createFreshPage() {
    if (!context) {
      throw new Error("Cannot create fresh page: browser context is missing");
    }

    await page?.close().catch(() => {});
    page = await context.newPage();
  }

  try {
    const setup = await setupBrowserContext(args);
    browser = setup.browser;
    context = setup.context;
    page = await context.newPage();

    for (let skinIndex = 0; skinIndex < assignedSkins.length; skinIndex += 1) {
      const skin = assignedSkins[skinIndex];

      console.log(
        `${workerLabel} [${skin.displayIndex}/${skin.totalCount}] ${skin.marketHashName}`,
      );

      try {
        const scanned = await scanSkinPage(
          page,
          skin,
          args,
          stickerMap,
          charmMap,
          highlightReelMap,
          missingTracker,
          workerLabel,
        );

        processedSkins.push(skin.marketHashName);

        if (scanned.skipped) {
          skippedSkins.push({
            marketHashName: skin.marketHashName,
            totalCount: scanned.totalCount,
            reason: scanned.skippedReason,
          });

          console.log(
            `${workerLabel}   skipped by threshold: ${skin.marketHashName} (${scanned.totalCount})`,
          );
        } else {
          workerListings.push(...scanned.scannedListings);

          console.log(
            `${workerLabel}   scanned listings kept: ${scanned.scannedListings.length}`,
          );
        }
      } catch (error) {
        const errorMessage = error?.message || String(error);

        console.log(
          `${workerLabel}   failed skin: ${skin.marketHashName} | ${errorMessage}`,
        );

        failedSkins.push({
          marketHashName: skin.marketHashName,
          error: errorMessage,
        });

        if (isRateLimitError(error)) {
          console.log(
            `${workerLabel}   fatal rate limit detected, closing worker and marking remaining queue as failed`,
          );

          addRemainingSkinsAsFailed(
            assignedSkins,
            skinIndex + 1,
            `Worker aborted after rate limit on ${skin.marketHashName}`,
            failedSkins,
          );

          await safeCloseAll();
          return {
            processedSkins,
            skippedSkins,
            failedSkins,
            listings: workerListings,
          };
        }

        try {
          await createFreshPage();
        } catch (recoveryError) {
          const recoveryMessage =
            recoveryError?.message || String(recoveryError);

          failedSkins.push({
            marketHashName: "[WORKER_RECOVERY]",
            error: recoveryMessage,
          });

          addRemainingSkinsAsFailed(
            assignedSkins,
            skinIndex + 1,
            `Worker aborted after recovery failure on ${skin.marketHashName}: ${recoveryMessage}`,
            failedSkins,
          );

          await safeCloseAll();
          return {
            processedSkins,
            skippedSkins,
            failedSkins,
            listings: workerListings,
          };
        }
      }

      await sleep(args.waitMs);
    }
  } catch (error) {
    const fatalMessage = error?.message || String(error);

    failedSkins.push({
      marketHashName: "[WORKER_FATAL]",
      error: fatalMessage,
    });

    addRemainingSkinsAsFailed(
      assignedSkins,
      0,
      `Worker fatal setup/runtime error: ${fatalMessage}`,
      failedSkins,
    );
  } finally {
    await safeCloseAll();
  }

  return {
    processedSkins,
    skippedSkins,
    failedSkins,
    listings: workerListings,
  };
}
