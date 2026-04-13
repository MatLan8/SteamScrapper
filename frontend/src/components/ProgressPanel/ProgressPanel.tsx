import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProgressSnapshot } from "@/types";
import type { ProgressEvent } from "@/types";
import styles from "./ProgressPanel.module.css";

type Props = {
  progress: ProgressSnapshot;
  log: ProgressEvent[];
  jobType: string | null;
};

function formatEvent(ev: ProgressEvent): string {
  const t = ev.type;
  if (t === "job:completed") return "Job completed";
  if (t === "job:failed") return `Job failed: ${ev.error ?? "?"}`;
  if (t === "skin:start") {
    return `Skin start: ${ev.marketHashName ?? "?"} (worker ${ev.workerIndex ?? "?"}, ${(ev.skinIndex ?? 0) + 1}/${ev.totalSkins ?? "?"})`;
  }
  if (t === "skin:pre-skipped") {
    return `Pre-skipped: ${ev.marketHashName ?? "?"}${ev.reason ? ` — ${ev.reason}` : ""}`;
  }
  if (t === "skin:done") {
    return `Skin done: ${ev.marketHashName ?? "?"} — ${ev.status ?? "done"}${ev.reason ? ` (${ev.reason})` : ""}`;
  }
  if (t === "page:done") {
    const parts = [
      ev.marketHashName ? ` ${ev.marketHashName}` : "",
      ev.currentPage != null && ev.totalPages != null
        ? ` page ${ev.currentPage}/${ev.totalPages}`
        : "",
      ev.currentRequest != null && ev.totalRequests != null
        ? ` request ${ev.currentRequest}/${ev.totalRequests}`
        : "",
      ev.listingsCollected != null ? ` listings ${ev.listingsCollected}` : "",
    ];
    return `Page done:${parts.join("")}`;
  }
  if (t === "snapshot") {
    return "Snapshot: job state";
  }
  return JSON.stringify(ev);
}

function isWorkerEvent(ev: ProgressEvent): boolean {
  return typeof ev.workerIndex === "number";
}

function partitionLog(log: ProgressEvent[]) {
  const global: ProgressEvent[] = [];
  const byWorker = new Map<number, ProgressEvent[]>();
  let maxWorkerIndex = -1;
  for (const ev of log) {
    if (isWorkerEvent(ev)) {
      const w = ev.workerIndex as number;
      maxWorkerIndex = Math.max(maxWorkerIndex, w);
      const arr = byWorker.get(w) ?? [];
      arr.push(ev);
      byWorker.set(w, arr);
    } else {
      global.push(ev);
    }
  }
  return { global, byWorker, maxWorkerIndex };
}

export function ProgressPanel({ progress, log, jobType }: Props) {
  const total = progress.totalSkins || 0;
  const done = progress.completedSkins || 0;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;

  const isMulti = jobType?.includes("multi");

  const { global, byWorker, maxWorkerIndex } = useMemo(
    () => partitionLog(log),
    [log],
  );

  const workerCount = maxWorkerIndex + 1;

  return (
    <Card className={styles.card}>
      <CardHeader className={styles.header}>
        <CardTitle className={styles.title}>Progress</CardTitle>
      </CardHeader>
      <CardContent className={styles.content}>
        <div className={styles.summary}>
          {isMulti ? (
            <>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Skins</span>
                <span className={styles.statValue}>
                  {done} / {total || "…"}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Skipped</span>
                <span className={styles.statValue}>
                  {progress.skippedSkins}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Failed</span>
                <span className={styles.statValue}>
                  {progress.failedSkins}
                </span>
              </div>
            </>
          ) : (
            <div className={styles.stat}>
              <span className={styles.statLabel}>Single listing scan</span>
              <span className={styles.statValue}>
                {progress.currentSkin?.currentRequest != null &&
                progress.currentSkin?.totalRequests != null
                  ? `Request ${progress.currentSkin.currentRequest}/${progress.currentSkin.totalRequests}`
                  : progress.currentSkin?.currentPage != null
                    ? `Page ${progress.currentSkin.currentPage}${progress.currentSkin.totalPages ? `/${progress.currentSkin.totalPages}` : ""}`
                    : "—"}
              </span>
            </div>
          )}

          {isMulti && total > 0 ? (
            <div className={styles.barWrap}>
              <div className={styles.bar} style={{ width: `${pct}%` }} />
            </div>
          ) : null}

          {progress.currentSkin?.marketHashName ? (
            <p className={styles.current}>
              Current:{" "}
              <strong>{progress.currentSkin.marketHashName}</strong>
              {progress.currentSkin.workerIndex != null
                ? ` · Worker ${progress.currentSkin.workerIndex}`
                : ""}
            </p>
          ) : null}
        </div>

        <div className={styles.logSection}>
          <div className={styles.logTitle}>Event log</div>

          {global.length > 0 ? (
            <div className={styles.generalBlock}>
              <div className={styles.generalLabel}>General</div>
              <div className={styles.log}>
                {global.map((ev, i) => (
                  <div key={`g-${i}`} className={styles.logLine}>
                    <span className={styles.logIdx}>{i + 1}</span>
                    <code className={styles.logText}>{formatEvent(ev)}</code>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {isMulti && workerCount > 0 ? (
            <div className={styles.workerGrid}>
              {Array.from({ length: workerCount }, (_, wIdx) => {
                const wEvents = byWorker.get(wIdx) ?? [];
                const isLastOddFull =
                  workerCount % 2 === 1 && wIdx === workerCount - 1;
                return (
                  <div
                    key={wIdx}
                    className={
                      isLastOddFull
                        ? `${styles.workerCell} ${styles.workerCellFull}`
                        : styles.workerCell
                    }
                  >
                    <div className={styles.workerHeading}>
                      Worker {wIdx + 1}
                    </div>
                    <div className={styles.workerLogInner}>
                      {wEvents.length === 0 ? (
                        <p className={styles.logEmpty}>
                          Waiting for events…
                        </p>
                      ) : (
                        wEvents.map((ev, i) => (
                          <div key={`${wIdx}-${i}`} className={styles.logLine}>
                            <span className={styles.logIdx}>{i + 1}</span>
                            <code className={styles.logText}>
                              {formatEvent(ev)}
                            </code>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {!isMulti ? (
            <div className={styles.log}>
              {log.length === 0 ? (
                <p className={styles.logEmpty}>Waiting for events…</p>
              ) : (
                log.map((ev, i) => (
                  <div key={i} className={styles.logLine}>
                    <span className={styles.logIdx}>{i + 1}</span>
                    <code className={styles.logText}>{formatEvent(ev)}</code>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {isMulti &&
          workerCount === 0 &&
          global.length === 0 &&
          log.length === 0 ? (
            <div className={styles.log}>
              <p className={styles.logEmpty}>Waiting for events…</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
