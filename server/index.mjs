import express from "express";
import cors from "cors";
import { jobRouter } from "./routes/job-routes.mjs";
import { floatRouter } from "./routes/float-routes.mjs";
import { stickerRouter } from "./routes/sticker-routes.mjs";
import { databaseRouter } from "./routes/database-routes.mjs";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(jobRouter);
app.use(floatRouter);
app.use(stickerRouter);
app.use(databaseRouter);

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => {
  console.log(`SteamScrapper API http://localhost:${PORT}`);
});
