import { setupBrowserContext } from "../Steam/browser-utils.mjs";
import { sleep } from "../utils/general.mjs";
import { extractSkinNameParts } from "../Steam/market-utils.mjs";

/**
 * Playwright worker loop for float multi weapon scan (one page per skin, XLSX-oriented result).
 * @param {number} workerIndex
 * @param {object[]} assignedSkins - items with marketHashName (or hash_name), displayIndex, totalCount, originalIndex
 * @param {object} args
 * @param {(page: import('playwright').Page, marketHashName: string, args: object, workerLabel: string) => Promise<object>} scanSkinPage
 */
export async function floatWeaponWorkerRun(
  workerIndex,
  assignedSkins,
  args,
  scanSkinPage,
) {
  const workerLabel = `[W${workerIndex + 1}]`;
  const { browser, context } = await setupBrowserContext(args);
  const page = await context.newPage();
  const results = [];
  const skippedSkins = [];

  try {
    for (const skin of assignedSkins) {
      const marketHashName = String(
        skin.marketHashName ?? skin.hash_name ?? skin.market_hash_name ?? "",
      );

      console.log(
        `${workerLabel} [${skin.displayIndex}/${skin.totalCount}] ${marketHashName}`,
      );

      try {
        const scannedSkin = await scanSkinPage(
          page,
          marketHashName,
          args,
          workerLabel,
        );

        results.push({
          originalIndex: skin.originalIndex,
          result: scannedSkin,
        });

        if (scannedSkin.skipped) {
          skippedSkins.push({
            originalIndex: skin.originalIndex,
            marketHashName,
            totalCount: scannedSkin.totalCount,
            reason: scannedSkin.skippedReason,
          });

          console.log(
            `${workerLabel}   skipped: ${marketHashName} (${scannedSkin.totalCount} listings)`,
          );
        } else {
          console.log(
            `${workerLabel}   total listings collected: ${scannedSkin.listingCount}, kept: ${scannedSkin.topResults.length}`,
          );
        }
      } catch (error) {
        console.log(
          `${workerLabel}   Failed skin: ${error?.message || String(error)}`,
        );

        results.push({
          originalIndex: skin.originalIndex,
          result: {
            marketHashName,
            skinName: extractSkinNameParts(marketHashName).skinName,
            listingCount: 0,
            decodedCount: 0,
            failedDecodeCount: 0,
            missingInspectCount: 0,
            topResults: [],
            cheapestListing: null,
            skipped: false,
            error: error?.message || String(error),
          },
        });
      }

      await sleep(args.waitMs);
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return { results, skippedSkins };
}
