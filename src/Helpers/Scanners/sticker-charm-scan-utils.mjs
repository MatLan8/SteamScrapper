import { decodeLink } from "@csfloat/cs2-inspect-serializer";
import {
  SKIP_LISTING_THRESHOLD,
  TARGET_PAGE_SIZE,
} from "../Config/constants.mjs";
import { debugLog } from "../utils/general.mjs";
import {
  eurosFromUsdCents,
  extractCentsFromPriceText,
} from "../utils/price-utils.mjs";
import {
  assertPageNotRateLimited,
  forcePageSize,
  getSearchResultsMeta,
  goToResultPage,
  waitForListingPageStable,
} from "../Steam/browser-utils.mjs";
import {
  computeScores,
  valueKeychains,
  valueStickers,
} from "../Valuation/value-utils.mjs";

export async function extractListingsFromCurrentPage(
  page,
  skinInfo,
  args,
  seenIds,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
  workerLabel,
  pageNumber,
) {
  await page.waitForTimeout(700);
  await assertPageNotRateLimited(page, `${workerLabel} page ${pageNumber}`);

  const listingRows = page.locator(".market_listing_row[id^='listing_']");
  const totalRows = await listingRows.count();

  debugLog(
    args,
    `${workerLabel}    page=${pageNumber} visible listing rows=${totalRows}`,
  );

  const results = [];
  let shouldStopByPrice = false;

  for (let i = 0; i < totalRows; i += 1) {
    const row = listingRows.nth(i);
    const idAttr = await row.getAttribute("id");
    const listingId =
      idAttr?.replace(/^listing_/, "") ?? `row_${pageNumber}_${i}`;

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

    const listingPriceCents = extractCentsFromPriceText(priceText);
    const listingPriceEuro = eurosFromUsdCents(listingPriceCents);

    if (
      args.maxPrice !== null &&
      listingPriceEuro > 0 &&
      listingPriceEuro > args.maxPrice
    ) {
      shouldStopByPrice = true;
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
      debugLog(
        args,
        `${workerLabel}    decode failed for listingId=${listingId}: ${
          error?.message || String(error)
        }`,
      );
      continue;
    }

    const stickerValueData = valueStickers(
      decoded,
      stickerMap,
      missingTracker,
      args,
    );

    const charmValueData = valueKeychains(
      decoded,
      stickerMap,
      charmMap,
      highlightReelMap,
      missingTracker,
      args,
    );

    const hasAnyAttachments =
      stickerValueData.stickerNames.length > 0 ||
      charmValueData.charmDescriptions.length > 0;

    if (!hasAnyAttachments) {
      continue;
    }

    const scoreData = computeScores(
      skinInfo.basePriceEuro,
      listingPriceEuro,
      stickerValueData.stickersRawValue,
      charmValueData.charmsValue,
    );

    results.push({
      skinName: skinInfo.marketHashName,
      pageFound: pageNumber,
      listingId,
      basePrice: skinInfo.basePriceEuro,
      listingPrice: listingPriceEuro,
      stickersRawValue: stickerValueData.stickersRawValue,
      charmsValue: charmValueData.charmsValue,
      hasRareCharmPattern: charmValueData.hasRareCharmPattern,
      premiumPaid: scoreData.premiumPaid,
      attachedValue: scoreData.attachedValue,
      edge: scoreData.edge,
      efficiency: scoreData.efficiency,
      stickerNames: stickerValueData.stickerNames.join(" ; "),
      charmNames: charmValueData.charmDescriptions.join(" ; "),
      inspectLink,
    });
  }

  return {
    results,
    shouldStopByPrice,
  };
}

export async function scanSkinPage(
  page,
  skinInfo,
  args,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
  workerLabel,
) {
  debugLog(args, `${workerLabel}  Scanning skin: ${skinInfo.marketHashName}`);

  const filteredUrl = `${skinInfo.listingUrl}?filter=sticker`;

  await page.goto(filteredUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await waitForListingPageStable(page, args);
  await forcePageSize(page, args, TARGET_PAGE_SIZE);

  const meta = await getSearchResultsMeta(page);

  if (!meta.hasSearchResults) {
    await assertPageNotRateLimited(
      page,
      `${workerLabel} no search results object`,
    );
    throw new Error(
      `${workerLabel} Steam listing page missing g_oSearchResults for ${skinInfo.marketHashName}`,
    );
  }

  debugLog(
    args,
    `${workerLabel}    filtered totalCount=${meta.totalCount} pageSize=${meta.pageSize} currentPage=${meta.currentPage}`,
  );

  if (meta.totalCount > SKIP_LISTING_THRESHOLD) {
    return {
      marketHashName: skinInfo.marketHashName,
      scannedListings: [],
      skipped: true,
      skippedReason: `Filtered listing count ${meta.totalCount} exceeded threshold ${SKIP_LISTING_THRESHOLD}`,
      totalCount: meta.totalCount,
    };
  }

  const effectivePageSize = meta.pageSize > 0 ? meta.pageSize : 10;
  const totalPages =
    meta.totalCount > 0 ? Math.ceil(meta.totalCount / effectivePageSize) : 1;

  const seenIds = new Set();
  const scannedListings = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) {
      await goToResultPage(page, args, pageIndex);
    }

    const { results, shouldStopByPrice } = await extractListingsFromCurrentPage(
      page,
      skinInfo,
      args,
      seenIds,
      stickerMap,
      charmMap,
      highlightReelMap,
      missingTracker,
      workerLabel,
      pageIndex + 1,
    );

    scannedListings.push(...results);

    if (shouldStopByPrice) {
      debugLog(
        args,
        `${workerLabel}    stopping ${skinInfo.marketHashName} because listing price exceeded maxprice`,
      );
      break;
    }

    if (results.length === 0) {
      debugLog(
        args,
        `${workerLabel}    no useful listings on page ${pageIndex + 1}, stopping skin`,
      );
      break;
    }
  }

  return {
    marketHashName: skinInfo.marketHashName,
    scannedListings,
    skipped: false,
    totalCount: meta.totalCount,
  };
}
