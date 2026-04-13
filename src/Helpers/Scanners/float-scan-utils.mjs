import { decodeLink } from "@csfloat/cs2-inspect-serializer";
import {
  SKIP_LISTING_THRESHOLD,
  TARGET_PAGE_SIZE,
} from "../Config/constants.mjs";
import {
  buildListingPageUrl,
  extractSkinNameParts,
} from "../Steam/market-utils.mjs";
import {
  extractCentsFromPriceText,
  extractCentsFromListingInfo,
} from "../utils/price-utils.mjs";
import {
  extractPriceTextFromListingInfo,
  extractInspectLinksFromResultsHtml,
} from "../Steam/endpoint-utils.mjs";

export function rankFloatListings(listings, mode, top) {
  const sorted = [...listings].sort((a, b) => {
    if (mode === "lowest") {
      if (a.floatValue !== b.floatValue) return a.floatValue - b.floatValue;
      return a.priceCents - b.priceCents;
    }

    if (a.floatValue !== b.floatValue) return b.floatValue - a.floatValue;
    return a.priceCents - b.priceCents;
  });

  return sorted.slice(0, top);
}

async function waitForListingPageStableSoft(page, args) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(args.waitMs);

  await page
    .locator(".market_listing_row[id^='listing_']")
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
}

async function getSearchResultsMeta(page) {
  return page.evaluate(() => {
    const g = globalThis.g_oSearchResults;

    return {
      hasSearchResults: !!g,
      pageSize: Number(g?.m_cPageSize ?? 0),
      totalCount: Number(g?.m_cTotalCount ?? 0),
      currentPage: Number(g?.m_iCurrentPage ?? 0),
    };
  });
}

async function getFirstVisibleListingId(page) {
  const row = page.locator(".market_listing_row[id^='listing_']").first();
  return (await row.getAttribute("id").catch(() => null)) || "";
}

async function floatSoftForcePageSize(page, args, size = TARGET_PAGE_SIZE) {
  await page.evaluate(
    ({ size }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.m_cPageSize = size;
      g.GoToPage(0, true);
      return true;
    },
    { size },
  );

  await page.waitForTimeout(args.waitMs);

  await page
    .waitForFunction(
      ({ size }) => {
        const g = globalThis.g_oSearchResults;
        return !!g && Number(g.m_cPageSize) === size;
      },
      { size },
      { timeout: 10000 },
    )
    .catch(() => {});
}

async function floatSoftGoToResultPage(page, args, pageIndex) {
  const beforeFirstId = await getFirstVisibleListingId(page);

  await page.evaluate(
    ({ pageIndex }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.GoToPage(pageIndex, true);
      return true;
    },
    { pageIndex },
  );

  const success = await page
    .waitForFunction(
      ({ beforeFirstId, pageIndex }) => {
        const g = globalThis.g_oSearchResults;
        const first = document.querySelector(
          ".market_listing_row[id^='listing_']",
        );
        const currentId = first?.id || "";
        const currentPage = Number(g?.m_iCurrentPage ?? -1);

        if (pageIndex === 0) {
          return currentPage === 0 && !!currentId;
        }

        return (
          currentPage === pageIndex &&
          !!currentId &&
          currentId !== beforeFirstId
        );
      },
      { beforeFirstId, pageIndex },
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!success) {
    return false;
  }

  await page.waitForTimeout(args.waitMs);
  return true;
}

/**
 * Float multi: extract all rows on current page (no index filter).
 */
export async function extractFloatListingsFromCurrentPage(
  page,
  args,
  seenIds,
  workerLabel,
  pageIndex = 0,
) {
  await page.waitForTimeout(800);

  const listingRows = page.locator(".market_listing_row[id^='listing_']");
  const totalRows = await listingRows.count();
  const meta = await getSearchResultsMeta(page);

  if (args.debug) {
    console.log(
      `${workerLabel}    page=${meta.currentPage + 1} pageSize=${meta.pageSize} visible listing rows=${totalRows}`,
    );
  }

  const results = [];

  for (let i = 0; i < totalRows; i += 1) {
    if (args.maxListingsPerSkin && seenIds.size >= args.maxListingsPerSkin) {
      break;
    }

    const row = listingRows.nth(i);
    const idAttr = await row.getAttribute("id");
    const listingId = idAttr?.replace(/^listing_/, "") ?? `row_${i}`;

    if (seenIds.has(listingId)) continue;
    seenIds.add(listingId);

    let priceText = "";
    const priceLocators = [
      row.locator(".market_listing_price.market_listing_price_with_fee"),
      row.locator(".market_listing_their_price .market_table_value span"),
      row.locator(".market_listing_price"),
    ];

    for (const locator of priceLocators) {
      if (await locator.count()) {
        priceText = (await locator.first().innerText()).trim();
        if (priceText) break;
      }
    }

    const priceCents = extractCentsFromPriceText(priceText);
    if (
      args.maxPrice != null &&
      priceCents > 0 &&
      priceCents > args.maxPrice * 100
    ) {
      break;
    }

    const inspectLink = await row
      .locator('.market_listing_row_action a[href^="steam://"]')
      .first()
      .getAttribute("href")
      .catch(() => null);

    if (!inspectLink) continue;

    let decoded;
    try {
      decoded = decodeLink(inspectLink);
    } catch (error) {
      if (args.debug) {
        console.log(
          `${workerLabel}    decode failed for listingId=${listingId}: ${error?.message || String(error)}`,
        );
      }
      continue;
    }

    const floatValue = Number(decoded?.paintwear);
    if (!Number.isFinite(floatValue)) continue;

    results.push({
      listingId,
      priceText,
      priceCents,
      floatValue,
      inspectLink,
      page: pageIndex + 1,
    });

    if (args.debug && results.length <= 3) {
      console.log(
        `${workerLabel}    sample row ${results.length}: listingId=${listingId} price="${priceText}" float=${floatValue}`,
      );
    }
  }

  return results;
}

const RATE_LIMIT_PREFIX = "RATE_LIMITED:";

function throwIfRateLimited(rateLimited) {
  if (rateLimited) {
    throw new Error(
      `${RATE_LIMIT_PREFIX} Too many requests (HTTP 429) during pagination`,
    );
  }
}

export async function floatScanSkinPage(page, marketHashName, args, workerLabel) {
  if (args.debug) {
    console.log(`${workerLabel}  Scanning skin: ${marketHashName}`);
  }

  const url = buildListingPageUrl(marketHashName);

  let rateLimited = false;
  const onResponse = (resp) => {
    if (resp.status() === 429) rateLimited = true;
  };
  page.on("response", onResponse);

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    if (response && response.status() === 429) {
      throw new Error(`${RATE_LIMIT_PREFIX} Too many requests (HTTP 429)`);
    }
    throwIfRateLimited(rateLimited);

    await waitForListingPageStableSoft(page, args);
    throwIfRateLimited(rateLimited);

    await floatSoftForcePageSize(page, args, TARGET_PAGE_SIZE);
    throwIfRateLimited(rateLimited);

    const meta = await getSearchResultsMeta(page);
    throwIfRateLimited(rateLimited);

    if (args.debug) {
      console.log(
        `${workerLabel}    after page-size apply: totalCount=${meta.totalCount} pageSize=${meta.pageSize} currentPage=${meta.currentPage}`,
      );
    }

    // #region agent log
    fetch('http://127.0.0.1:7886/ingest/4e27bff3-ffff-4c42-9349-997b4cf16f56',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'af75e4'},body:JSON.stringify({sessionId:'af75e4',location:'float-scan-utils.mjs:284',message:'skip threshold check',data:{marketHashName,totalCount:meta.totalCount,maxListingsPerSkin:args.maxListingsPerSkin,SKIP_LISTING_THRESHOLD,condResult:!args.maxListingsPerSkin&&meta.totalCount>SKIP_LISTING_THRESHOLD},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    if (
      !args.maxListingsPerSkin &&
      meta.totalCount > SKIP_LISTING_THRESHOLD
    ) {
      return {
        marketHashName,
        skinName: extractSkinNameParts(marketHashName).skinName,
        listingCount: 0,
        decodedCount: 0,
        failedDecodeCount: 0,
        missingInspectCount: 0,
        topResults: [],
        cheapestListing: null,
        skipped: true,
        skippedReason: `Skipped because listing count ${meta.totalCount} is greater than ${SKIP_LISTING_THRESHOLD}`,
        totalCount: meta.totalCount,
      };
    }

    const effectivePageSize = meta.pageSize > 0 ? meta.pageSize : 10;
    const totalPages =
      meta.totalCount > 0 ? Math.ceil(meta.totalCount / effectivePageSize) : 1;

    const listings = [];
    const seenIds = new Set();
    let missingInspectCount = 0;
    const failedDecodeCount = 0;

    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      if (args.maxListingsPerSkin && seenIds.size >= args.maxListingsPerSkin) {
        break;
      }

      if (pageIndex > 0) {
        if (args.debug) {
          console.log(`${workerLabel}    going to page index ${pageIndex}`);
        }

        const moved = await floatSoftGoToResultPage(page, args, pageIndex);
        throwIfRateLimited(rateLimited);
        if (!moved) {
          if (args.debug) {
            console.log(
              `${workerLabel}    failed to move to page index ${pageIndex}, stopping this skin`,
            );
          }
          break;
        }
      }

      const beforeCount = listings.length;
      const beforeSeen = seenIds.size;

      const currentPageResults = await extractFloatListingsFromCurrentPage(
        page,
        args,
        seenIds,
        workerLabel,
        pageIndex,
      );
      throwIfRateLimited(rateLimited);

      listings.push(...currentPageResults);

      const seenThisPage = seenIds.size - beforeSeen;
      const addedThisPage = listings.length - beforeCount;

      if (seenThisPage > addedThisPage) {
        missingInspectCount += seenThisPage - addedThisPage;
      }

      if (args.debug) {
        console.log(
          `${workerLabel}    collected so far: ${seenIds.size} listings after page index ${pageIndex}`,
        );
      }

      args.onProgress?.({
        type: "page:done",
        marketHashName,
        currentPage: pageIndex + 1,
        totalPages,
        listingsCollected: listings.length,
      });

      if (currentPageResults.length === 0) {
        if (args.debug) {
          console.log(
            `${workerLabel}    no new listings found on page index ${pageIndex}, stopping this skin`,
          );
        }
        break;
      }
    }

    const { skinName } = extractSkinNameParts(marketHashName);
    const topResults = rankFloatListings(listings, args.mode, args.top);
    const cheapestListing = listings.length > 0 ? listings[0] : null;

    return {
      marketHashName,
      skinName,
      listingCount: listings.length,
      decodedCount: listings.length,
      failedDecodeCount,
      missingInspectCount,
      topResults,
      cheapestListing,
      skipped: false,
      totalCount: meta.totalCount,
    };
  } finally {
    page.removeListener("response", onResponse);
  }
}

/**
 * HTTP render payload -> decoded float rows (used by endpoint scrapper).
 */
export function extractFloatListingsFromRenderPayload(
  data,
  args,
  start,
  workerLabel,
) {
  const listinginfo = data.listinginfo ?? {};
  const listingIds = Object.keys(listinginfo);
  const inspectLinksByListingId = extractInspectLinksFromResultsHtml(
    data.results_html,
  );

  const results = [];
  const stats = {
    returnedListings: listingIds.length,
    missingInspectLink: 0,
    decodeFailed: 0,
    missingFloat: 0,
    collected: 0,
  };

  const currencyId = args.currency;

  for (const listingId of listingIds) {
    const listing = listinginfo[listingId];
    const inspectLink = inspectLinksByListingId.get(listingId) ?? null;

    if (!inspectLink) {
      stats.missingInspectLink += 1;
      continue;
    }

    const priceCents = extractCentsFromListingInfo(listing);
    if (
      args.maxPrice != null &&
      priceCents > 0 &&
      priceCents > args.maxPrice * 100
    ) {
      continue;
    }

    let decoded;
    try {
      decoded = decodeLink(inspectLink);
    } catch (error) {
      if (args.debug) {
        console.log(
          `${workerLabel}: decode failed for listingId=${listingId} start=${start}: ${error?.message || String(error)}`,
        );
      }
      stats.decodeFailed += 1;
      continue;
    }

    const floatValue = Number(decoded?.paintwear);

    if (!Number.isFinite(floatValue)) {
      stats.missingFloat += 1;
      continue;
    }

    results.push({
      listingId,
      inspectLink,
      priceText: extractPriceTextFromListingInfo(listing, currencyId),
      priceCents,
      floatValue,
      start,
    });

    stats.collected += 1;
  }

  return { results, stats };
}

/** Single listing URL: split global listing indices across browser workers. */
export function buildListingBrowserWorkerPlan(totalListings, maxWindows, pageSize) {
  const workerCount = Math.min(maxWindows, Math.max(1, totalListings));
  const chunkSize = Math.ceil(totalListings / workerCount);
  const workers = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const listingStart = workerIndex * chunkSize;
    if (listingStart >= totalListings) break;

    const listingEnd = Math.min(
      totalListings - 1,
      listingStart + chunkSize - 1,
    );
    const pageStart = Math.floor(listingStart / pageSize);
    const pageEnd = Math.floor(listingEnd / pageSize);

    workers.push({
      workerIndex,
      listingStart,
      listingEnd,
      pageStart,
      pageEnd,
      assignedListings: listingEnd - listingStart + 1,
      assignedPages: pageEnd - pageStart + 1,
    });
  }

  return {
    totalListings,
    workerCount: workers.length,
    chunkSize,
    workers,
  };
}

export async function goToResultPageWithRetry(
  page,
  args,
  pageIndex,
  retries = 2,
) {
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const moved = await floatSoftGoToResultPage(page, args, pageIndex);

    if (moved) {
      return true;
    }

    if (args.debug) {
      console.log(
        `    retrying page ${pageIndex + 1}, attempt ${attempt}/${retries + 1}`,
      );
    }

    await page.waitForTimeout(args.waitMs * 2);
  }

  return false;
}

/**
 * Single listing URL: extract rows whose global index is in [listingStart, listingEnd].
 */
export async function extractFloatListingsFromCurrentPageInRange(
  page,
  args,
  pageIndex,
  pageSize,
  listingStart,
  listingEnd,
  globalSeenIds,
) {
  await page.waitForTimeout(800);

  const listingRows = page.locator(".market_listing_row[id^='listing_']");
  const totalRows = await listingRows.count();
  const results = [];
  const pageIds = new Set();

  const stats = {
    visibleRows: totalRows,
    outOfRangeSkipped: 0,
    duplicateSkipped: 0,
    missingInspectLink: 0,
    decodeFailed: 0,
    missingFloat: 0,
    collected: 0,
  };

  if (args.debug) {
    console.log(
      `    page ${pageIndex + 1}: visible rows=${totalRows}, range=${listingStart}-${listingEnd}`,
    );
  }

  for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
    const globalListingIndex = pageIndex * pageSize + rowIndex;

    if (globalListingIndex < listingStart || globalListingIndex > listingEnd) {
      stats.outOfRangeSkipped += 1;
      continue;
    }

    const row = listingRows.nth(rowIndex);
    const idAttr = await row.getAttribute("id");
    const listingId =
      idAttr?.replace(/^listing_/, "") ?? `page${pageIndex}_row${rowIndex}`;

    if (pageIds.has(listingId) || globalSeenIds.has(listingId)) {
      stats.duplicateSkipped += 1;
      continue;
    }

    let priceText = "";
    const priceLocators = [
      row.locator(".market_listing_price.market_listing_price_with_fee"),
      row.locator(".market_listing_their_price .market_table_value span"),
      row.locator(".market_listing_price"),
    ];

    for (const locator of priceLocators) {
      if (await locator.count()) {
        priceText = (await locator.first().innerText()).trim();
        if (priceText) break;
      }
    }

    const priceCents = extractCentsFromPriceText(priceText);
    if (
      args.maxPrice != null &&
      priceCents > 0 &&
      priceCents > args.maxPrice * 100
    ) {
      break;
    }

    const inspectLink = await row
      .locator('.market_listing_row_action a[href^="steam://"]')
      .first()
      .getAttribute("href")
      .catch(() => null);

    if (!inspectLink) {
      stats.missingInspectLink += 1;
      continue;
    }

    let decoded;
    try {
      decoded = decodeLink(inspectLink);
    } catch (error) {
      if (args.debug) {
        console.log(
          `    failed to decode inspect link for listingId=${listingId}: ${error?.message || String(error)}`,
        );
      }
      stats.decodeFailed += 1;
      continue;
    }

    const floatValue = Number(decoded?.paintwear);

    if (!Number.isFinite(floatValue)) {
      stats.missingFloat += 1;
      continue;
    }

    pageIds.add(listingId);

    results.push({
      listingId,
      inspectLink,
      priceText,
      priceCents,
      floatValue,
      page: pageIndex + 1,
      globalListingIndex,
    });

    stats.collected += 1;
  }

  return {
    results,
    pageIds,
    stats,
  };
}

export {
  waitForListingPageStableSoft,
  floatSoftForcePageSize,
  floatSoftGoToResultPage,
  getSearchResultsMeta,
};

