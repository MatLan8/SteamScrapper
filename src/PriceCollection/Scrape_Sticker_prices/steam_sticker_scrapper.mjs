import fs from "node:fs/promises";
import { sleep } from "../../Helpers/utils/general.mjs";
import { parseSteamLocalePriceDisplay } from "../../Helpers/utils/price-utils.mjs";
import {
  buildPriceHistoryUrl,
  buildStickerToolSearchUrl,
  createStickerPriceCollectionFetch,
} from "../../Helpers/Steam/steam-price-collection.mjs";

// ================= CONFIG =================
const OUTPUT_FILE = "../Database/steam_sticker_prices.json";

const DELAY_MS = 400;
const DELAY_OFFSET = 600;
const HISTORY_DELAY_MS = 400;
const HISTORY_DELAY_OFFSET = 500;

const STEAM_COOKIE = "...";

async function loadDB() {
  try {
    const data = await fs.readFile(OUTPUT_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveDB(db) {
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(db, null, 2), "utf-8");
}

async function main() {
  const args = process.argv.slice(2);
  const sleepMode = args.includes("--sleep");

  const pageArg = args.find((arg) => /^\d+$/.test(arg));
  const startPage = Number.parseInt(pageArg ?? "0", 10);

  if (!Number.isInteger(startPage) || startPage < 0) {
    console.error("Usage: node scan_sticker.mjs <pageNumber> [--sleep]");
    process.exit(1);
  }

  console.log(`Sleep mode: ${sleepMode ? "ON" : "OFF"}`);

  const { fetchJson, printStats } = createStickerPriceCollectionFetch({
    steamCookie: STEAM_COOKIE,
    sleepMode,
  });

  const db = await loadDB();
  let page = startPage;

  try {
    while (true) {
      const start = page * 10;

      const data = await fetchJson(buildStickerToolSearchUrl(start), {
        useCookies: false,
      });

      if (!data || !Array.isArray(data.results)) {
        console.error("Unexpected response value:", data);
        console.error("Unexpected response type:", typeof data);
        throw new Error(
          `Unexpected search response shape on page ${page}. Keys: ${Object.keys(data || {}).join(", ")}`,
        );
      }

      if (data.results.length === 0) {
        console.log(`Reached end of results at page ${page}.`);
        printStats("Reached end of results");
        break;
      }

      const updated = [];

      for (const item of data.results) {
        const name = item.hash_name;
        if (!name || !name.startsWith("Sticker | ")) continue;

        const quantity = Number(item.sell_listings) || 0;
        let price = 0;

        if (quantity > 8) {
          if (typeof item.sell_price === "number") {
            price = item.sell_price / 100;
          } else if (typeof item.sell_price_text === "string") {
            price = parseSteamLocalePriceDisplay(item.sell_price_text) ?? 0;
          }
        } else {
          const delay = HISTORY_DELAY_MS + Math.random() * HISTORY_DELAY_OFFSET;
          await sleep(delay);

          const phData = await fetchJson(buildPriceHistoryUrl(name), {
            useCookies: true,
          });

          if (
            !phData?.success ||
            !Array.isArray(phData.prices) ||
            phData.prices.length === 0
          ) {
            continue;
          }

          const last3 = phData.prices.slice(-3);
          const avg =
            last3.reduce(
              (sum, entry) =>
                sum + (parseSteamLocalePriceDisplay(entry[1]) ?? 0),
              0,
            ) / last3.length;

          price = avg;
        }

        if (!price || !Number.isFinite(price)) continue;

        const roundedPrice = Number(price.toFixed(2));
        const existing = db[name]?.price;
        console.log(
          `DEBUG ${name} | quantity=${quantity} | price=${roundedPrice} | existing=${existing}`,
        );
        if (existing !== roundedPrice) {
          db[name] = {
            price: roundedPrice,
            quantity,
            updatedAt: new Date().toISOString(),
          };
          updated.push(name);
        }
      }

      await saveDB(db);

      console.log(
        `Page ${page} | Sticker price updated for: ${
          updated.length ? updated.join(", ") : "none"
        }`,
      );

      page++;
      const delay = DELAY_MS + Math.random() * DELAY_OFFSET;
      await sleep(delay);
    }
  } catch (err) {
    console.error(`❌ Stopped due to error: ${err.message}`);
    console.log(`Last successful page: ${page}`);
    printStats("Stopped due to request limit / error");
    process.exit(1);
  }
}

main();
