import path from "node:path";
import ExcelJS from "exceljs";
import {
  UNIVERSAL_STICKER_WEIGHT,
  USD_TO_EUR_RATE,
} from "../Config/constants.mjs";
import { sortedNumericStrings } from "../utils/general.mjs";

export function sortListings(listings, sortBy) {
  return [...listings].sort((a, b) => {
    if (sortBy === "edge") {
      if (b.edge !== a.edge) return b.edge - a.edge;

      const aEff =
        a.efficiency === Number.POSITIVE_INFINITY
          ? Number.MAX_SAFE_INTEGER
          : a.efficiency;
      const bEff =
        b.efficiency === Number.POSITIVE_INFINITY
          ? Number.MAX_SAFE_INTEGER
          : b.efficiency;
      if (bEff !== aEff) return bEff - aEff;

      return a.listingPrice - b.listingPrice;
    }

    const aEff =
      a.efficiency === Number.POSITIVE_INFINITY
        ? Number.MAX_SAFE_INTEGER
        : a.efficiency;
    const bEff =
      b.efficiency === Number.POSITIVE_INFINITY
        ? Number.MAX_SAFE_INTEGER
        : b.efficiency;

    if (bEff !== aEff) return bEff - aEff;
    if (b.edge !== a.edge) return b.edge - a.edge;

    return a.listingPrice - b.listingPrice;
  });
}

export async function writeWorkbook({
  outputPath,
  topResults,
  processedSkins,
  skippedSkins,
  failedSkins,
  allCollectedCount,
  sortBy,
  args,
  missingTracker,
}) {
  const workbook = new ExcelJS.Workbook();

  const resultsWs = workbook.addWorksheet("Results");
  resultsWs.columns = [
    { header: "Skin Name", key: "skinName", width: 42 },
    { header: "Page Found", key: "pageFound", width: 12 },
    { header: "Base Price EUR", key: "basePrice", width: 14 },
    { header: "Listing Price EUR", key: "listingPrice", width: 16 },
    { header: "Stickers Raw Value", key: "stickersRawValue", width: 18 },
    { header: "Charms Value", key: "charmsValue", width: 14 },
    { header: "Rare Charm Pattern", key: "hasRareCharmPattern", width: 18 },
    { header: "Premium Paid", key: "premiumPaid", width: 14 },
    { header: "Attached Value", key: "attachedValue", width: 14 },
    { header: "Edge", key: "edge", width: 12 },
    { header: "Efficiency", key: "efficiency", width: 14 },
    { header: "Sticker Names", key: "stickerNames", width: 60 },
    { header: "Charm Names", key: "charmNames", width: 60 },
    { header: "Listing ID", key: "listingId", width: 20 },
    { header: "Inspect Link", key: "inspectLink", width: 90 },
  ];

  for (const row of topResults) {
    resultsWs.addRow({
      skinName: row.skinName,
      pageFound: row.pageFound,
      basePrice: row.basePrice,
      listingPrice: row.listingPrice,
      stickersRawValue: row.stickersRawValue,
      charmsValue: row.charmsValue,
      hasRareCharmPattern: row.hasRareCharmPattern,
      premiumPaid: row.premiumPaid,
      attachedValue: row.attachedValue,
      edge: row.edge,
      efficiency:
        row.efficiency === Number.POSITIVE_INFINITY ? "INF" : row.efficiency,
      stickerNames: row.stickerNames,
      charmNames: row.charmNames,
      listingId: row.listingId,
      inspectLink: row.inspectLink,
    });
  }

  resultsWs.getRow(1).font = { bold: true };
  resultsWs.views = [{ state: "frozen", ySplit: 1 }];

  for (const key of [
    "basePrice",
    "listingPrice",
    "stickersRawValue",
    "charmsValue",
    "premiumPaid",
    "attachedValue",
    "edge",
  ]) {
    resultsWs.getColumn(key).numFmt = "0.00";
  }

  const processedWs = workbook.addWorksheet("Processed Skins");
  processedWs.columns = [
    { header: "Market Hash Name", key: "marketHashName", width: 60 },
  ];
  for (const skinName of processedSkins) {
    processedWs.addRow({ marketHashName: skinName });
  }
  processedWs.getRow(1).font = { bold: true };

  const skippedWs = workbook.addWorksheet("Skipped Threshold");
  skippedWs.columns = [
    { header: "Market Hash Name", key: "marketHashName", width: 60 },
    { header: "Filtered Listing Count", key: "totalCount", width: 20 },
    { header: "Reason", key: "reason", width: 70 },
  ];
  for (const skipped of skippedSkins) {
    skippedWs.addRow(skipped);
  }
  skippedWs.getRow(1).font = { bold: true };

  const failedWs = workbook.addWorksheet("Failed Skins");
  failedWs.columns = [
    { header: "Market Hash Name", key: "marketHashName", width: 60 },
    { header: "Error", key: "error", width: 100 },
  ];
  for (const failed of failedSkins) {
    failedWs.addRow(failed);
  }
  failedWs.getRow(1).font = { bold: true };

  const missingStickerWs = workbook.addWorksheet("Missing Stickers");
  missingStickerWs.columns = [{ header: "Sticker ID", key: "id", width: 20 }];
  for (const id of sortedNumericStrings(missingTracker.stickers)) {
    missingStickerWs.addRow({ id });
  }
  missingStickerWs.getRow(1).font = { bold: true };

  const missingCharmWs = workbook.addWorksheet("Missing Charms");
  missingCharmWs.columns = [{ header: "Charm ID", key: "id", width: 20 }];
  for (const id of sortedNumericStrings(missingTracker.charms)) {
    missingCharmWs.addRow({ id });
  }
  missingCharmWs.getRow(1).font = { bold: true };

  const missingReelsWs = workbook.addWorksheet("Missing Highlight Reels");
  missingReelsWs.columns = [
    { header: "Highlight Reel ID", key: "id", width: 20 },
  ];
  for (const id of sortedNumericStrings(missingTracker.highlightReels)) {
    missingReelsWs.addRow({ id });
  }
  missingReelsWs.getRow(1).font = { bold: true };

  const summaryWs = workbook.addWorksheet("Summary");
  summaryWs.columns = [
    { header: "Key", key: "key", width: 30 },
    { header: "Value", key: "value", width: 40 },
  ];
  summaryWs.addRows([
    { key: "Total collected listings", value: allCollectedCount },
    { key: "Top exported", value: topResults.length },
    { key: "Sorted by", value: sortBy },
    { key: "Sticker weight", value: UNIVERSAL_STICKER_WEIGHT },
    { key: "USD->EUR rate", value: USD_TO_EUR_RATE },
    { key: "Quality filter", value: args.quality },
    { key: "Missing sticker IDs", value: missingTracker.stickers.size },
    { key: "Missing charm IDs", value: missingTracker.charms.size },
    {
      key: "Missing highlight reel IDs",
      value: missingTracker.highlightReels.size,
    },
  ]);
  summaryWs.getRow(1).font = { bold: true };

  await workbook.xlsx.writeFile(path.resolve(outputPath));
}
