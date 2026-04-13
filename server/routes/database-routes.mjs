import express from "express";
import { readFile } from "node:fs/promises";
import {
  CHARM_DB_PATH,
  STICKER_DB_PATH,
} from "../../src/Helpers/Config/constants.mjs";

export const databaseRouter = express.Router();

databaseRouter.get("/api/db/stickers", async (_req, res) => {
  try {
    const raw = await readFile(STICKER_DB_PATH, "utf8");
    res.type("application/json").send(raw);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

databaseRouter.get("/api/db/charms", async (_req, res) => {
  try {
    const raw = await readFile(CHARM_DB_PATH, "utf8");
    res.type("application/json").send(raw);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
