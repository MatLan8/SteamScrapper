import express from "express";
import { createJob } from "../lib/job-manager.mjs";
import { buildFloatMultiArgs, buildSingleUrlArgs } from "../lib/arg-builder.mjs";
import { runFloatMultiService } from "../services/float_scraper_multi_browser_service.mjs";
import { runFloatSingleEndpointService } from "../services/float_scraper_single_endpoint_service.mjs";
import { runFloatSinglePlaywrightService } from "../services/float_scraper_single_browser_service.mjs";

export const floatRouter = express.Router();

floatRouter.post("/api/float/multi", (req, res) => {
  try {
    const args = buildFloatMultiArgs(req.body ?? {});
    const jobId = createJob("float-multi", args, runFloatMultiService);
    res.json({ jobId });
  } catch (err) {
    res.status(400).json({ error: err?.message || String(err) });
  }
});

floatRouter.post("/api/float/single-endpoint", (req, res) => {
  try {
    const args = buildSingleUrlArgs(req.body ?? {});
    const jobId = createJob("float-single-endpoint", args, runFloatSingleEndpointService);
    res.json({ jobId });
  } catch (err) {
    res.status(400).json({ error: err?.message || String(err) });
  }
});

floatRouter.post("/api/float/single-playwright", (req, res) => {
  try {
    const args = buildSingleUrlArgs(req.body ?? {});
    const jobId = createJob(
      "float-single-playwright",
      args,
      runFloatSinglePlaywrightService,
    );
    res.json({ jobId });
  } catch (err) {
    res.status(400).json({ error: err?.message || String(err) });
  }
});
