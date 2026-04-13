import { useCallback, useEffect, useRef, useState } from "react";
import type { JobSnapshot, ProgressEvent, ProgressSnapshot } from "@/types";
import { getApiBase } from "@/lib/api";

type JobState = {
  jobId: string | null;
  jobType: string | null;
  args: Record<string, unknown> | null;
  status: JobSnapshot["status"] | "idle";
  progress: ProgressSnapshot;
  results: unknown;
  error: string | null;
  log: ProgressEvent[];
};

const initialProgress: ProgressSnapshot = {
  totalSkins: 0,
  completedSkins: 0,
  skippedSkins: 0,
  failedSkins: 0,
  currentSkin: null,
};

export function useJob() {
  const [state, setState] = useState<JobState>({
    jobId: null,
    jobType: null,
    args: null,
    status: "idle",
    progress: initialProgress,
    results: null,
    error: null,
    log: [],
  });
  const esRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const subscribe = useCallback(
    (jobId: string) => {
      cleanup();
      const base = getApiBase();
      const url = `${base}/api/jobs/${jobId}/stream`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data) as ProgressEvent & {
            type?: string;
          };
          const t = payload.type;

          /* Initial SSE payload is { type: "snapshot", ...job } but job.type overwrites "snapshot" */
          if (
            "id" in payload &&
            "progress" in payload &&
            "status" in payload &&
            "args" in payload
          ) {
            const snap = payload as unknown as JobSnapshot;
            setState((s) => ({
              ...s,
              jobId: snap.id,
              jobType: snap.type,
              args: snap.args ?? null,
              status: snap.status,
              progress: snap.progress ?? initialProgress,
              results: snap.results,
              error: snap.error,
              log: [...s.log, { ...payload, type: "snapshot" }],
            }));
            return;
          }

          if (t === "job:completed") {
            setState((s) => ({
              ...s,
              status: "completed",
              results: payload.results,
              error: null,
              log: [...s.log, payload],
              args: s.args,
            }));
            es.close();
            esRef.current = null;
            return;
          }

          if (t === "job:failed") {
            setState((s) => ({
              ...s,
              status: "failed",
              error: payload.error ?? "Unknown error",
              log: [...s.log, payload],
            }));
            es.close();
            esRef.current = null;
            return;
          }

          setState((s) => ({
            ...s,
            log: [...s.log, payload],
            progress: mergeProgressFromEvent(s.progress, payload),
          }));
        } catch {
          /* ignore malformed */
        }
      };

      es.onerror = () => {
        /* EventSource may reconnect; keep connection open */
      };
    },
    [cleanup],
  );

  const startJob = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      cleanup();
      setState({
        jobId: null,
        jobType: null,
        args: null,
        status: "running",
        progress: initialProgress,
        results: null,
        error: null,
        log: [],
      });

      const base = getApiBase();
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };

      if (!res.ok || !data.jobId) {
        setState((s) => ({
          ...s,
          jobType: null,
          args: null,
          status: "failed",
          error: data.error ?? res.statusText,
        }));
        return { ok: false as const, error: data.error ?? res.statusText };
      }

      setState((s) => ({ ...s, jobId: data.jobId! }));
      subscribe(data.jobId);
      return { ok: true as const, jobId: data.jobId };
    },
    [cleanup, subscribe],
  );

  const reset = useCallback(() => {
    cleanup();
    setState({
      jobId: null,
      jobType: null,
      args: null,
      status: "idle",
      progress: initialProgress,
      results: null,
      error: null,
      log: [],
    });
  }, [cleanup]);

  return {
    ...state,
    startJob,
    reset,
  };
}

function mergeProgressFromEvent(
  prev: ProgressSnapshot,
  ev: ProgressEvent,
): ProgressSnapshot {
  if (ev.type === "skin:start" && ev.totalSkins) {
    return {
      ...prev,
      totalSkins: ev.totalSkins,
      currentSkin: {
        marketHashName: ev.marketHashName,
        workerIndex: ev.workerIndex,
        skinIndex: ev.skinIndex,
        totalSkins: ev.totalSkins,
      },
    };
  }
  if (ev.type === "skin:start") {
    return {
      ...prev,
      currentSkin: {
        marketHashName: ev.marketHashName,
        workerIndex: ev.workerIndex,
        skinIndex: ev.skinIndex,
        totalSkins: ev.totalSkins,
      },
    };
  }
  if (ev.type === "skin:pre-skipped") {
    return {
      ...prev,
      skippedSkins: prev.skippedSkins + 1,
    };
  }

  if (ev.type === "skin:done") {
    return {
      ...prev,
      completedSkins: prev.completedSkins + 1,
      skippedSkins:
        ev.status === "skipped" ? prev.skippedSkins + 1 : prev.skippedSkins,
      failedSkins:
        ev.status === "failed" ? prev.failedSkins + 1 : prev.failedSkins,
    };
  }
  if (ev.type === "page:done") {
    return {
      ...prev,
      currentSkin: {
        ...prev.currentSkin,
        marketHashName: ev.marketHashName ?? prev.currentSkin?.marketHashName,
        currentPage: ev.currentPage,
        totalPages: ev.totalPages,
        workerIndex: ev.workerIndex ?? prev.currentSkin?.workerIndex,
        currentRequest: ev.currentRequest,
        totalRequests: ev.totalRequests,
        listingsCollected: ev.listingsCollected,
      },
    };
  }
  return prev;
}
