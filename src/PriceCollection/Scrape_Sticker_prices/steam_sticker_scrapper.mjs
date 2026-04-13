import fs from "node:fs/promises";
//921 page
// ================= CONFIG =================
const BASE_URL = "https://steamcommunity.com/market/search/render/";
const PRICE_HISTORY_URL = "https://steamcommunity.com/market/pricehistory/";

const OUTPUT_FILE = "../Database/steam_sticker_prices.json";

const DELAY_MS = 400;
const DELAY_OFFSET = 600;
const HISTORY_DELAY_MS = 400;
const HISTORY_DELAY_OFFSET = 500;

const REQUEST_THRESHOLD = 80;
const THRESHOLD_SLEEP_MS = 540000; // 4.5 min
const SLEEP_LOG_INTERVAL_MS = 10000; // 10 sec

const CURRENCY = 3; // EUR

const STEAM_COOKIE = "...";

// ================= UTILS =================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = {
  requestCount: 0,
  firstRequestAt: null,
  lastRequestAt: null,
  currentRequests: 0,
};

function buildSearchUrl(start) {
  return `${BASE_URL}?query=&start=${start}&count=10&search_descriptions=0&sort_column=name&sort_dir=desc&appid=730&norender=1&currency=${CURRENCY}&category_730_ItemSet[]=any&category_730_ProPlayer[]=any&category_730_StickerCapsule[]=any&category_730_Tournament[]=any&category_730_TournamentTeam[]=any&category_730_Type[]=tag_CSGO_Tool_Sticker&category_730_Weapon[]=any`;
}

function buildPriceHistoryUrl(name) {
  return `${PRICE_HISTORY_URL}?appid=730&currency=${CURRENCY}&market_hash_name=${encodeURIComponent(name)}`;
}

function parseSteamPrice(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/[^\d.,-]/g, "");
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized = cleaned;

  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${minutes}m ${seconds}s`;
}

async function sleepWithCountdown(totalMs) {
  let remaining = totalMs;

  console.log(
    `😴 Threshold reached. Sleeping for ${formatDuration(totalMs)}...`,
  );

  while (remaining > 0) {
    const chunk = Math.min(SLEEP_LOG_INTERVAL_MS, remaining);
    await sleep(chunk);
    remaining -= chunk;

    console.log(
      `⏳ Sleep remaining: ${formatDuration(remaining)} (${remaining} ms)`,
    );
  }

  console.log("✅ Sleep finished. Continuing requests.");
}

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

function printStats(reason = "Run finished") {
  const end = stats.lastRequestAt ?? Date.now();

  console.log(`\n=== ${reason} ===`);
  console.log(`Requests made: ${stats.requestCount}`);

  if (stats.firstRequestAt) {
    const windowMs = end - stats.firstRequestAt;
    const rpm = windowMs > 0 ? stats.requestCount / (windowMs / 60000) : 0;

    console.log(
      `First request at: ${new Date(stats.firstRequestAt).toISOString()}`,
    );
    console.log(`Last request at:  ${new Date(end).toISOString()}`);
    console.log(
      `Time window:      ${formatDuration(windowMs)} (${windowMs} ms)`,
    );
    console.log(`Avg req/min:      ${rpm.toFixed(2)}`);
  } else {
    console.log("No requests were made.");
  }
}

async function fetchJson(url, { useCookies = false, sleepMode = false } = {}) {
  const now = Date.now();

  if (!stats.firstRequestAt) {
    stats.firstRequestAt = now;
    console.log(`First request started at: ${new Date(now).toISOString()}`);
  }

  if (sleepMode && stats.currentRequests >= REQUEST_THRESHOLD) {
    await sleepWithCountdown(THRESHOLD_SLEEP_MS);
    stats.currentRequests = 0;
  }

  stats.lastRequestAt = now;
  stats.requestCount++;
  stats.currentRequests++;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Referer: "https://steamcommunity.com/market/search?appid=730",
  };

  if (useCookies) {
    if (!STEAM_COOKIE) {
      throw new Error(
        "Price history request needs cookies, but STEAM_COOKIE is empty.",
      );
    }
    headers.Cookie = STEAM_COOKIE;
    headers.Referer = "https://steamcommunity.com/market/";
  }

  const res = await fetch(url, { headers });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Response was not JSON. HTTP ${res.status}. First 300 chars:\n${text.slice(0, 300)}`,
    );
  }

  return data;
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

  const db = await loadDB();
  let page = startPage;

  try {
    while (true) {
      const start = page * 10;

      const data = await fetchJson(buildSearchUrl(start), {
        useCookies: false,
        sleepMode,
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
            price = parseSteamPrice(item.sell_price_text);
          }
        } else {
          const delay = HISTORY_DELAY_MS + Math.random() * HISTORY_DELAY_OFFSET;
          await sleep(delay);

          const phData = await fetchJson(buildPriceHistoryUrl(name), {
            useCookies: true,
            sleepMode,
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
            last3.reduce((sum, entry) => sum + parseSteamPrice(entry[1]), 0) /
            last3.length;

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
