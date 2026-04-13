import {
  DEFAULT_OUT,
  DEFAULT_QUALITY,
  DEFAULT_TOP,
  DEFAULT_WAIT_MS,
  DEFAULT_WORKERS,
  QUALITY_VALUES,
  WEAR_MAP,
} from "../Config/constants.mjs";

export function parseArgs(argv) {
  const args = {
    weapon: null,
    conditions: Object.keys(WEAR_MAP),
    quality: DEFAULT_QUALITY,
    maxPrice: null,
    top: DEFAULT_TOP,
    out: DEFAULT_OUT,
    workers: DEFAULT_WORKERS,
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

  if (!QUALITY_VALUES.has(args.quality)) {
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

  if (!Number.isInteger(args.top) || args.top <= 0) {
    throw new Error("--top must be a positive integer");
  }

  if (!Number.isInteger(args.workers) || args.workers <= 0) {
    throw new Error("--workers must be a positive integer");
  }

  if (!Number.isInteger(args.waitMs) || args.waitMs < 0) {
    throw new Error("--wait-ms must be a non-negative integer");
  }

  return args;
}
