const APP = 730;

export function steamListingUrl(
  marketHashName: string,
  listingId: string,
): string {
  const encoded = encodeURIComponent(marketHashName);
  return `https://steamcommunity.com/market/listings/${APP}/${encoded}#listing_${listingId}`;
}
