import fs from "node:fs/promises";
import { CHARM_DB_PATH, STICKER_DB_PATH } from "../Config/constants.mjs";

export async function loadStickerDb() {
  const raw = await fs.readFile(STICKER_DB_PATH, "utf8");
  const data = JSON.parse(raw);

  const stickerMap = new Map();

  for (const [id, value] of Object.entries(data)) {
    stickerMap.set(String(id), {
      id: String(id),
      stickerName: String(value.stickerName ?? `Unknown Sticker ${id}`),
      price: Number(value.price ?? 0),
      source: value.source ?? "",
    });
  }

  return { stickerMap };
}

export async function loadCharmDb() {
  const raw = await fs.readFile(CHARM_DB_PATH, "utf8");
  const data = JSON.parse(raw);

  const charmMap = new Map();
  const highlightReelMap = new Map();

  for (const [id, value] of Object.entries(data.charms ?? {})) {
    charmMap.set(String(id), {
      id: String(id),
      charmName: String(value.charmName ?? `Unknown Charm ${id}`),
      price: Number(value.price ?? 0),
      source: value.source ?? "",
      rarePatterns: Array.isArray(value.rarePatterns) ? value.rarePatterns : [],
    });
  }

  for (const [id, value] of Object.entries(data.highlight_reels ?? {})) {
    highlightReelMap.set(String(id), {
      id: String(id),
      charmName: String(value.charmName ?? `Unknown Highlight Reel ${id}`),
      price: Number(value.price ?? 0),
      source: value.source ?? "",
    });
  }

  return { charmMap, highlightReelMap };
}
