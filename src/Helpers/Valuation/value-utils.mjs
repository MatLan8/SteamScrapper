import { UNIVERSAL_STICKER_WEIGHT } from "../Config/constants.mjs";
import { debugLog } from "../utils/general.mjs";

export function hasRarePattern(ranges, pattern) {
  if (!Array.isArray(ranges) || !Number.isInteger(pattern)) {
    return false;
  }

  let left = 0;
  let right = ranges.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const range = ranges[mid];

    if (!range || typeof range !== "object") {
      return false;
    }

    const start = Number(range.start);
    const end = Number(range.end);

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return false;
    }

    if (pattern < start) {
      right = mid - 1;
    } else if (pattern > end) {
      left = mid + 1;
    } else {
      return true;
    }
  }

  return false;
}

export function valueStickers(decoded, stickerMap, missingTracker, args) {
  const stickers = Array.isArray(decoded?.stickers) ? decoded.stickers : [];
  let total = 0;
  const stickerNames = [];
  const stickerIds = [];

  for (const sticker of stickers) {
    const stickerId = String(sticker?.stickerId ?? "");
    if (!stickerId) continue;

    stickerIds.push(stickerId);

    const record = stickerMap.get(stickerId);
    if (!record) {
      missingTracker.stickers.add(stickerId);
      debugLog(args, `Sticker ID not found in DB: ${stickerId}`);
      stickerNames.push(`Unknown Sticker ${stickerId}`);
      continue;
    }

    total += Number(record.price ?? 0);
    stickerNames.push(record.stickerName);
  }

  return {
    stickersRawValue: total,
    stickerNames,
    stickerIds,
  };
}

export function valueKeychains(
  decoded,
  stickerMap,
  charmMap,
  highlightReelMap,
  missingTracker,
  args,
) {
  const keychains = Array.isArray(decoded?.keychains) ? decoded.keychains : [];
  let charmsValue = 0;
  let hasRareCharmPattern = false;
  const charmDescriptions = [];

  for (const keychain of keychains) {
    const charmId = String(keychain?.stickerId ?? "");

    if (!charmId) continue;

    if (charmId === "37") {
      const wrappedStickerId = String(keychain?.wrappedSticker ?? "");
      const stickerRecord = stickerMap.get(wrappedStickerId);

      if (stickerRecord) {
        charmsValue += Number(stickerRecord.price ?? 0);
        charmDescriptions.push(`Sticker Slab | ${stickerRecord.stickerName}`);
      } else {
        if (wrappedStickerId) {
          missingTracker.stickers.add(wrappedStickerId);
        }
        debugLog(args, `Wrapped sticker not found in DB: ${wrappedStickerId}`);
        charmDescriptions.push(
          `Sticker Slab | Unknown Sticker ${wrappedStickerId}`,
        );
      }

      continue;
    }

    if (charmId === "36" || charmId === "83") {
      const highlightReelId = String(keychain?.highlightReel ?? "");
      const reelRecord = highlightReelMap.get(highlightReelId);

      if (reelRecord) {
        charmsValue += Number(reelRecord.price ?? 0);
        charmDescriptions.push(reelRecord.charmName);
      } else {
        if (highlightReelId) {
          missingTracker.highlightReels.add(highlightReelId);
        }
        debugLog(args, `Highlight reel not found in DB: ${highlightReelId}`);
        charmDescriptions.push(`Unknown Highlight Reel ${highlightReelId}`);
      }

      continue;
    }

    const charmRecord = charmMap.get(charmId);

    if (!charmRecord) {
      missingTracker.charms.add(charmId);
      debugLog(args, `Charm ID not found in DB: ${charmId}`);
      charmDescriptions.push(`Unknown Charm ${charmId}`);
      continue;
    }

    charmsValue += Number(charmRecord.price ?? 0);
    charmDescriptions.push(charmRecord.charmName);

    const pattern = Number(keychain?.pattern);
    if (
      Number.isInteger(pattern) &&
      hasRarePattern(charmRecord.rarePatterns, pattern)
    ) {
      hasRareCharmPattern = true;
    }
  }

  return {
    charmsValue,
    hasRareCharmPattern,
    charmDescriptions,
  };
}

export function computeScores(
  basePriceEuro,
  listingPriceEuro,
  stickersRawValue,
  charmsValue,
) {
  const premiumPaid = listingPriceEuro - basePriceEuro;
  const attachedValue =
    stickersRawValue * UNIVERSAL_STICKER_WEIGHT + charmsValue;
  const edge = attachedValue - premiumPaid;

  let efficiency;

  if (premiumPaid <= 0) {
    efficiency = attachedValue > 0 ? Number.POSITIVE_INFINITY : 0;
  } else {
    efficiency = attachedValue / premiumPaid;
  }

  return {
    premiumPaid,
    attachedValue,
    edge,
    efficiency,
  };
}
