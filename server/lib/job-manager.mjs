import { randomUUID } from "node:crypto";

/** @type {Map<string, object>} */
const jobs = new Map();

function redactArgs(args) {
  if (!args || typeof args !== "object") return args;
  const copy = { ...args };
  if (copy.cookie) copy.cookie = "[redacted]";
  delete copy.onProgress;
  delete copy._progressMarketHashName;
  return copy;
}

function broadcast(jobId, payload) {
  const job = jobs.get(jobId);
  if (!job?._listeners?.size) return;
  for (const fn of job._listeners) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} jobId
 * @param {object} event
 */
export function emitProgress(jobId, event) {
  const job = jobs.get(jobId);
  if (!job || job.status !== "running") return;

  if (event.type === "skin:start" && event.totalSkins) {
    job.progress.totalSkins = event.totalSkins;
  }

  if (event.type === "skin:start") {
    job.progress.currentSkin = {
      marketHashName: event.marketHashName,
      workerIndex: event.workerIndex,
      skinIndex: event.skinIndex,
      totalSkins: event.totalSkins,
    };
  }

  if (event.type === "skin:done") {
    job.progress.completedSkins += 1;
    if (event.status === "skipped") job.progress.skippedSkins += 1;
    if (event.status === "failed") job.progress.failedSkins += 1;
  }

  if (event.type === "page:done") {
    job.progress.currentSkin = {
      ...job.progress.currentSkin,
      marketHashName:
        event.marketHashName ?? job.progress.currentSkin?.marketHashName,
      currentPage: event.currentPage,
      totalPages: event.totalPages,
      workerIndex: event.workerIndex,
      currentRequest: event.currentRequest,
      totalRequests: event.totalRequests,
      listingsCollected: event.listingsCollected,
    };
  }

  broadcast(jobId, { ...event, jobId });
}

function snapshot(job) {
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    args: redactArgs(job.args),
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    progress: job.progress,
    results: job.results,
    error: job.error,
  };
}

/**
 * @param {string} type
 * @param {object} args
 * @param {(args: object) => Promise<object>} runner
 * @returns {string} jobId
 */
export function createJob(type, args, runner) {
  const id = randomUUID();
  const job = {
    id,
    type,
    status: "running",
    args: redactArgs({ ...args }),
    createdAt: new Date().toISOString(),
    completedAt: null,
    progress: {
      totalSkins: 0,
      completedSkins: 0,
      skippedSkins: 0,
      failedSkins: 0,
      currentSkin: null,
    },
    results: null,
    error: null,
    _listeners: new Set(),
  };
  jobs.set(id, job);

  const argsWithProgress = {
    ...args,
    onProgress: (event) => emitProgress(id, event),
  };

  Promise.resolve()
    .then(() => runner(argsWithProgress))
    .then((results) => {
      const j = jobs.get(id);
      if (!j || j.status === "cancelled") return;
      j.status = "completed";
      j.completedAt = new Date().toISOString();
      j.results = results;
      broadcast(id, {
        type: "job:completed",
        jobId: id,
        results,
      });
    })
    .catch((err) => {
      const j = jobs.get(id);
      if (!j) return;
      j.status = "failed";
      j.completedAt = new Date().toISOString();
      j.error = err?.message || String(err);
      broadcast(id, {
        type: "job:failed",
        jobId: id,
        error: j.error,
      });
    });

  return id;
}

export function getJob(jobId) {
  return snapshot(jobs.get(jobId));
}

export function subscribe(jobId, listener) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job._listeners.add(listener);
  return true;
}

export function unsubscribe(jobId, listener) {
  const job = jobs.get(jobId);
  if (!job) return;
  job._listeners.delete(listener);
}
