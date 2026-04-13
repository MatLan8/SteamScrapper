import express from "express";
import { createJob } from "../lib/job-manager.mjs";
import { buildStickerMultiArgs } from "../lib/arg-builder.mjs";
import { runStickerMultiService } from "../services/sticker_scraper_multi_browser_service.mjs";

export const stickerRouter = express.Router();

stickerRouter.post("/api/sticker/multi", (req, res) => {
  try {
    const args = buildStickerMultiArgs(req.body ?? {});
    const jobId = createJob("sticker-multi", args, runStickerMultiService);
    res.json({ jobId });
  } catch (err) {
    res.status(400).json({ error: err?.message || String(err) });
  }
});
