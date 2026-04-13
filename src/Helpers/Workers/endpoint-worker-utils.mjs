import { sleep } from "../utils/general.mjs";

/**
 * Splits HTTP render requests across workers (offset-based pages).
 * @param {number} totalListings
 * @param {number} pageSize
 * @param {number} maxWorkers
 */
export function buildHttpWorkerPlan(totalListings, pageSize, maxWorkers) {
  const totalRequests = Math.ceil(totalListings / pageSize);
  const actualWorkerCount = Math.min(maxWorkers, Math.max(1, totalRequests));
  const requestsPerWorker = Math.ceil(totalRequests / actualWorkerCount);
  const workers = [];

  for (let workerIndex = 0; workerIndex < actualWorkerCount; workerIndex += 1) {
    const requestIndexStart = workerIndex * requestsPerWorker;
    if (requestIndexStart >= totalRequests) break;

    const requestIndexEnd = Math.min(
      totalRequests - 1,
      requestIndexStart + requestsPerWorker - 1,
    );

    const requestStart = requestIndexStart * pageSize;
    const requestEnd = requestIndexEnd * pageSize;

    workers.push({
      workerIndex,
      requestIndexStart,
      requestIndexEnd,
      requestStart,
      requestEnd,
      assignedRequests: requestIndexEnd - requestIndexStart + 1,
    });
  }

  return {
    totalListings,
    totalRequests,
    workerCount: workers.length,
    requestsPerWorker,
    workers,
  };
}

/**
 * Sequential requests for one worker: stagger, cooldown between pages.
 * @param {object} plan - worker entry from buildHttpWorkerPlan().workers
 * @param {object} args - must have waitMs, debug
 * @param {number} requestSpacingMs
 * @param {number} pageSize
 * @param {(start: number) => Promise<void>} onPageStart
 */
export async function httpWorkerRun(
  plan,
  args,
  requestSpacingMs,
  pageSize,
  onPageStart,
) {
  const workerLabel = `Worker ${plan.workerIndex + 1}`;

  console.log(
    `${workerLabel}: requestIndexes ${plan.requestIndexStart}-${plan.requestIndexEnd} | starts ${plan.requestStart}-${plan.requestEnd} | assigned requests=${plan.assignedRequests}`,
  );

  const initialDelay = Math.floor(plan.workerIndex * requestSpacingMs);
  if (initialDelay > 0) {
    if (args.debug) {
      console.log(`${workerLabel}: initial stagger ${initialDelay}ms`);
    }
    await sleep(initialDelay);
  }

  let localRequestIndex = 0;

  for (
    let start = plan.requestStart;
    start <= plan.requestEnd;
    start += pageSize
  ) {
    const startedAt = Date.now();

    try {
      await onPageStart(start);
      localRequestIndex += 1;
      args.onProgress?.({
        type: "page:done",
        workerIndex: plan.workerIndex,
        currentRequest: localRequestIndex,
        totalRequests: plan.assignedRequests,
      });
    } catch (error) {
      console.log(
        `${workerLabel}: failed request start=${start}: ${error?.message || String(error)}`,
      );
      const elapsed = Date.now() - startedAt;
      const remainingCooldown = Math.max(0, args.waitMs - elapsed);
      if (remainingCooldown > 0) {
        await sleep(remainingCooldown);
      }
      break;
    }

    const elapsed = Date.now() - startedAt;
    const remainingCooldown = Math.max(0, args.waitMs - elapsed);
    if (remainingCooldown > 0) {
      await sleep(remainingCooldown);
    }
  }
}
