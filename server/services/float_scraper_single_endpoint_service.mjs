import { runFloatSingleEndpoint } from "../../src/MarketScrappers/Float/Single/float_scraper_single_endpoint.mjs";

/**
 * @param {object} args
 */
export async function runFloatSingleEndpointService(args) {
  const result = await runFloatSingleEndpoint(args);
  const { allResults: _a, ...rest } = result;
  return rest;
}
