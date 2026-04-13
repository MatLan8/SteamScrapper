import { fileURLToPath } from "node:url";
import path from "node:path";

export const SEARCH_URL = "https://steamcommunity.com/market/search/render/";
export const APPID = 730;
export const CURRENCY = 3;
export const USD_TO_EUR_RATE = 0.87;
export const SEARCH_PAGE_SIZE = 100;
export const TARGET_PAGE_SIZE = 100;
export const SKIP_LISTING_THRESHOLD = 1000;

export const DEFAULT_TOP = 25;
export const DEFAULT_OUT = "steam_sticker_charm_scan_results.xlsx";
export const DEFAULT_WAIT_MS = 1200;
export const DEFAULT_WORKERS = 3;
export const DEFAULT_QUALITY = "normal";

export const UNIVERSAL_STICKER_WEIGHT = 0.1;

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

export const WEAR_MAP = {
  fn: {
    display: "Factory New",
    suffix: "(Factory New)",
    searchTag: "tag_WearCategory0",
  },
  mw: {
    display: "Minimal Wear",
    suffix: "(Minimal Wear)",
    searchTag: "tag_WearCategory1",
  },
  ft: {
    display: "Field-Tested",
    suffix: "(Field-Tested)",
    searchTag: "tag_WearCategory2",
  },
  ww: {
    display: "Well-Worn",
    suffix: "(Well-Worn)",
    searchTag: "tag_WearCategory3",
  },
  bs: {
    display: "Battle-Scarred",
    suffix: "(Battle-Scarred)",
    searchTag: "tag_WearCategory4",
  },
};

export const QUALITY_VALUES = new Set(["normal", "st", "both"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const STICKER_DB_PATH = path.resolve(
  __dirname,
  "../../../Database/sticker_db.json",
);

export const CHARM_DB_PATH = path.resolve(
  __dirname,
  "../../../Database/charm_db.json",
);
