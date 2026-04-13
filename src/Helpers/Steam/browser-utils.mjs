import { chromium } from "playwright";
import { TARGET_PAGE_SIZE, USER_AGENT } from "../Config/constants.mjs";
import { parseCookieHeader } from "./market-utils.mjs";

export function isRateLimitText(text) {
  const value = String(text ?? "").toLowerCase();
  return (
    value.includes("too many requests") ||
    value.includes("error code: 429") ||
    value.includes("429") ||
    value.includes("rate limit")
  );
}

export function isRateLimitError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("too many requests") ||
    text.includes("error code: 429") ||
    text.includes("429") ||
    text.includes("rate limit")
  );
}

export async function setupBrowserContext(args) {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: !args.headful,
  });

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "en-US",
  });

  const cookies = parseCookieHeader(args.cookie);
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  return { browser, context };
}

export async function detectRateLimitOnPage(page) {
  try {
    const bodyText = await page.locator("body").innerText({ timeout: 3000 });
    return isRateLimitText(bodyText);
  } catch {
    return false;
  }
}

export async function assertPageNotRateLimited(page, contextLabel = "") {
  const rateLimited = await detectRateLimitOnPage(page);
  if (rateLimited) {
    throw new Error(
      `${contextLabel ? `${contextLabel}: ` : ""}Steam page hit rate limit / 429`,
    );
  }
}

export async function waitForListingPageStable(page, args) {
  await page.waitForLoadState("domcontentloaded");
  await assertPageNotRateLimited(page, "After DOMContentLoaded");

  await page.waitForTimeout(args.waitMs);
  await assertPageNotRateLimited(page, "After initial wait");

  try {
    await page
      .locator(".market_listing_row[id^='listing_']")
      .first()
      .waitFor({ timeout: 15000 });
  } catch {
    await assertPageNotRateLimited(page, "Waiting for first listing row");
  }
}

export async function getSearchResultsMeta(page) {
  return page.evaluate(() => {
    const g = globalThis.g_oSearchResults;

    return {
      hasSearchResults: !!g,
      pageSize: Number(g?.m_cPageSize ?? 0),
      totalCount: Number(g?.m_cTotalCount ?? 0),
      currentPage: Number(g?.m_iCurrentPage ?? 0),
    };
  });
}

export async function getFirstVisibleListingId(page) {
  const row = page.locator(".market_listing_row[id^='listing_']").first();
  return (await row.getAttribute("id").catch(() => null)) || "";
}

export async function forcePageSize(page, args, size = TARGET_PAGE_SIZE) {
  await assertPageNotRateLimited(page, "Before forcing page size");

  const success = await page.evaluate(
    ({ size }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.m_cPageSize = size;
      g.GoToPage(0, true);
      return true;
    },
    { size },
  );

  if (!success) {
    await assertPageNotRateLimited(
      page,
      "Force page size missing search results",
    );
    throw new Error(
      "Steam page search results object missing while forcing page size",
    );
  }

  await page.waitForTimeout(args.waitMs);
  await assertPageNotRateLimited(page, "After forcing page size");

  const sized = await page
    .waitForFunction(
      ({ size }) => {
        const g = globalThis.g_oSearchResults;
        return !!g && Number(g.m_cPageSize) === size;
      },
      { size },
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!sized) {
    await assertPageNotRateLimited(page, "Waiting for page size update");
    throw new Error(`Failed to set page size to ${size}`);
  }
}

export async function goToResultPage(page, args, pageIndex) {
  await assertPageNotRateLimited(
    page,
    `Before switching to page ${pageIndex + 1}`,
  );

  const beforeFirstId = await getFirstVisibleListingId(page);

  const invoked = await page.evaluate(
    ({ pageIndex }) => {
      const g = globalThis.g_oSearchResults;
      if (!g) return false;
      g.GoToPage(pageIndex, true);
      return true;
    },
    { pageIndex },
  );

  if (!invoked) {
    await assertPageNotRateLimited(
      page,
      `Switch page ${pageIndex + 1} missing search results`,
    );
    throw new Error(
      `Unable to switch to page ${pageIndex + 1}: g_oSearchResults missing`,
    );
  }

  const success = await page
    .waitForFunction(
      ({ beforeFirstId, pageIndex }) => {
        const g = globalThis.g_oSearchResults;
        const first = document.querySelector(
          ".market_listing_row[id^='listing_']",
        );
        const currentId = first?.id || "";
        const currentPage = Number(g?.m_iCurrentPage ?? -1);

        if (pageIndex === 0) {
          return currentPage === 0 && !!currentId;
        }

        return (
          currentPage === pageIndex &&
          !!currentId &&
          currentId !== beforeFirstId
        );
      },
      { beforeFirstId, pageIndex },
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!success) {
    await assertPageNotRateLimited(page, `Switching to page ${pageIndex + 1}`);
    throw new Error(`Timed out switching to result page ${pageIndex + 1}`);
  }

  await page.waitForTimeout(args.waitMs);
  await assertPageNotRateLimited(
    page,
    `After switching to page ${pageIndex + 1}`,
  );

  return true;
}
