import fs from "node:fs/promises";

const mapPath = "../Database/sticker_map.json";
const pricePath = "../Database/merged_sticker_prices.json";
const outputPath = "../Database/sticker_db.json";

async function main() {
  const mapData = JSON.parse(await fs.readFile(mapPath, "utf8"));
  const priceData = JSON.parse(await fs.readFile(pricePath, "utf8"));

  const result = {};

  for (const [name, { stickerid }] of Object.entries(mapData)) {
    const priceEntry = priceData[name];
    if (!priceEntry) {
      continue;
    }

    result[stickerid] = {
      stickerName: name,
      price: priceEntry ? priceEntry.price : null,
      source: priceEntry ? priceEntry.source : null,
    };
  }

  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

  console.log(`Created DB with ${Object.keys(result).length} stickers`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
