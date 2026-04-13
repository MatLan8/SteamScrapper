import {
  DEFAULT_CURRENCY,
  DEFAULT_FLOAT_TOP,
  DEFAULT_FLOAT_WAIT_MS,
  DEFAULT_LANGUAGE,
  DEFAULT_MAX_WINDOWS,
  DEFAULT_TOP,
  DEFAULT_WAIT_MS,
  DEFAULT_WORKERS,
  FLOAT_WEAPON_QUALITY_VALUES,
  STICKER_QUALITY_VALUES,
  WEAR_MAP,
} from "../../src/Helpers/Config/constants.mjs";
import { validateSteamListingUrl } from "../../src/Helpers/Utils/url-utils.mjs";

function validateCommonHttp(body) {
  const top = body.top ?? DEFAULT_FLOAT_TOP;
  const waitMs = body.waitMs ?? DEFAULT_FLOAT_WAIT_MS;
  const workers = body.workers ?? body.maxWindows ?? DEFAULT_MAX_WINDOWS;

  if (!Number.isInteger(top) || top <= 0) {
    throw new Error("top must be a positive integer");
  }
  if (!Number.isInteger(waitMs) || waitMs < 0) {
    throw new Error("waitMs must be a non-negative integer");
  }
  if (!Number.isInteger(workers) || workers <= 0) {
    throw new Error("workers / maxWindows must be a positive integer");
  }
  return { top, waitMs, workers };
}

/**
 * @param {Record<string, unknown>} body
 */
export function buildStickerMultiArgs(body) {
  if (!body.weapon || typeof body.weapon !== "string") {
    throw new Error("weapon is required (string)");
  }

  const conditions = Array.isArray(body.conditions)
    ? body.conditions.map((c) => String(c).toLowerCase())
    : Object.keys(WEAR_MAP);

  for (const c of conditions) {
    if (!(c in WEAR_MAP)) {
      throw new Error(`Invalid condition "${c}"`);
    }
  }

  const quality = body.quality
    ? String(body.quality).toLowerCase()
    : "normal";
  if (!STICKER_QUALITY_VALUES.has(quality)) {
    throw new Error("quality must be one of: normal, st, both");
  }

  let sortBy = "efficiency";
  if (body.sortBy === "edge") sortBy = "edge";
  else if (body.sortBy === "efficiency" || body.sortBy == null) sortBy = "efficiency";
  else throw new Error("sortBy must be edge or efficiency");

  const top = body.top ?? DEFAULT_TOP;
  const workers = body.workers ?? DEFAULT_WORKERS;
  const waitMs = body.waitMs ?? DEFAULT_WAIT_MS;

  if (!Number.isInteger(top) || top <= 0) {
    throw new Error("top must be a positive integer");
  }
  if (!Number.isInteger(workers) || workers <= 0) {
    throw new Error("workers must be a positive integer");
  }
  if (!Number.isInteger(waitMs) || waitMs < 0) {
    throw new Error("waitMs must be a non-negative integer");
  }

  let maxPrice = body.maxPrice ?? null;
  if (maxPrice !== null) {
    maxPrice = Number(maxPrice);
    if (!Number.isFinite(maxPrice) || maxPrice < 0) {
      throw new Error("maxPrice must be a non-negative number");
    }
  }

  return {
    weapon: body.weapon,
    conditions: [...new Set(conditions)],
    quality,
    maxPrice,
    top,
    workers,
    maxWindows: workers,
    sortBy,
    waitMs,
    cookie: body.cookie ? String(body.cookie) : null,
    headful: Boolean(body.headful),
    debug: Boolean(body.debug),
  };
}

const FLOAT_WEAR = new Set(["fn", "bs"]);

/**
 * @param {Record<string, unknown>} body
 */
export function buildFloatMultiArgs(body) {
  if (!body.weapon || typeof body.weapon !== "string") {
    throw new Error("weapon is required (string)");
  }

  const wear = body.wear ? String(body.wear).toLowerCase() : null;
  if (!wear || !FLOAT_WEAR.has(wear)) {
    throw new Error("wear must be fn or bs");
  }

  const mode = body.mode ? String(body.mode).toLowerCase() : null;
  if (!mode || !["lowest", "highest"].includes(mode)) {
    throw new Error("mode must be lowest or highest");
  }

  const quality = body.quality
    ? String(body.quality).toLowerCase()
    : "normal";
  if (!FLOAT_WEAPON_QUALITY_VALUES.has(quality)) {
    throw new Error("quality must be one of: normal, st, sv");
  }

  const top = body.top ?? DEFAULT_FLOAT_TOP;
  const workers = body.workers ?? DEFAULT_WORKERS;
  const waitMs = body.waitMs ?? DEFAULT_FLOAT_WAIT_MS;

  if (!Number.isInteger(top) || top <= 0) {
    throw new Error("top must be a positive integer");
  }
  if (!Number.isInteger(workers) || workers <= 0) {
    throw new Error("workers must be a positive integer");
  }
  if (!Number.isInteger(waitMs) || waitMs < 0) {
    throw new Error("waitMs must be a non-negative integer");
  }

  let maxSkins = body.maxSkins ?? null;
  if (maxSkins !== null) {
    maxSkins = Number.parseInt(String(maxSkins), 10);
    if (!Number.isInteger(maxSkins) || maxSkins <= 0) {
      throw new Error("maxSkins must be a positive integer");
    }
  }

  let maxListingsPerSkin = body.maxListingsPerSkin ?? null;
  if (maxListingsPerSkin !== null) {
    maxListingsPerSkin = Number.parseInt(String(maxListingsPerSkin), 10);
    if (!Number.isInteger(maxListingsPerSkin) || maxListingsPerSkin <= 0) {
      throw new Error("maxListingsPerSkin must be a positive integer");
    }
  }

  let maxPrice = null;
  if (body.maxPrice !== undefined && body.maxPrice !== null && body.maxPrice !== "") {
    maxPrice = Number.parseFloat(String(body.maxPrice));
    if (!Number.isFinite(maxPrice) || maxPrice < 0) {
      throw new Error("maxPrice must be a non-negative number (EUR)");
    }
  }

  return {
    weapon: body.weapon,
    wear,
    mode,
    quality,
    top,
    language: body.language ? String(body.language) : DEFAULT_LANGUAGE,
    cookie: body.cookie ? String(body.cookie) : null,
    waitMs,
    headful: Boolean(body.headful),
    debug: Boolean(body.debug),
    maxSkins,
    maxListingsPerSkin,
    workers,
    maxWindows: workers,
    maxPrice,
  };
}

/**
 * @param {Record<string, unknown>} body
 */
export function buildSingleUrlArgs(body) {
  if (!body.url || typeof body.url !== "string") {
    throw new Error("url is required");
  }

  const check = validateSteamListingUrl(body.url);
  if (!check.ok) {
    throw new Error(check.message);
  }

  const { top, waitMs, workers } = validateCommonHttp(body);

  const mode = body.mode ? String(body.mode).toLowerCase() : "lowest";
  if (!["lowest", "highest"].includes(mode)) {
    throw new Error("mode must be lowest or highest");
  }

  const currency = body.currency ?? DEFAULT_CURRENCY;
  const c = Number.parseInt(String(currency), 10);
  if (!Number.isInteger(c) || c <= 0) {
    throw new Error("currency must be a positive integer");
  }

  let maxPrice = null;
  if (body.maxPrice !== undefined && body.maxPrice !== null && body.maxPrice !== "") {
    maxPrice = Number.parseFloat(String(body.maxPrice));
    if (!Number.isFinite(maxPrice) || maxPrice < 0) {
      throw new Error("maxPrice must be a non-negative number (EUR)");
    }
  }

  return {
    url: body.url,
    maxWindows: workers,
    workers,
    mode,
    top,
    waitMs,
    cookie: body.cookie ? String(body.cookie) : null,
    headful: Boolean(body.headful),
    debug: Boolean(body.debug),
    currency: c,
    maxPrice,
  };
}
