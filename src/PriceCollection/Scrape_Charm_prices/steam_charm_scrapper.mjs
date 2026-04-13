import fs from "node:fs/promises";

const BASE_URL = "https://steamcommunity.com/market/search/render/";
const OUTPUT_FILE = "../Database/steam_charm_prices.json";

const DELAY_MS = 400;
const DELAY_OFFSET = 600;
const CURRENCY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildSearchUrl(start) {
  const params = new URLSearchParams({
    query: "charm",
    start: String(start),
    count: "10",
    search_descriptions: "0",
    sort_column: "name",
    sort_dir: "desc",
    appid: "730",
    norender: "1",
    currency: String(CURRENCY),
  });

  params.append("category_730_ItemSet[]", "any");
  params.append("category_730_ProPlayer[]", "any");
  params.append("category_730_StickerCapsule[]", "any");
  params.append("category_730_Tournament[]", "any");
  params.append("category_730_TournamentTeam[]", "any");
  params.append("category_730_Type[]", "any");
  params.append("category_730_Weapon[]", "any");

  params.append(
    "category_730_KeychainCapsule[]",
    "tag_keychain_pack_kc_weapon_01_lootlist",
  );
  params.append(
    "category_730_KeychainCapsule[]",
    "tag_keychain_pack_kc_missinglink_lootlist",
  );
  params.append(
    "category_730_KeychainCapsule[]",
    "tag_keychain_pack_kc_drboom_lootlist",
  );
  params.append(
    "category_730_KeychainCapsule[]",
    "tag_keychain_pack_kc_ml_community_01_lootlist",
  );
  params.append(
    "category_730_KeychainCapsule[]",
    "tag_keychain_pack_kc_aus2025_lootlist",
  );
  params.append(
    "category_730_KeychainCapsule[]",
    "tag_keychain_pack_kc_bud2025_lootlist",
  );

  return `${BASE_URL}?${params.toString()}`;
}

function parseSteamPrice(str) {
  if (!str) return null;

  const cleaned = String(str).replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized = cleaned;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: "https://steamcommunity.com/market/search?appid=730&q=charm",
    },
  });

  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Bad JSON. HTTP ${res.status}. First 300 chars:\n${text.slice(0, 300)}`,
    );
  }
}

async function main() {
  const startPage = Number.parseInt(process.argv[2] ?? "0", 10);

  if (!Number.isInteger(startPage) || startPage < 0) {
    console.error("Usage: node scan_charm.mjs <pageNumber>");
    process.exit(1);
  }

  const db = await loadDB();
  let page = startPage;
  let totalCount = null;

  while (true) {
    const start = page * 10;
    const data = await fetchJson(buildSearchUrl(start));

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
        const parsed = parseSteamPrice(item.sell_price_text);
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
