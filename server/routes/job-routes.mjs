import express from "express";
import { getJob, subscribe, unsubscribe } from "../lib/job-manager.mjs";

export const jobRouter = express.Router();

jobRouter.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

jobRouter.get("/api/jobs/:id/stream", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  res.write(`data: ${JSON.stringify({ type: "snapshot", ...job })}\n\n`);

  const listener = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  if (!subscribe(req.params.id, listener)) {
    res.end();
    return;
  }

  req.on("close", () => {
    unsubscribe(req.params.id, listener);
  });
});

jobRouter.post("/api/jobs/:id/cancel", (_req, res) => {
  res.status(501).json({ error: "Cancel is not implemented yet" });
});
