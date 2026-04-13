#!/usr/bin/env node

import fs from "node:fs/promises";

const CSGO_FILE = "../Database/csgoskins_charm_prices.json";
const STEAM_FILE = "../Database/steam_charm_prices.json";
const OUT_FILE = "../Database/merged_charm_prices.json";

async function loadJson(path) {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read ${path}: ${err.message}`);
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function saveJson(path, data) {
  await fs.writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

function isNormalCharm(name) {
  return typeof name === "string" && name.startsWith("Charm |");
}

function getRarePatterns(name, ...sources) {
  if (!isNormalCharm(name)) return undefined;

  for (const src of sources) {
    if (Array.isArray(src?.rarePatterns)) {
      return src.rarePatterns;
    }
  }

  return [];
}

async function main() {
  const csgoskins = await loadJson(CSGO_FILE);
  const steam = await loadJson(STEAM_FILE);

  const merged = {};

  let addedFromCsgoskins = 0;
  let addedFromSteam = 0;
  let updatedFromSteam = 0;

  // STEP 1: load csgoskins
  for (const [name, data] of Object.entries(csgoskins)) {
    const price = Number(data?.price);
    if (!Number.isFinite(price)) continue;

    const entry = {
      price: round2(price),
      source: "csgoskins",
    };

    if (isNormalCharm(name)) {
      entry.rarePatterns = getRarePatterns(name, data);
    }

    merged[name] = entry;
    addedFromCsgoskins += 1;
  }

  // STEP 2: merge steam
  for (const [name, data] of Object.entries(steam)) {
    const steamPrice = Number(data?.price);
    if (!Number.isFinite(steamPrice)) continue;

    if (!(name in merged)) {
      const entry = {
        price: round2(steamPrice),
        source: "steam",
      };

      if (isNormalCharm(name)) {
        entry.rarePatterns = getRarePatterns(name, data);
      }

      merged[name] = entry;
      addedFromSteam += 1;
    } else {
      const existingPrice = Number(merged[name].price);
      const avgPrice = round2((existingPrice + steamPrice) / 2);

      const entry = {
        price: avgPrice,
        source: "average",
      };

      if (isNormalCharm(name)) {
        entry.rarePatterns = getRarePatterns(
          name,
          steam[name],
          csgoskins[name],
          merged[name],
        );
      }

      merged[name] = entry;
      updatedFromSteam += 1;
    }
  }

  await saveJson(OUT_FILE, merged);

  console.log(`Saved merged file to: ${OUT_FILE}`);
  console.log(`Added from csgoskins: ${addedFromCsgoskins}`);
  console.log(`Added from steam: ${addedFromSteam}`);
  console.log(`Updated from steam (averaged): ${updatedFromSteam}`);
  console.log(`Total charms: ${Object.keys(merged).length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
