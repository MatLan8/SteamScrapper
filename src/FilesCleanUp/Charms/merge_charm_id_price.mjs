import fs from "node:fs/promises";

const mapPath = "../Database/charms_map.json";
const pricePath = "../Database/merged_charm_prices.json";
const outputPath = "../Database/charm_db.json";

function isNormalCharm(name) {
  return typeof name === "string" && name.startsWith("Charm |");
}

async function main() {
  const mapData = JSON.parse(await fs.readFile(mapPath, "utf8"));
  const priceData = JSON.parse(await fs.readFile(pricePath, "utf8"));

  const result = {
    charms: {},
    highlight_reels: {},
  };

  let skippedNoPrice = 0;
  let skippedNoMap = 0;

  for (const [name, { stickerid }] of Object.entries(mapData.charms ?? {})) {
    const priceEntry = priceData[name];

    if (!priceEntry) {
      skippedNoPrice++;
      continue;
    }

    result.charms[stickerid] = {
      charmName: name,
      price: typeof priceEntry.price === "number" ? priceEntry.price : null,
      source: priceEntry.source ?? null,
      rarePatterns: Array.isArray(priceEntry.rarePatterns)
        ? priceEntry.rarePatterns
        : [],
    };
  }

  for (const [name, { stickerid }] of Object.entries(
    mapData.highlight_reels ?? {},
  )) {
    const priceEntry = priceData[name];

    if (!priceEntry) {
      skippedNoPrice++;
      continue;
    }

    result.highlight_reels[stickerid] = {
      charmName: name,
      price: typeof priceEntry.price === "number" ? priceEntry.price : null,
      source: priceEntry.source ?? null,
    };
  }

  const allMappedNames = new Set([
    ...Object.keys(mapData.charms ?? {}),
    ...Object.keys(mapData.highlight_reels ?? {}),
  ]);

  for (const name of Object.keys(priceData)) {
    if (!allMappedNames.has(name)) {
      skippedNoMap++;
    }
  }

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

  console.log(
    `Created DB with ${
      Object.keys(result.charms).length +
      Object.keys(result.highlight_reels).length
    } charms total`,
  );
  console.log(`Normal charms: ${Object.keys(result.charms).length}`);
  console.log(`Highlight reels: ${Object.keys(result.highlight_reels).length}`);
  console.log(`Skipped (no price match): ${skippedNoPrice}`);
  console.log(`Skipped (no map match): ${skippedNoMap}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
