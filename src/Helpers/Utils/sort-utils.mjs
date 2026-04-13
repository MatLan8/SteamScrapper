/**
 * Sort sticker/charm listing rows by edge or efficiency.
 * @param {object[]} listings
 * @param {"edge"|"efficiency"} sortBy
 */
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
