import { runStickerCharmMulti } from "../../src/MarketScrappers/Sticker/Multi/sticker_scraper_multi_browser.mjs";

/**
 * @param {object} args
 */
export async function runStickerMultiService(args) {
  const result = await runStickerCharmMulti(args);
  const { missingTracker: _m, ...rest } = result;
  return rest;
}
