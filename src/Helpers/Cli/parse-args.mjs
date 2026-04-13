import {
  DEFAULT_FLOAT_OUT,
  DEFAULT_FLOAT_TOP,
  DEFAULT_FLOAT_WAIT_MS,
  DEFAULT_MAX_WINDOWS,
  DEFAULT_OUT,
  DEFAULT_QUALITY,
  DEFAULT_TOP,
  DEFAULT_WAIT_MS,
  DEFAULT_WORKERS,
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  FLOAT_WEAPON_QUALITY_VALUES,
  STICKER_QUALITY_VALUES,
  WEAR_MAP,
} from "../Config/constants.mjs";
import { validateSteamListingUrl } from "../Utils/url-utils.mjs";

const FLOAT_WEAR_KEYS = new Set(["fn", "bs"]);

/**
 * Sticker/charm multi scrapper CLI (weapon + conditions + sticker DB valuation).
 */
export function parseWeaponSearchArgs(argv) {
  const args = {
    weapon: null,
    conditions: Object.keys(WEAR_MAP),
    quality: DEFAULT_QUALITY,
    maxPrice: null,
    top: DEFAULT_TOP,
    out: DEFAULT_OUT,
    workers: DEFAULT_WORKERS,
    maxWindows: DEFAULT_WORKERS,
    sortBy: "efficiency",
    debug: false,
    waitMs: DEFAULT_WAIT_MS,
    cookie: null,
    headful: true,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    switch (key) {
      case "--weapon":
        args.weapon = next;
        i += 1;
        break;

      case "--condition": {
        const values = [];
        let j = i + 1;

        while (j < argv.length && !argv[j].startsWith("--")) {
          values.push(String(argv[j]).toLowerCase());
          j += 1;
        }

        if (values.length === 0) {
          throw new Error(
            "--condition requires one or more values: fn mw ft ww bs",
          );
        }

        args.conditions = values;
        i = j - 1;
        break;
      }

      case "--quality":
        args.quality = String(next).toLowerCase();
        i += 1;
        break;

      case "--maxprice":
        args.maxPrice = Number.parseFloat(next);
        i += 1;
        break;

      case "--top":
        args.top = Number.parseInt(next, 10);
        i += 1;
        break;

      case "--out":
        args.out = next;
        i += 1;
        break;

      case "--workers":
        args.workers = Number.parseInt(next, 10);
        args.maxWindows = args.workers;
        i += 1;
        break;

      case "--edge":
        args.sortBy = "edge";
        break;

      case "--efficiency":
        args.sortBy = "efficiency";
        break;

      case "--debug":
        args.debug = true;
        break;

      case "--wait-ms":
        args.waitMs = Number.parseInt(next, 10);
        i += 1;
        break;

      case "--cookie":
        args.cookie = next;
        i += 1;
        break;

      case "--headful":
        args.headful = true;
        break;

      case "--headless":
        args.headful = false;
        break;

      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.weapon) {
    throw new Error("Missing required argument: --weapon");
  }

  for (const condition of args.conditions) {
    if (!(condition in WEAR_MAP)) {
      throw new Error(
        `Invalid --condition value "${condition}". Allowed: fn mw ft ww bs`,
      );
    }
  }

  if (!STICKER_QUALITY_VALUES.has(args.quality)) {
    throw new Error(
      `Invalid --quality value "${args.quality}". Allowed: normal st both`,
    );
  }

  args.conditions = [...new Set(args.conditions)];

  if (
    args.maxPrice !== null &&
    (!Number.isFinite(args.maxPrice) || args.maxPrice < 0)
  ) {
    throw new Error("--maxprice must be a non-negative number");
  }

  validateCommonArgs(args);
  return args;
}

/**
 * Float multi weapon scanner: `--weapon`, `--wear` fn|bs, `--mode`, optional `--quality` normal|st|sv.
 */
export function parseFloatMultiArgs(argv) {
  const args = {
    weapon: null,
    wear: null,
    mode: null,
    top: DEFAULT_FLOAT_TOP,
    out: DEFAULT_FLOAT_OUT,
    language: DEFAULT_LANGUAGE,
    cookie: null,
    waitMs: DEFAULT_FLOAT_WAIT_MS,
    headful: true,
    maxSkins: null,
    maxListingsPerSkin: null,
    workers: DEFAULT_WORKERS,
    maxWindows: DEFAULT_WORKERS,
    debug: false,
    quality: "normal",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    switch (key) {
      case "--weapon":
        args.weapon = next;
        i += 1;
        break;
      case "--wear":
        args.wear = next?.toLowerCase();
        i += 1;
        break;
      case "--mode":
        args.mode = next?.toLowerCase();
        i += 1;
        break;
      case "--top":
        args.top = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--out":
        args.out = next;
        i += 1;
        break;
      case "--language":
        args.language = next;
        i += 1;
        break;
      case "--cookie":
        args.cookie = next;
        i += 1;
        break;
      case "--wait-ms":
        args.waitMs = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--max-skins":
        args.maxSkins = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--max-listings-per-skin":
        args.maxListingsPerSkin = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--workers":
        args.workers = Number.parseInt(next, 10);
        args.maxWindows = args.workers;
        i += 1;
        break;
      case "--headful":
        args.headful = true;
        break;
      case "--headless":
        args.headful = false;
        break;
      case "--debug":
        args.debug = true;
        break;
      case "--quality":
        args.quality = next?.toLowerCase();
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.weapon) {
    throw new Error("Missing required argument: --weapon");
  }

  if (!FLOAT_WEAPON_QUALITY_VALUES.has(args.quality)) {
    throw new Error("--quality must be one of: normal, st, sv");
  }

  if (!args.wear || !FLOAT_WEAR_KEYS.has(args.wear)) {
    throw new Error("--wear must be either 'fn' or 'bs'");
  }

  if (!["lowest", "highest"].includes(args.mode)) {
    throw new Error("--mode must be either 'lowest' or 'highest'");
  }

  validateCommonArgs(args);

  if (
    args.maxSkins !== null &&
    (!Number.isInteger(args.maxSkins) || args.maxSkins <= 0)
  ) {
    throw new Error("--max-skins must be a positive integer");
  }

  if (
    args.maxListingsPerSkin !== null &&
    (!Number.isInteger(args.maxListingsPerSkin) || args.maxListingsPerSkin <= 0)
  ) {
    throw new Error("--max-listings-per-skin must be a positive integer");
  }

  return args;
}

/**
 * Single listing URL scrappers (Playwright or HTTP endpoint).
 */
export function parseSingleUrlArgs(argv) {
  const args = {
    url: null,
    maxWindows: DEFAULT_MAX_WINDOWS,
    workers: DEFAULT_MAX_WINDOWS,
    mode: "lowest",
    top: DEFAULT_FLOAT_TOP,
    waitMs: DEFAULT_FLOAT_WAIT_MS,
    cookie: null,
    headful: false,
    debug: false,
    currency: DEFAULT_CURRENCY,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];

    switch (key) {
      case "--url":
        args.url = next;
        i += 1;
        break;
      case "--max-windows":
        args.maxWindows = Number.parseInt(next, 10);
        args.workers = args.maxWindows;
        i += 1;
        break;
      case "--mode":
        args.mode = next?.toLowerCase();
        i += 1;
        break;
      case "--top":
        args.top = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--wait-ms":
        args.waitMs = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--cookie":
        args.cookie = next;
        i += 1;
        break;
      case "--currency":
        args.currency = Number.parseInt(next, 10);
        i += 1;
        break;
      case "--headful":
        args.headful = true;
        break;
      case "--headless":
        args.headful = false;
        break;
      case "--debug":
        args.debug = true;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.url) {
    throw new Error("Missing required argument: --url");
  }

  const urlCheck = validateSteamListingUrl(args.url);
  if (!urlCheck.ok) {
    throw new Error(urlCheck.message);
  }

  if (!Number.isInteger(args.maxWindows) || args.maxWindows <= 0) {
    throw new Error("--max-windows must be a positive integer");
  }

  if (!["lowest", "highest"].includes(args.mode)) {
    throw new Error("--mode must be either 'lowest' or 'highest'");
  }

  if (!Number.isInteger(args.top) || args.top <= 0) {
    throw new Error("--top must be a positive integer");
  }

  if (!Number.isInteger(args.waitMs) || args.waitMs < 0) {
    throw new Error("--wait-ms must be a non-negative integer");
  }

  if (!Number.isInteger(args.currency) || args.currency <= 0) {
    throw new Error("--currency must be a positive integer");
  }

  return args;
}

/**
 * @param {object} args
 * @param {number} args.top
 * @param {number} args.workers
 * @param {number} args.waitMs
 */
export function validateCommonArgs(args) {
  if (!Number.isInteger(args.top) || args.top <= 0) {
    throw new Error("--top must be a positive integer");
  }

  if (!Number.isInteger(args.workers) || args.workers <= 0) {
    throw new Error("--workers must be a positive integer");
  }

  if (!Number.isInteger(args.waitMs) || args.waitMs < 0) {
    throw new Error("--wait-ms must be a non-negative integer");
  }
}

/** @deprecated Use parseWeaponSearchArgs */
export function parseArgs(argv) {
  return parseWeaponSearchArgs(argv);
}
