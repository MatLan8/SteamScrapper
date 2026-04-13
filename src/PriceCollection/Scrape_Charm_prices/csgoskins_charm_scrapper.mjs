#!/usr/bin/env node

import fs from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright";

const BASE_URL =
  "https://csgoskins.gg/categories/charm?query=&price_min=&price_max=&association=&rarity=&tournament=&quality=1&team=&player=&collection=&map=&order=alphabetically";
const OUT_FILE = "../Database/csgoskins_charm_prices.json";
const PAGE_DELAY_MS = 1200;
const NAV_TIMEOUT_MS = 45000;
const USD_TO_EUR = 0.92;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);

  const headful = args.includes("--headful");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const rawPage = positional[0];

  if (!rawPage) {
    console.error(
      "Usage: node csgoskins_charm_scrapper.mjs <startingPage> [--headful]",
    );
    process.exit(1);
  }

  const startingPage = Number(rawPage);

  if (!Number.isInteger(startingPage) || startingPage < 1) {
    console.error("Starting page must be a positive integer.");
    process.exit(1);
  }

  return {
    startingPage,
    headful,
  };
}

function usdToEurRounded(usd) {
  const eur = usd * USD_TO_EUR;
  return Math.round(eur * 100) / 100;
}

function parsePriceText(priceText) {
  if (!priceText) return null;

  const cleaned = priceText.replace(/[$,\s]/g, "");
  const value = Number(cleaned);

  return Number.isFinite(value) ? value : null;
}

async function scrapeCurrentPage(page) {
  const items = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll(
        'div[class*="bg-gray-800"][class*="h-[545px]"]',
      ),
    );

    return cards.map((card) => {
      const titleEl = card.querySelector(
        '[class*="text-lg"][class*="leading-7"][class*="truncate"]',
      );

      const priceAnchor = card.querySelector(
        'div[class*="top-[395px]"] a.custom-underline',
      );

      const charmTitle = titleEl?.textContent?.trim() ?? null;
      const priceText = priceAnchor?.textContent?.trim() ?? null;

      return {
        name: charmTitle ? `Charm | ${charmTitle}` : null,
        priceText,
      };
    });
  });

  return items
    .filter((item) => item.name && item.priceText)
    .map((item) => ({
      name: item.name,
      priceUsd: parsePriceText(item.priceText),
    }))
    .filter((item) => item.priceUsd !== null);
}

async function loadExistingResults() {
  try {
    const raw = await fs.readFile(OUT_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }

    return {};
  } catch {
    return {};
  }
}

async function saveResults(results) {
  await fs.writeFile(OUT_FILE, JSON.stringify(results, null, 2), "utf8");
}

async function main() {
  const { startingPage, headful } = parseArgs();
  const results = await loadExistingResults();

  let browser;
  let shuttingDown = false;

  async function flushAndExit(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      console.log("\nSaving current results before exit...");
      await saveResults(results);
    } catch (err) {
      console.error("Failed to save results during shutdown:", err);
    }

    try {
      if (browser) {
        await browser.close();
      }
    } catch {
      // ignore
    }

    process.exit(code);
  }

  process.on("SIGINT", () => {
    console.log("\nCaught SIGINT (Ctrl+C).");
    void flushAndExit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nCaught SIGTERM.");
    void flushAndExit(0);
  });

  browser = await chromium.launch({
    headless: !headful,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 1200 },
    locale: "en-US",
  });

  const page = await context.newPage();

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    const type = request.resourceType();

    if (
      type === "image" ||
      type === "font" ||
      type === "media" ||
      url.includes("cdn.csgoskins.gg/public/uih/items/")
    ) {
      await route.abort();
      return;
    }

    await route.continue();
  });

  const badResponses = [];

  page.on("response", async (response) => {
    try {
      const url = response.url();
      const status = response.status();

      if (
        url.includes("csgoskins.gg") &&
        (status === 403 || status === 429 || status >= 500)
      ) {
        badResponses.push({ url, status });
      }
    } catch {
      // ignore
    }
  });

  console.log(`Starting from page ${startingPage}`);
  console.log(`Mode: ${headful ? "headful" : "headless"}`);
  console.log(`USD -> EUR rate: ${USD_TO_EUR}`);
  console.log(`Saving into: ${OUT_FILE}`);

  try {
    let currentPage = startingPage;

    while (true) {
      const url = `${BASE_URL}&page=${currentPage}`;
      const pageStart = Date.now();

      console.log(`\nOpening page ${currentPage}: ${url}`);

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      const mainStatus = response?.status() ?? null;
      console.log(`Main document status: ${mainStatus}`);

      if (mainStatus === 403 || mainStatus === 429) {
        console.error(`Stopped because main page returned ${mainStatus}.`);
        break;
      }

      await page.waitForSelector(
        'div[class*="top-[395px]"] a.custom-underline',
        { timeout: 10000 },
      );

      const pageItems = await scrapeCurrentPage(page);

      if (pageItems.length === 0) {
        console.log("No charm rows found on page. Stopping.");
        break;
      }

      let updatedCount = 0;

      for (const item of pageItems) {
        const convertedPrice = usdToEurRounded(item.priceUsd);

        const nextValue = {
          price: convertedPrice,
          rarePatterns: Array.isArray(results[item.name]?.rarePatterns)
            ? results[item.name].rarePatterns
            : [],
        };

        const oldValue = JSON.stringify(results[item.name] ?? null);
        const newValue = JSON.stringify(nextValue);

        if (oldValue !== newValue) {
          results[item.name] = nextValue;
          updatedCount += 1;
          await saveResults(results);

          console.log(`Updated: ${item.name} -> €${convertedPrice.toFixed(2)}`);
        }
      }

      const pageMs = Date.now() - pageStart;

      console.log(`Charm rows found on page: ${pageItems.length}`);
      console.log(`Charm rows changed on page: ${updatedCount}`);
      console.log(
        `Total unique charms in file: ${Object.keys(results).length}`,
      );
      console.log(`Page time: ${(pageMs / 1000).toFixed(2)}s`);

      if (badResponses.length > 0) {
        const recent = badResponses.slice(-5);
        console.log("Recent bad responses:");
        for (const r of recent) {
          console.log(`  ${r.status} | ${r.url}`);
        }
      }

      currentPage += 1;
      await sleep(PAGE_DELAY_MS);
    }
  } finally {
    await saveResults(results);
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
