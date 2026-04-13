import type {
  FloatMultiResults,
  FloatSingleResults,
} from "@/types";

export type ResultRow = {
  skinName?: string;
  marketHashName: string;
  floatValue: number;
  priceText: string | null;
  listingId: string;
  page?: number;
  inspectLink?: string | null;
};

export function mergeMultiTopResults(
  results: FloatMultiResults,
  mode: "lowest" | "highest",
  globalTop: number,
): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const skin of results.skinResults ?? []) {
    if (skin.skipped) continue;
    for (const row of skin.topResults ?? []) {
      rows.push({
        skinName: skin.skinName,
        marketHashName: skin.marketHashName,
        floatValue: row.floatValue,
        priceText: row.priceText ?? null,
        listingId: String(row.listingId),
        page: row.page,
        inspectLink: row.inspectLink,
      });
    }
  }
  rows.sort((a, b) => {
    if (mode === "lowest") {
      if (a.floatValue !== b.floatValue) return a.floatValue - b.floatValue;
      return String(a.priceText ?? "").localeCompare(String(b.priceText ?? ""));
    }
    if (a.floatValue !== b.floatValue) return b.floatValue - a.floatValue;
    return String(a.priceText ?? "").localeCompare(String(b.priceText ?? ""));
  });
  return rows.slice(0, globalTop);
}

export function singleResultsToRows(
  results: FloatSingleResults,
): ResultRow[] {
  const mhn = results.summary?.marketHashName ?? "";
  return (results.topResults ?? []).map((r) => ({
    marketHashName: mhn,
    floatValue: r.floatValue,
    priceText: r.priceText,
    listingId: String(r.listingId),
    page: r.page ?? (r.start != null ? Math.floor(r.start / 100) + 1 : undefined),
    inspectLink: r.inspectLink,
  }));
}
