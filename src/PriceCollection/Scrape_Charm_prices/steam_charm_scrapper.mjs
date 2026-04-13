import fs from "node:fs/promises";
import { sleep } from "../../Helpers/utils/general.mjs";
import { parseSteamLocalePriceDisplay } from "../../Helpers/utils/price-utils.mjs";
import {
  buildCharmSearchHeaders,
  buildCharmSearchUrl,
  fetchSteamJsonFromText,
} from "../../Helpers/Steam/steam-price-collection.mjs";

const OUTPUT_FILE = "../Database/steam_charm_prices.json";

const DELAY_MS = 400;
const DELAY_OFFSET = 600;

async function loadDB() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveDB(db) {
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(db, null, 2), "utf8");
}

async function main() {
  const startPage = Number.parseInt(process.argv[2] ?? "0", 10);

  if (!Number.isInteger(startPage) || startPage < 0) {
    console.error("Usage: node scan_charm.mjs <pageNumber>");
    process.exit(1);
  }

  const headers = buildCharmSearchHeaders();
  const db = await loadDB();
  let page = startPage;
  let totalCount = null;

  while (true) {
    const start = page * 10;
    const data = await fetchSteamJsonFromText(
      buildCharmSearchUrl(start),
      headers,
    );

    if (!data || !Array.isArray(data.results)) {
      throw new Error(`Bad response on page ${page}`);
    }

    if (typeof data.total_count === "number") {
      totalCount = data.total_count;
    }

    if (data.results.length === 0) {
      console.log(`Reached empty page at ${page}`);
      break;
    }

    let updatedCount = 0;

    for (const item of data.results) {
      const name = item.hash_name;
      if (!name) continue;

      let price = null;

      if (
        typeof item.sell_price === "number" &&
        Number.isFinite(item.sell_price)
      ) {
        price = Number((item.sell_price / 100).toFixed(2));
      } else if (typeof item.sell_price_text === "string") {
        const parsed = parseSteamLocalePriceDisplay(item.sell_price_text);
        price = parsed === null ? null : Number(parsed.toFixed(2));
      }

      const entry = { price };

      if (name.startsWith("Charm |")) {
        entry.rarePatterns = Array.isArray(db[name]?.rarePatterns)
          ? db[name].rarePatterns
          : [];
      }

      const oldValue = JSON.stringify(db[name] ?? null);
      const newValue = JSON.stringify(entry);

      if (oldValue !== newValue) {
        db[name] = entry;
        updatedCount++;
      } else if (!db[name]) {
        db[name] = entry;
        updatedCount++;
      }
    }

    await saveDB(db);

    console.log(
      `Page ${page} | got ${data.results.length} results | total saved: ${Object.keys(db).length} | updated: ${updatedCount}`,
    );

    page++;

    if (totalCount !== null && start + data.results.length >= totalCount) {
      console.log(
        `Finished. total_count=${totalCount}, saved=${Object.keys(db).length}`,
      );
      break;
    }

    await sleep(DELAY_MS + Math.random() * DELAY_OFFSET);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
