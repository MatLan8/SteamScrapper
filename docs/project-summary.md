# SteamScrapper — Project Summary

> Last updated: 2026-04-13

## 1. Project Overview

SteamScrapper scrapes the Steam Community Market for CS2 (Counter-Strike 2) weapon skins to find good deals. It identifies undervalued listings by analysing:

- **Float values** — the numeric wear value of a skin (0.0 = perfect, 1.0 = most worn).
- **Attached stickers** — stickers applied to weapon skins that add collectible value.
- **Attached charms (keychains)** — cosmetic charms attached to weapon skins.

Skin metadata (float, stickers, charms) is obtained by decoding each listing's `steam://` inspect link using `@csfloat/cs2-inspect-serializer`. The decoded object provides `paintwear` (float), `stickers[]`, and `keychains[]`.

### Two surfaces

| Surface | Entry | How it runs |
|---------|-------|-------------|
| **CLI** | `node src/MarketScrappers/<scraper>.mjs` with flags from `parse-args.mjs` | Direct in-process; prints results to stdout |
| **HTTP API + React UI** | `server/index.mjs` (Express) + `frontend/` (Vite/React) | Background jobs with JSON results; progress via SSE |

Shared logic lives under `src/Helpers/` and `src/MarketScrappers/`. The server imports scrapers with relative paths like `../../src/MarketScrappers/...`.

---

## 2. Repository Structure

```
SteamScrapper/
├── .gitignore
├── Database/
│   ├── sticker_db.json          # Sticker price/rarity DB
│   └── charm_db.json            # Charm price/rarity DB
├── docs/
│   └── project-summary.md       # This file
├── Test/
│   └── testDecode.mjs           # Inspect-link decode test
│
├── server/                      # Express HTTP API (§3)
│   ├── index.mjs
│   ├── package.json
│   ├── lib/
│   │   ├── job-manager.mjs
│   │   └── arg-builder.mjs
│   ├── routes/
│   │   ├── job-routes.mjs
│   │   ├── float-routes.mjs
│   │   ├── sticker-routes.mjs
│   │   └── database-routes.mjs
│   └── services/
│       ├── float_scraper_multi_browser_service.mjs
│       ├── float_scraper_single_browser_service.mjs
│       ├── float_scraper_single_endpoint_service.mjs
│       └── sticker_scraper_multi_browser_service.mjs
│
├── src/                         # Core scraping logic (§4)
│   ├── MarketScrappers/
│   │   ├── Float/
│   │   │   ├── Multi/float_scraper_multi_browser.mjs
│   │   │   └── Single/
│   │   │       ├── float_scraper_single_browser.mjs
│   │   │       └── float_scraper_single_endpoint.mjs
│   │   └── Sticker/
│   │       └── Multi/sticker_scraper_multi_browser.mjs
│   ├── Helpers/
│   │   ├── Cli/parse-args.mjs
│   │   ├── Config/constants.mjs
│   │   ├── db/load-databases.mjs
│   │   ├── Scanners/
│   │   │   ├── float-scan-utils.mjs
│   │   │   └── sticker-charm-scan-utils.mjs
│   │   ├── Steam/
│   │   │   ├── browser-utils.mjs
│   │   │   ├── endpoint-utils.mjs
│   │   │   ├── market-utils.mjs
│   │   │   └── steam-price-collection.mjs
│   │   ├── Utils/
│   │   │   ├── general.mjs
│   │   │   ├── price-utils.mjs
│   │   │   ├── sort-utils.mjs
│   │   │   └── url-utils.mjs
│   │   ├── Valuation/value-utils.mjs
│   │   └── Workers/
│   │       ├── worker-utils.mjs
│   │       ├── float-worker-utils.mjs
│   │       └── endpoint-worker-utils.mjs
│   ├── FilesCleanUp/            # One-off data cleanup scripts
│   └── PriceCollection/         # Sticker/charm price scrapers
│
└── frontend/                    # React SPA (§5)
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    ├── tsconfig*.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css / App.css
        ├── types/index.ts
        ├── lib/
        │   ├── api.ts
        │   ├── floatResultRows.ts
        │   ├── steamLinks.ts
        │   ├── validation.ts
        │   └── utils.ts
        ├── hooks/
        │   ├── useJob.ts
        │   └── useElapsedTimer.ts
        ├── pages/
        │   ├── FloatScraper/
        │   │   ├── FloatScraper.tsx
        │   │   ├── FloatScraper.module.css
        │   │   └── floatFields.ts
        │   └── PlaceholderPage/
        │       ├── PlaceholderPage.tsx
        │       └── PlaceholderPage.module.css
        └── components/
            ├── AppShell/
            ├── Sidebar/
            ├── PillNav.tsx + PillNav.css
            ├── WeaponPicker/
            ├── ArgumentsForm/
            ├── FormField/
            ├── ScraperModeSelector/
            ├── ScraperMethodSelector/
            ├── ProgressPanel/
            ├── ResultsTable/
            ├── StatusBadge/
            └── ui/ (shadcn: button, card, badge, input,
                     label, select, table, tabs, tooltip)
```

---

## 3. Backend — Server (`server/`)

### 3.1 Tech stack

- **Runtime:** Node.js (ESM, `.mjs`)
- **Framework:** Express 4 with CORS
- **Port:** `process.env.PORT` or `3001`
- **No database** — jobs are in-memory (`Map`); results are not persisted to disk

### 3.2 `server/index.mjs`

Mounts four routers: `jobRouter`, `floatRouter`, `stickerRouter`, `databaseRouter`. Provides `GET /api/health`.

### 3.3 Routes

| File | Endpoints | Purpose |
|------|-----------|---------|
| `job-routes.mjs` | `GET /api/jobs/:id` | Job snapshot (status, args, progress, results) |
| | `GET /api/jobs/:id/stream` | SSE stream for live progress |
| `float-routes.mjs` | `POST /api/float/multi` | Start float multi-weapon scan |
| | `POST /api/float/single-playwright` | Single listing via Playwright |
| | `POST /api/float/single-endpoint` | Single listing via HTTP render API |
| `sticker-routes.mjs` | `POST /api/sticker/multi` | Start sticker multi scan |
| `database-routes.mjs` | `GET /api/db/stickers`, `GET /api/db/charms` | Serve raw JSON DB files |

### 3.4 `server/lib/job-manager.mjs`

In-memory job store. Key exports:

- **`createJob(type, args, runner)`** — Creates a job, injects `onProgress` into args, runs the scraper async. Returns `jobId`.
- **`emitProgress(jobId, event)`** — Updates `job.progress` counters and broadcasts SSE. Handles event types:
  - `skin:start` — sets `totalSkins` and `currentSkin`
  - `skin:pre-skipped` — increments `skippedSkins` only (NOT `completedSkins`)
  - `skin:done` — increments `completedSkins`; also increments `skippedSkins` or `failedSkins` based on `event.status`
  - `page:done` — updates `currentSkin` page/request counters
- **`subscribe/unsubscribe`** — SSE listener management
- **`getJob`** — Returns job snapshot (redacted args, no `onProgress`)

Progress object shape:

```javascript
{
  totalSkins: 0,
  completedSkins: 0,
  skippedSkins: 0,
  failedSkins: 0,
  currentSkin: null  // { marketHashName, workerIndex, skinIndex, ... }
}
```

### 3.5 `server/lib/arg-builder.mjs`

Validates and transforms HTTP request bodies into the args shape expected by scrapers. Exports:

- `buildFloatMultiArgs(body)` — weapon, wear (fn/bs), mode, quality, top, workers, waitMs, maxSkins, maxListingsPerSkin, maxPrice, cookie, headful, debug
- `buildSingleUrlArgs(body)` — url, mode, top, maxWindows, waitMs, currency, maxPrice, cookie, headful, debug
- `buildStickerMultiArgs(body)` — weapon, wear, workers, waitMs, maxSkins, etc.

### 3.6 Services

Thin wrappers that import and call the `run*` functions from `src/MarketScrappers/`. Some strip large fields before returning (e.g. sticker service removes `missingTracker`, `allResults`).

---

## 4. Backend — Scraping Logic (`src/`)

### 4.1 Entry points (`src/MarketScrappers/`)

| Scraper | File | Function | What it does |
|---------|------|----------|--------------|
| Float Multi | `Float/Multi/float_scraper_multi_browser.mjs` | `runFloatMultiWeapon(args)` | Searches all skins for a weapon+wear, pre-filters by price and listing count, distributes to Playwright workers, each worker visits skin pages and decodes float values |
| Float Single (Playwright) | `Float/Single/float_scraper_single_browser.mjs` | `runFloatSinglePlaywright(args)` | Scrapes one listing URL via Playwright |
| Float Single (Endpoint) | `Float/Single/float_scraper_single_endpoint.mjs` | `runFloatSingleEndpoint(args)` | Scrapes one listing URL via HTTP render API |
| Sticker Multi | `Sticker/Multi/sticker_scraper_multi_browser.mjs` | `runStickerCharmMulti(args)` | Searches skins, loads sticker/charm DBs for valuation, distributes to workers |

### 4.2 Float Multi pipeline (`runFloatMultiWeapon`)

```
1. fetchFloatWeaponSkinSearchResults(args, headers)
   → Steam search API, paginated, returns all matching skins

2. Pre-filter: maxPrice (EUR cents)

3. Pre-filter: listing threshold
   → skins with sell_listings > (maxListingsPerSkin ?? 1000) are removed
   → these emit "skin:pre-skipped" progress events (only increment skippedSkins)
   → added to preSkipped array for final results

4. splitItemsForWorkers(skinResults, args.workers)
   → round-robin distribution into N buckets

5. Promise.all → floatWeaponWorkerRun(idx, bucket, args, floatScanSkinPage)
   → each worker: launch Playwright, iterate skins, call floatScanSkinPage per skin
   → wrappedArgs ensures all onProgress events carry workerIndex

6. Merge results: skinResults + skippedSkins (pre-skip + worker-skip) + failedSkins
```

### 4.3 `floatScanSkinPage` (`src/Helpers/Scanners/float-scan-utils.mjs`)

Per-skin scanner called by workers:

1. Navigate to listing page
2. Wait for stable DOM + force page size to 100
3. Read `meta` (totalCount, pageSize, currentPage)
4. **Safety-net skip:** if `totalCount > (maxListingsPerSkin ?? SKIP_LISTING_THRESHOLD)`, skip
5. Page through listings, decode inspect links for float values
6. Respect `maxListingsPerSkin` cap via `seenIds.size` check in paging loop
7. Rank results by float (lowest or highest mode), return top N

### 4.4 Worker utilities

- **`worker-utils.mjs`** — `splitItemsForWorkers` (round-robin), `workerRun` (generic Playwright loop used by sticker scraper)
- **`float-worker-utils.mjs`** — `floatWeaponWorkerRun` (float-specific: wraps `onProgress` to inject `workerIndex`, handles rate-limit cascading across remaining skins)
- **`endpoint-worker-utils.mjs`** — HTTP-based worker helpers

### 4.5 Key shared modules

| Module | Exports | Purpose |
|--------|---------|---------|
| `Config/constants.mjs` | `SEARCH_URL`, `APPID`, `CURRENCY`, `SKIP_LISTING_THRESHOLD` (1000), `DEFAULT_*`, `WEAR_MAP`, `USER_AGENT`, DB paths | Central configuration |
| `Steam/market-utils.mjs` | `fetchFloatWeaponSkinSearchResults`, `fetchAllSkinSearchResults`, `buildSearchHeaders`, `fetchJson`, `isWeaponSkinFloatSearchMatch` | Steam API interaction |
| `Steam/browser-utils.mjs` | `setupBrowserContext`, `isRateLimitText`, rate-limit helpers, page wait utilities | Playwright browser management |
| `Steam/endpoint-utils.mjs` | HTTP render API parsing helpers | Endpoint-based scraping |
| `Cli/parse-args.mjs` | `parseFloatMultiArgs`, `parseSingleUrlArgs`, `parseWeaponSearchArgs`, `parseArgs` | CLI argument parsing |
| `db/load-databases.mjs` | Sticker/charm DB loading | Valuation data |
| `Valuation/value-utils.mjs` | Sticker/charm scoring | Price-vs-value calculations |

---

## 5. Frontend (`frontend/`)

### 5.1 Tech stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19 | UI framework |
| TypeScript | 6.0 | Type safety |
| Vite | 8 | Build tool + dev server |
| Tailwind CSS | 4 | Utility-first styling |
| shadcn/ui (Radix) | — | UI primitives (button, card, select, tooltip, etc.) |
| CSS Modules | — | Component-scoped styles (`.module.css`) |
| react-router-dom | 6 | Client-side routing |
| lucide-react | — | Icons |
| GSAP | 3 | PillNav animation |
| Geist Variable | — | Font |

### 5.2 Routing (`App.tsx`)

Wrapped in `<TooltipProvider>` (Radix). Routes inside `<AppShell>`:

| Path | Component |
|------|-----------|
| `/`, `/float-scraper` | `FloatScraper` |
| `/sticker-scraper` | `PlaceholderPage` ("Not implemented") |
| `/charm-scraper` | `PlaceholderPage` ("Not implemented") |

### 5.3 Types (`types/index.ts`)

Key types:

- `ScraperMode` = `"single" | "multi"`
- `ScraperMethod` = `"endpoint" | "browser"`
- `JobStatus` = `"running" | "completed" | "failed"`
- `ProgressSnapshot` — mirrors server's `job.progress`
- `ProgressEvent` — SSE event payload (type, workerIndex, marketHashName, status, etc.)
- `JobSnapshot` — full job state from server
- `FloatMultiResults`, `FloatSingleResults` — scraper result shapes
- `FieldConfig` — form field descriptor (name, label, type, options, helpText, etc.)

### 5.4 Hooks

#### `useJob.ts`

Central job lifecycle hook. State: `jobId`, `jobType`, `args`, `status`, `progress`, `results`, `error`, `log`.

- **`startJob(path, body)`** — POST to API, then open `EventSource` to `/api/jobs/:id/stream`
- **SSE handling:**
  - First message (snapshot): overwrites full state
  - `job:completed` / `job:failed`: update status, close connection
  - Other events: append to `log[]`, merge into `progress` via `mergeProgressFromEvent`
- **`mergeProgressFromEvent(prev, ev)`** — mirrors server's `emitProgress` logic client-side:
  - `skin:start` → set `totalSkins`, `currentSkin`
  - `skin:pre-skipped` → increment `skippedSkins` only
  - `skin:done` → increment `completedSkins` (+ `skippedSkins`/`failedSkins` by status)
  - `page:done` → update `currentSkin` page/request info
- **`reset()`** — clears all state, closes EventSource

#### `useElapsedTimer.ts`

`useElapsedTimer(active: boolean): string | null` — starts counting when `active` becomes true. Format: `"42s"` under 60s, `"2m 15s"` after. Returns `null` when inactive.

### 5.5 Library modules (`lib/`)

| File | Exports | Purpose |
|------|---------|---------|
| `api.ts` | `getApiBase()` | Returns `VITE_API_BASE` or `http://localhost:3001` |
| `validation.ts` | `validateFloatMultiArgs`, `validateSingleUrlArgs` | Client-side form validation (mirrors `arg-builder.mjs`) |
| `floatResultRows.ts` | `ResultRow`, `mergeMultiTopResults`, `singleResultsToRows` | Transform API results into table rows |
| `steamLinks.ts` | `steamListingUrl(marketHashName, listingId)` | Build Steam market listing URLs |
| `utils.ts` | `cn()` | Tailwind class merge utility |

### 5.6 Pages

#### `FloatScraper` (main page)

The primary UI. Contains:

- **Mode selector** (Multi / Single)
- **Method selector** (Browser / Endpoint — endpoint disabled for multi)
- **WeaponPicker** (multi mode only) — categorized weapon buttons (Pistols, SMGs, Rifles, Heavy, Other)
- **ArgumentsForm** — dynamic form from `floatFields.ts` field configs
- **Configuration card** with StatusBadge and elapsed timer
- **ProgressPanel** — shown in right column (2fr) while running, moves under config when finished
- **ResultsTable** — sortable table with float, price, page, listing ID, inspect link, Steam link

Layout states:
- **Idle**: single centered column (`max-width: 700px`)
- **Running**: two-column grid (`1fr 2fr`) — config left, progress right
- **Completed/Failed**: two-column grid (`1fr 1fr`) — config+progress left, results right

`floatFields.ts` defines `MULTI_BROWSER_FIELDS`, `SINGLE_ENDPOINT_FIELDS`, `SINGLE_PLAYWRIGHT_FIELDS` with `FieldConfig[]` and `defaultsFromFields()`.

#### `PlaceholderPage`

Simple "not implemented" page for sticker and charm scrapers.

### 5.7 Components

| Component | Props | Purpose |
|-----------|-------|---------|
| `AppShell` | — | Layout shell: PillNav header + `<Outlet />` |
| `Sidebar` | — | Side navigation (float active, sticker/charm disabled) |
| `PillNav` | logo, items, colors | Animated top navigation bar (GSAP sliding pill) |
| `WeaponPicker` | `value`, `onChange` | Categorized CS2 weapon selector grid |
| `ArgumentsForm` | `fields`, `values`, `errors`, `onChange` | Renders FieldConfig[] in a 2-3 column grid with Required/Optional sections |
| `FormField` | `field`, `value`, `onChange`, `error?` | Single form field with label, tooltip help icon (1s delay), validation error |
| `ScraperModeSelector` | `options`, `value`, `onChange` | Multi/Single mode tabs |
| `ScraperMethodSelector` | `options`, `value`, `onChange` | Browser/Endpoint method tabs with disabled tooltip support |
| `ProgressPanel` | `progress`, `log`, `jobType` | Stats (skins done/total, skipped, failed), progress bar, per-worker event log grid |
| `ResultsTable` | `columns`, `data`, `getRowKey` | Generic sortable table with `ColumnDef<T>` |
| `StatusBadge` | `status` | Colored status pill (idle/running/completed/failed) |

**ProgressPanel event log layout** (multi mode):
- General events (snapshot, job:completed, job:failed) shown in a full-width "General" container
- Worker events grouped into per-worker containers in a 2-column CSS grid
- If odd number of workers, last worker gets full width
- Each worker container is independently scrollable

**FormField features:**
- Help text shown via Radix Tooltip with 1-second hover delay (lucide `Info` icon)
- Number inputs have spinner buttons hidden via CSS
- Checkbox fields use a label + info icon layout

### 5.8 UI components (`components/ui/`)

shadcn-style Radix primitives: `button`, `card`, `badge`, `input`, `label`, `select`, `table`, `tabs`, `tooltip`. All use Tailwind classes with `cn()` merge.

---

## 6. Data Flow — End-to-End

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (React)                                                │
│                                                                 │
│  FloatScraper page                                              │
│  ├─ WeaponPicker → weapon state                                 │
│  ├─ ArgumentsForm → form values                                 │
│  ├─ validation.ts → client-side checks                          │
│  └─ useJob.startJob(path, body)                                 │
│       ├─ POST /api/float/multi (or single-*)                    │
│       └─ EventSource /api/jobs/:id/stream                       │
│            ├─ snapshot → full state sync                         │
│            ├─ skin:pre-skipped → skippedSkins++                  │
│            ├─ skin:start → totalSkins, currentSkin               │
│            ├─ skin:done → completedSkins++                       │
│            ├─ page:done → currentSkin page info                  │
│            ├─ job:completed → final results                      │
│            └─ job:failed → error message                         │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────────────┐
│ Server (Express)                                                │
│                                                                 │
│  float-routes.mjs                                               │
│  ├─ arg-builder.mjs → validate + transform body                 │
│  └─ job-manager.createJob(type, args, runner)                   │
│       ├─ inject onProgress = emitProgress(jobId, event)         │
│       └─ runner(argsWithProgress)                               │
│            │                                                    │
│  service wrapper → runFloatMultiWeapon(args)                    │
└────────────────────────┬────────────────────────────────────────┘
                         │ in-process
┌────────────────────────▼────────────────────────────────────────┐
│ Scraper Logic (src/)                                            │
│                                                                 │
│  runFloatMultiWeapon:                                           │
│  1. fetchFloatWeaponSkinSearchResults → Steam search API        │
│  2. Pre-filter: maxPrice → remove expensive skins               │
│  3. Pre-filter: sell_listings > threshold → skin:pre-skipped    │
│  4. splitItemsForWorkers → round-robin into N buckets           │
│  5. Promise.all(floatWeaponWorkerRun per bucket)                │
│       └─ per skin: floatScanSkinPage(page, name, args, label)  │
│            ├─ Navigate to listing page (Playwright)             │
│            ├─ Force page size, read meta                        │
│            ├─ Safety skip if totalCount > threshold             │
│            ├─ Page through listings, decode inspect links       │
│            ├─ Emit page:done progress per page                  │
│            └─ Rank + return top N floats                        │
│  6. Merge all results + skipped + failed                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Key Configuration (`src/Helpers/Config/constants.mjs`)

| Constant | Value | Purpose |
|----------|-------|---------|
| `SEARCH_URL` | Steam market search API | Skin discovery |
| `APPID` | `730` | CS2 app ID |
| `CURRENCY` | `3` | EUR |
| `SEARCH_PAGE_SIZE` | `100` | Search API page size |
| `TARGET_PAGE_SIZE` | `100` | Listing page forced page size |
| `SKIP_LISTING_THRESHOLD` | `1000` | Default max listings before a skin is skipped |
| `DEFAULT_FLOAT_TOP` | `10` | Default top results to keep |
| `DEFAULT_FLOAT_WAIT_MS` | `1500` | Default wait between requests |
| `DEFAULT_WORKERS` | `3` | Default Playwright worker count |
| `WEAR_MAP` | `{ fn, bs }` | Wear config (display name, searchTag, range) |

---

## 8. Running the Project

### Backend (API server)

```bash
cd server
npm install
npm start          # or: npm run dev (with --watch)
```

Starts Express on `http://localhost:3001`.

### Frontend (React dev server)

```bash
cd frontend
npm install
npm run dev        # Vite dev server (default http://localhost:5173)
npm run build      # Production build to frontend/dist/
```

The frontend calls `http://localhost:3001` by default (configurable via `VITE_API_BASE` env var).

### CLI (direct scraper execution)

```bash
node src/MarketScrappers/Float/Multi/float_scraper_multi_browser.mjs \
  --weapon "AWP" --wear bs --mode lowest --top 5 --workers 2
```

See `src/Helpers/Cli/parse-args.mjs` for all available flags.

---

## 9. Important Implementation Details

### Pre-skip vs worker-skip (float multi)

- **Pre-skip**: During scouting, skins with `sell_listings` (from Steam search API) exceeding the threshold are removed before worker assignment. These emit `skin:pre-skipped` events which only increment `skippedSkins` (not `completedSkins`), keeping the progress bar accurate.
- **Worker-skip**: Safety net inside `floatScanSkinPage` — if the real `totalCount` (from the listing page DOM) exceeds the threshold, the skin is skipped at the worker level. This catches cases where `sell_listings` was stale.
- **Threshold**: `args.maxListingsPerSkin ?? SKIP_LISTING_THRESHOLD (1000)`

### SSE event types

| Type | Emitted by | When |
|------|-----------|------|
| `snapshot` | `job-routes.mjs` | First SSE frame — full job state |
| `skin:pre-skipped` | `runFloatMultiWeapon` | Scouting phase pre-filter |
| `skin:start` | `float-worker-utils.mjs` | Worker begins processing a skin |
| `skin:done` | `float-worker-utils.mjs` | Worker finishes a skin (status: success/skipped/failed) |
| `page:done` | `float-scan-utils.mjs` | One page of listings processed |
| `job:completed` | `job-manager.mjs` | Runner promise resolved |
| `job:failed` | `job-manager.mjs` | Runner promise rejected |

### Worker progress injection

`floatWeaponWorkerRun` wraps `args.onProgress` so all events emitted inside `scanSkinPage` automatically carry `workerIndex`. This allows the frontend to partition log events by worker.

### Layout transitions

The `FloatScraper` page uses CSS grid transitions:
- **Idle**: centered single column (`max-width: 700px`)
- **Running**: `1fr 2fr` grid (config left, progress right) — `columnsRunning` class
- **Finished**: `1fr 1fr` grid (config+progress left, results right) — `columnsExpanded` class
- Transitions animate via CSS `transition` on `grid-template-columns`, `max-width`, `margin`

### Sticker scraper differences

The sticker scraper does NOT pre-filter by listing count during scouting. It only skips skins when a worker enters the listing page, applies sticker filters, and then checks if the count exceeds the threshold. This is different from the float scraper's pre-skip behaviour.
