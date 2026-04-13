import { setupBrowserContext } from "../Steam/browser-utils.mjs";
import { sleep } from "../utils/general.mjs";
import { extractSkinNameParts } from "../Steam/market-utils.mjs";

/**
 * Playwright worker loop for float multi weapon scan (one page per skin, per-skin float results).
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

      args.onProgress?.({
        type: "skin:start",
        workerIndex,
        skinIndex: skin.displayIndex,
        totalSkins: skin.totalCount,
        marketHashName,
      });

      try {
        const wrappedArgs = {
          ...args,
          onProgress: (event) =>
            args.onProgress?.({ ...event, workerIndex }),
        };
        const scannedSkin = await scanSkinPage(
          page,
          marketHashName,
          wrappedArgs,
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

          args.onProgress?.({
            type: "skin:done",
            workerIndex,
            skinIndex: skin.displayIndex,
            totalSkins: skin.totalCount,
            marketHashName,
            status: "skipped",
            reason: scannedSkin.skippedReason ?? null,
          });
        } else {
          console.log(
            `${workerLabel}   total listings collected: ${scannedSkin.listingCount}, kept: ${scannedSkin.topResults.length}`,
          );

          args.onProgress?.({
            type: "skin:done",
            workerIndex,
            skinIndex: skin.displayIndex,
            totalSkins: skin.totalCount,
            marketHashName,
            status: "success",
            reason: null,
          });
        }
      } catch (error) {
        const message = error?.message || String(error);
        const isRateLimit =
          typeof message === "string" && message.startsWith("RATE_LIMITED:");

        console.log(`${workerLabel}   Failed skin: ${message}`);

        args.onProgress?.({
          type: "skin:done",
          workerIndex,
          skinIndex: skin.displayIndex,
          totalSkins: skin.totalCount,
          marketHashName,
          status: "failed",
          reason: message,
        });

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
            error: message,
          },
        });

        if (isRateLimit) {
          const cascadedMsg = "Rate limited — worker stopped after HTTP 429";
          const currentIdx = assignedSkins.indexOf(skin);
          for (let r = currentIdx + 1; r < assignedSkins.length; r += 1) {
            const remaining = assignedSkins[r];
            const mhn = String(
              remaining.marketHashName ??
                remaining.hash_name ??
                remaining.market_hash_name ??
                "",
            );
            console.log(
              `${workerLabel}   Failed (rate limit cascade): ${mhn}`,
            );

            args.onProgress?.({
              type: "skin:done",
              workerIndex,
              skinIndex: remaining.displayIndex,
              totalSkins: remaining.totalCount,
              marketHashName: mhn,
              status: "failed",
              reason: cascadedMsg,
            });

            results.push({
              originalIndex: remaining.originalIndex,
              result: {
                marketHashName: mhn,
                skinName: extractSkinNameParts(mhn).skinName,
                listingCount: 0,
                decodedCount: 0,
                failedDecodeCount: 0,
                missingInspectCount: 0,
                topResults: [],
                cheapestListing: null,
                skipped: false,
                error: cascadedMsg,
              },
            });
          }
          break;
        }
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
