#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_INPUT_PATH = "../Database/charm_db.json";

function parseArgs(argv) {
  const args = {
    all: false,
    charmIds: [],
    excludedCharmIds: [],
    patterns: [],
    input: DEFAULT_INPUT_PATH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--all") {
      args.all = true;
      continue;
    }

    if (arg === "--input") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value after --input");
      }
      args.input = value;
      i += 1;
      continue;
    }

    if (arg === "--charmids") {
      i += 1;
      while (i < argv.length && !argv[i].startsWith("--")) {
        const value = argv[i].trim();
        if (!/^\d+$/.test(value)) {
          throw new Error(`Invalid charm id: ${value}`);
        }
        args.charmIds.push(value);
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (arg === "--excp") {
      i += 1;
      while (i < argv.length && !argv[i].startsWith("--")) {
        const value = argv[i].trim();
        if (!/^\d+$/.test(value)) {
          throw new Error(`Invalid excluded charm id: ${value}`);
        }
        args.excludedCharmIds.push(value);
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (arg === "--pattern" || arg === "--patern") {
      i += 1;
      while (i < argv.length && !argv[i].startsWith("--")) {
        args.patterns.push(argv[i].trim());
        i += 1;
      }
      i -= 1;
      continue;
    }
  }

  return args;
}

function validateMode(args) {
  if (args.all && args.charmIds.length > 0) {
    throw new Error("Use either --all or --charmids, not both");
  }

  if (!args.all && args.charmIds.length === 0) {
    throw new Error("You must provide either --all or --charmids");
  }

  if (!args.all && args.excludedCharmIds.length > 0) {
    throw new Error("--excp can only be used together with --all");
  }

  if (args.patterns.length === 0) {
    throw new Error(
      "No patterns provided. Use --pattern 1234 or --pattern 0-10",
    );
  }
}

function parsePatternTokenToRange(token) {
  if (/^\d+$/.test(token)) {
    const value = Number(token);
    return { start: value, end: value };
  }

  const rangeMatch = token.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);

    if (start > end) {
      throw new Error(
        `Invalid pattern range "${token}": start is greater than end`,
      );
    }

    return { start, end };
  }

  throw new Error(`Invalid pattern value: ${token}`);
}

function normalizeRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return [];
  }

  const sorted = ranges
    .map((range) => {
      if (!range || typeof range !== "object") {
        throw new Error("Invalid rare pattern entry: expected object");
      }

      const start = Number(range.start);
      const end = Number(range.end);

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(
          `Invalid rare pattern range: start="${range.start}", end="${range.end}"`,
        );
      }

      if (start > end) {
        throw new Error(`Invalid rare pattern range: ${start}-${end}`);
      }

      return { start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];

  for (const current of sorted) {
    if (merged.length === 0) {
      merged.push({ ...current });
      continue;
    }

    const last = merged[merged.length - 1];

    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function parsePatternRanges(patternTokens) {
  const ranges = patternTokens.map(parsePatternTokenToRange);
  return normalizeRanges(ranges);
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function saveJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, json + "\n", "utf8");
}

function ensureRarePatternsArray(charm) {
  if (!Array.isArray(charm.rarePatterns)) {
    charm.rarePatterns = [];
  }
}

function addRangesToCharm(charm, rangesToAdd) {
  ensureRarePatternsArray(charm);

  const existingRanges = normalizeRanges(charm.rarePatterns);
  const beforeSignature = JSON.stringify(existingRanges);

  const combinedRanges = [...existingRanges, ...rangesToAdd];
  const normalizedRanges = normalizeRanges(combinedRanges);

  charm.rarePatterns = normalizedRanges;

  const afterSignature = JSON.stringify(normalizedRanges);
  return beforeSignature === afterSignature ? 0 : 1;
}

function countCoveredValues(ranges) {
  let total = 0;

  for (const range of ranges) {
    total += range.end - range.start + 1;
  }

  return total;
}

function formatRangesForLog(ranges) {
  return ranges
    .map((range) =>
      range.start === range.end
        ? String(range.start)
        : `${range.start}-${range.end}`,
    )
    .join(", ");
}

function hasRarePattern(ranges, pattern) {
  let left = 0;
  let right = ranges.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const range = ranges[mid];

    if (pattern < range.start) {
      right = mid - 1;
    } else if (pattern > range.end) {
      left = mid + 1;
    } else {
      return true;
    }
  }

  return false;
}

function getTargetCharmIds(charms, args) {
  if (args.all) {
    const excludedSet = new Set(args.excludedCharmIds);
    return Object.keys(charms).filter((charmId) => !excludedSet.has(charmId));
  }

  return args.charmIds;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    validateMode(args);

    const rangesToAdd = parsePatternRanges(args.patterns);
    const inputPath = path.resolve(args.input);

    const data = await loadJson(inputPath);

    if (
      !data ||
      typeof data !== "object" ||
      !data.charms ||
      typeof data.charms !== "object"
    ) {
      throw new Error(
        'Invalid JSON format. Expected top-level object with "charms".',
      );
    }

    const charms = data.charms;
    const targetCharmIds = getTargetCharmIds(charms, args);

    let processedCharmCount = 0;
    let modifiedCharmCount = 0;

    console.log(
      `Adding rare pattern ranges: ${formatRangesForLog(rangesToAdd)}`,
    );
    console.log(
      `Total covered pattern values: ${countCoveredValues(rangesToAdd)}`,
    );

    if (args.all) {
      if (args.excludedCharmIds.length > 0) {
        console.log(`Excluded charm IDs: ${args.excludedCharmIds.join(", ")}`);
      } else {
        console.log("Target: all charms");
      }
    } else {
      console.log(`Target charm IDs: ${args.charmIds.join(", ")}`);
    }

    console.log("");

    for (const charmId of targetCharmIds) {
      const charm = charms[charmId];

      if (!charm) {
        console.warn(`Charm ID ${charmId} not found, skipping`);
        continue;
      }

      const changed = addRangesToCharm(charm, rangesToAdd);
      processedCharmCount += 1;
      modifiedCharmCount += changed;

      console.log(
        `Charm ${charmId} (${charm.charmName ?? "Unknown"}) -> ${changed ? "updated" : "no change"}`,
      );
    }

    await saveJson(inputPath, data);

    console.log("");
    console.log(`Processed charms: ${processedCharmCount}`);
    console.log(`Modified charms: ${modifiedCharmCount}`);
    console.log(`Saved file: ${inputPath}`);
    console.log("");
    console.log("Lookup helper example:");
    console.log("hasRarePattern(charm.rarePatterns, 1234)");
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

await main();

export { hasRarePattern, normalizeRanges };
