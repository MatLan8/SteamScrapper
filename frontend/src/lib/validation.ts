/** Mirrors server/lib/arg-builder.mjs rules for client-side validation. */

const FLOAT_WEAR = new Set(["fn", "bs"]);
const FLOAT_QUALITY = new Set(["normal", "st", "sv"]);
const MODES = new Set(["lowest", "highest"]);

function steamListingUrlPattern(): RegExp {
  return /^https:\/\/steamcommunity\.com\/market\/listings\/\d+\/.+/i;
}

export function validateFloatMultiArgs(body: Record<string, unknown>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!body.weapon || typeof body.weapon !== "string" || !body.weapon.trim()) {
    errors.weapon = "weapon is required";
  }

  const wear = body.wear != null ? String(body.wear).toLowerCase() : "";
  if (!wear || !FLOAT_WEAR.has(wear)) {
    errors.wear = "wear must be fn or bs";
  }

  const mode = body.mode != null ? String(body.mode).toLowerCase() : "";
  if (!mode || !MODES.has(mode)) {
    errors.mode = "mode must be lowest or highest";
  }

  const quality =
    body.quality != null ? String(body.quality).toLowerCase() : "normal";
  if (!FLOAT_QUALITY.has(quality)) {
    errors.quality = "quality must be one of: normal, st, sv";
  }

  const top = toInt(body.top, 10);
  if (top === null || top <= 0) errors.top = "top must be a positive integer";

  const workers = toInt(body.workers, 3);
  if (workers === null || workers <= 0)
    errors.workers = "workers must be a positive integer";

  const waitMs = toInt(body.waitMs, 1500);
  if (waitMs === null || waitMs < 0)
    errors.waitMs = "waitMs must be a non-negative integer";

  if (body.maxSkins != null && body.maxSkins !== "") {
    const m = toInt(body.maxSkins, NaN);
    if (m === null || m <= 0)
      errors.maxSkins = "maxSkins must be a positive integer";
  }

  if (body.maxListingsPerSkin != null && body.maxListingsPerSkin !== "") {
    const m = toInt(body.maxListingsPerSkin, NaN);
    if (m === null || m <= 0) {
      errors.maxListingsPerSkin =
        "maxListingsPerSkin must be a positive integer";
    }
  }

  if (body.maxPrice != null && body.maxPrice !== "") {
    const n =
      typeof body.maxPrice === "number"
        ? body.maxPrice
        : Number.parseFloat(String(body.maxPrice));
    if (!Number.isFinite(n) || n < 0) {
      errors.maxPrice = "maxPrice must be a non-negative number (EUR)";
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateSingleUrlArgs(body: Record<string, unknown>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!body.url || typeof body.url !== "string" || !body.url.trim()) {
    errors.url = "url is required";
  } else if (!steamListingUrlPattern().test(body.url.trim())) {
    errors.url =
      "url must be a Steam market listing URL (steamcommunity.com/market/listings/...)";
  }

  const top = toInt(body.top, 10);
  if (top === null || top <= 0) errors.top = "top must be a positive integer";

  const waitMs = toInt(body.waitMs, 1500);
  if (waitMs === null || waitMs < 0)
    errors.waitMs = "waitMs must be a non-negative integer";

  const workers = toInt(body.maxWindows ?? body.workers, 10);
  if (workers === null || workers <= 0) {
    errors.maxWindows = "workers / maxWindows must be a positive integer";
  }

  const mode = body.mode != null ? String(body.mode).toLowerCase() : "lowest";
  if (!MODES.has(mode)) errors.mode = "mode must be lowest or highest";

  if (body.currency != null && body.currency !== "") {
    const c = toInt(body.currency, NaN);
    if (c === null || c <= 0)
      errors.currency = "currency must be a positive integer";
  }

  if (body.maxPrice != null && body.maxPrice !== "") {
    const n =
      typeof body.maxPrice === "number"
        ? body.maxPrice
        : Number.parseFloat(String(body.maxPrice));
    if (!Number.isFinite(n) || n < 0) {
      errors.maxPrice = "maxPrice must be a non-negative number (EUR)";
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

function toInt(v: unknown, fallback: number): number | null {
  if (v === "" || v === null || v === undefined) {
    if (Number.isNaN(fallback)) return null;
    return fallback;
  }
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
