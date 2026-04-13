import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArgumentsForm } from "@/components/ArgumentsForm/ArgumentsForm";
import { ProgressPanel } from "@/components/ProgressPanel/ProgressPanel";
import {
  ResultsTable,
  type ColumnDef,
} from "@/components/ResultsTable/ResultsTable";
import { ScraperMethodSelector } from "@/components/ScraperMethodSelector/ScraperMethodSelector";
import { ScraperModeSelector } from "@/components/ScraperModeSelector/ScraperModeSelector";
import { StatusBadge } from "@/components/StatusBadge/StatusBadge";
import { WeaponPicker } from "@/components/WeaponPicker/WeaponPicker";
import { useElapsedTimer } from "@/hooks/useElapsedTimer";
import { useJob } from "@/hooks/useJob";
import {
  mergeMultiTopResults,
  singleResultsToRows,
  type ResultRow,
} from "@/lib/floatResultRows";
import { steamListingUrl } from "@/lib/steamLinks";
import {
  validateFloatMultiArgs,
  validateSingleUrlArgs,
} from "@/lib/validation";
import type {
  FloatMultiResults,
  FloatSingleResults,
  ScraperMethod,
  ScraperMode,
} from "@/types";
import {
  defaultsFromFields,
  MULTI_BROWSER_FIELDS,
  SINGLE_ENDPOINT_FIELDS,
  SINGLE_PLAYWRIGHT_FIELDS,
} from "./floatFields";
import styles from "./FloatScraper.module.css";

const MODE_OPTIONS = [
  { id: "multi", label: "Multi", description: "All skins for a weapon" },
  { id: "single", label: "Single", description: "One listing URL" },
];

const METHOD_OPTIONS_BASE = [
  {
    id: "browser",
    label: "Browser",
    description: "Playwright (Chromium)",
  },
  {
    id: "endpoint",
    label: "Endpoint",
    description: "HTTP render API",
  },
];

function pickFields(mode: ScraperMode, method: ScraperMethod) {
  if (mode === "multi") return MULTI_BROWSER_FIELDS;
  if (method === "endpoint") return SINGLE_ENDPOINT_FIELDS;
  return SINGLE_PLAYWRIGHT_FIELDS;
}

function buildMultiBody(
  v: Record<string, string | number | boolean>,
  weapon: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    weapon: weapon.trim(),
    wear: String(v.wear ?? "fn").toLowerCase(),
    mode: String(v.mode ?? "lowest").toLowerCase(),
    quality: String(v.quality ?? "normal").toLowerCase(),
    top: Number(v.top),
    workers: Number(v.workers),
    waitMs: Number(v.waitMs),
    headful: Boolean(v.headful),
    debug: Boolean(v.debug),
  };
  const c = String(v.cookie ?? "").trim();
  if (c) body.cookie = c;
  if (v.maxSkins !== "" && v.maxSkins != null)
    body.maxSkins = Number(v.maxSkins);
  if (v.maxListingsPerSkin !== "" && v.maxListingsPerSkin != null)
    body.maxListingsPerSkin = Number(v.maxListingsPerSkin);
  if (v.maxPrice !== "" && v.maxPrice != null)
    body.maxPrice = Number(v.maxPrice);
  return body;
}

function buildSingleBody(
  v: Record<string, string | number | boolean>,
  playwright: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    url: String(v.url ?? "").trim(),
    mode: String(v.mode ?? "lowest").toLowerCase(),
    top: Number(v.top),
    waitMs: Number(v.waitMs),
    maxWindows: Number(v.maxWindows),
    debug: Boolean(v.debug),
  };
  const c = String(v.cookie ?? "").trim();
  if (c) body.cookie = c;
  if (!playwright) body.currency = Number(v.currency ?? 3);
  body.headful = playwright ? Boolean(v.headful) : false;
  if (v.maxPrice !== "" && v.maxPrice != null)
    body.maxPrice = Number(v.maxPrice);
  return body;
}

type FieldsProps = {
  mode: ScraperMode;
  method: ScraperMethod;
  runDisabled: boolean;
  startJob: (path: string, body: Record<string, unknown>) => Promise<unknown>;
};

function FloatScraperFields({
  mode,
  method,
  runDisabled,
  startJob,
}: FieldsProps) {
  const fields = useMemo(() => pickFields(mode, method), [mode, method]);
  const [values, setValues] = useState(() => defaultsFromFields(fields));
  const [weapon, setWeapon] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onFieldChange = useCallback(
    (name: string, value: string | number | boolean) => {
      setValues((prev) => ({ ...prev, [name]: value }));
    },
    [],
  );

  const handleRun = async () => {
    setErrors({});
    if (mode === "multi") {
      const body = buildMultiBody(values, weapon);
      const v = validateFloatMultiArgs(body);
      if (!v.valid) {
        setErrors(v.errors);
        return;
      }
      await startJob("/api/float/multi", body);
      return;
    }
    const playwright = method === "browser";
    const body = buildSingleBody(values, playwright);
    const v = validateSingleUrlArgs(body);
    if (!v.valid) {
      setErrors(v.errors);
      return;
    }
    const path = playwright
      ? "/api/float/single-playwright"
      : "/api/float/single-endpoint";
    await startJob(path, body);
  };

  if (mode === "multi" && method === "endpoint") {
    return (
      <p className={styles.placeholder}>
        Float multi via endpoint is not implemented yet. Switch to Browser or
        use Single mode.
      </p>
    );
  }

  return (
    <>
      {mode === "multi" ? (
        <>
          <WeaponPicker value={weapon} onChange={setWeapon} />
          {errors.weapon ? (
            <p className={styles.weaponError}>{errors.weapon}</p>
          ) : null}
        </>
      ) : null}
      <ArgumentsForm
        fields={fields}
        values={values}
        errors={errors}
        onChange={onFieldChange}
      />
      <div className={styles.actions}>
        <Button type="button" onClick={handleRun} disabled={runDisabled}>
          Run scraper
        </Button>
      </div>
    </>
  );
}

export default function FloatScraper() {
  const [mode, setMode] = useState<ScraperMode>("multi");
  const [method, setMethod] = useState<ScraperMethod>("browser");

  const job = useJob();

  const methodOptions = useMemo(() => {
    if (mode === "multi") {
      return METHOD_OPTIONS_BASE.map((o) =>
        o.id === "endpoint"
          ? {
              ...o,
              disabled: true as const,
              disabledReason:
                "Float multi via HTTP endpoint is not available yet.",
            }
          : o,
      );
    }
    return METHOD_OPTIONS_BASE.map((o) => ({ ...o }));
  }, [mode]);

  const runDisabled =
    (mode === "multi" && method === "endpoint") || job.status === "running";

  const hasFinished = job.status === "completed" || job.status === "failed";

  const isRunning = job.status === "running";

  const elapsedLabel = useElapsedTimer(hasFinished);

  const displayRows = useMemo((): ResultRow[] => {
    if (!job.results || job.status !== "completed") return [];
    const a = job.args ?? {};
    if (job.jobType?.includes("multi")) {
      const r = job.results as FloatMultiResults;
      const globalTop = Number(a.top ?? 10);
      const m = String(a.mode ?? "lowest").toLowerCase() as
        | "lowest"
        | "highest";
      return mergeMultiTopResults(r, m, globalTop);
    }
    const r = job.results as FloatSingleResults;
    return singleResultsToRows(r);
  }, [job.results, job.status, job.args, job.jobType]);

  const multiFailedSkipped = useMemo(() => {
    if (
      !job.results ||
      job.status !== "completed" ||
      !job.jobType?.includes("multi")
    ) {
      return null;
    }
    const r = job.results as FloatMultiResults;
    const failedSkins = r.failedSkins ?? [];
    const skippedSkins = r.skippedSkins ?? [];
    if (failedSkins.length === 0 && skippedSkins.length === 0) return null;
    return { failedSkins, skippedSkins };
  }, [job.results, job.status, job.jobType]);

  const tableColumns: ColumnDef<ResultRow>[] = useMemo(() => {
    const base: ColumnDef<ResultRow>[] = [];
    if (job.jobType?.includes("multi")) {
      base.push({
        id: "skinName",
        header: "Skin name",
        sortValue: (row) => row.skinName ?? "",
        cell: (row) => row.skinName ?? "—",
      });
    }
    base.push(
      {
        id: "floatValue",
        header: "Float",
        sortValue: (row) => row.floatValue,
        cell: (row) => row.floatValue.toFixed(6),
      },
      {
        id: "price",
        header: "Price",
        sortValue: (row) => row.priceText ?? "",
        cell: (row) => row.priceText ?? "—",
      },
      {
        id: "page",
        header: "Page",
        sortValue: (row) => row.page ?? -1,
        cell: (row) => (row.page != null ? String(row.page) : "—"),
      },
      {
        id: "listingId",
        header: "Listing ID",
        sortValue: (row) => row.listingId,
        cell: (row) => row.listingId,
      },
      {
        id: "inspect",
        header: "Inspect",
        sortValue: (row) => row.inspectLink ?? "",
        cell: (row) =>
          row.inspectLink ? (
            <a
              href={row.inspectLink}
              className={styles.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open
            </a>
          ) : (
            "—"
          ),
      },
      {
        id: "steam",
        header: "Steam",
        sortValue: (row) => row.marketHashName + row.listingId,
        cell: (row) => (
          <a
            href={steamListingUrl(row.marketHashName, row.listingId)}
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            View
          </a>
        ),
      },
    );
    return base;
  }, [job.jobType]);

  const showProgress =
    job.status !== "idle" && (job.status === "running" || job.log.length > 0);

  const showResultsColumn = hasFinished;

  const columnsClassName = hasFinished
    ? `${styles.columns} ${styles.columnsExpanded}`
    : isRunning
      ? `${styles.columns} ${styles.columnsRunning}`
      : styles.columns;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Float scraper</h1>
        <p className={styles.subtitle}>
          Search Steam market listings for lowest or highest float values. Jobs
          run on the API server with live progress.
        </p>
      </header>

      <div className={columnsClassName}>
        <div className={styles.leftCol}>
          <Card className={styles.card}>
            <CardHeader className={styles.cardHead}>
              <div className={styles.cardTitleRow}>
                <CardTitle>Configuration</CardTitle>
                <div className={styles.cardTitleEnd}>
                  {elapsedLabel ? (
                    <span className={styles.elapsedTimer}>{elapsedLabel}</span>
                  ) : null}
                  <StatusBadge
                    status={job.status === "idle" ? "idle" : job.status}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className={styles.cardBody}>
              <div className={styles.selectors}>
                <ScraperModeSelector
                  options={MODE_OPTIONS}
                  value={mode}
                  onChange={(id) => {
                    const m = id as ScraperMode;
                    setMode(m);
                    if (m === "multi" && method === "endpoint") {
                      setMethod("browser");
                    }
                  }}
                />
                <ScraperMethodSelector
                  options={methodOptions}
                  value={method}
                  onChange={(id) => setMethod(id as ScraperMethod)}
                />
              </div>

              <FloatScraperFields
                key={`${mode}-${method}`}
                mode={mode}
                method={method}
                runDisabled={runDisabled}
                startJob={job.startJob}
              />

              {job.status !== "idle" && job.status !== "running" ? (
                <div className={styles.actions}>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => job.reset()}
                  >
                    Clear
                  </Button>
                </div>
              ) : null}

              {job.error && job.status === "failed" ? (
                <p className={styles.errorBanner}>{job.error}</p>
              ) : null}
            </CardContent>
          </Card>

          {!isRunning && showProgress ? (
            <ProgressPanel
              progress={job.progress}
              log={job.log}
              jobType={job.jobType}
            />
          ) : null}

          {job.status === "running" ? (
            <p className={styles.runHint}>
              Results will appear in the column on the right when the run
              completes.
            </p>
          ) : null}

          {job.status === "completed" &&
          multiFailedSkipped?.failedSkins.length ? (
            <Card
              className={`${styles.card} ${styles.outcomeCard} ${styles.outcomeCardFailed}`}
            >
              <CardHeader>
                <CardTitle>Failed skins</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className={styles.outcomeList}>
                  {multiFailedSkipped.failedSkins.map((f, i) => (
                    <li
                      key={`fail-${f.marketHashName}-${i}`}
                      className={styles.outcomeItem}
                    >
                      <span className={styles.outcomeName}>
                        {f.marketHashName}
                      </span>
                      <span className={styles.outcomeReason}>{f.error}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {job.status === "completed" &&
          multiFailedSkipped?.skippedSkins.length ? (
            <Card
              className={`${styles.card} ${styles.outcomeCard} ${styles.outcomeCardSkipped}`}
            >
              <CardHeader>
                <CardTitle>Skipped skins</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className={styles.outcomeList}>
                  {multiFailedSkipped.skippedSkins.map((s, i) => (
                    <li
                      key={`skip-${s.marketHashName}-${i}`}
                      className={styles.outcomeItem}
                    >
                      <span className={styles.outcomeName}>
                        {s.marketHashName}
                      </span>
                      <span className={styles.outcomeReason}>
                        {s.reason ?? "—"}
                        {s.totalCount != null
                          ? ` (${s.totalCount} listings)`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {isRunning && showProgress ? (
          <div className={styles.rightColProgress}>
            <ProgressPanel
              progress={job.progress}
              log={job.log}
              jobType={job.jobType}
            />
          </div>
        ) : null}

        {showResultsColumn ? (
          <div className={styles.rightCol}>
            {job.status === "completed" && displayRows.length > 0 ? (
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle>Results</CardTitle>
                </CardHeader>
                <CardContent className={styles.resultsCardBody}>
                  <ResultsTable
                    columns={tableColumns}
                    data={displayRows}
                    getRowKey={(row, i) => `${row.listingId}-${i}`}
                  />
                </CardContent>
              </Card>
            ) : null}

            {job.status === "completed" && displayRows.length === 0 ? (
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle>Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={styles.emptyResults}>
                    No listings matched the criteria.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {job.status === "failed" ? (
              <Card className={styles.card}>
                <CardHeader>
                  <CardTitle>Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={styles.emptyResults}>
                    {job.error?.trim()
                      ? job.error
                      : "The run failed. See the error message in the configuration card."}
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
