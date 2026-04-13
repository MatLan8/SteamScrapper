import { runFloatSinglePlaywright } from "../../src/MarketScrappers/Float/Single/float_scraper_single_browser.mjs";

/**
 * @param {object} args
 */
export async function runFloatSinglePlaywrightService(args) {
  const result = await runFloatSinglePlaywright(args);
  const { allResults: _a, ...rest } = result;
  return rest;
}
