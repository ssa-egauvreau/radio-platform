import express from "express";
import { DEFAULT_GREEN_CHANNELS } from "./defaultChannels.js";
import { ensureChannelSchema, listChannelsFromDb } from "./db.js";

const app = express();
app.use(express.json());

const radioApiKey = process.env.RADIO_API_KEY?.trim();

function requireApiKeyUnlessDisabled(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!radioApiKey) {
    next();
    return;
  }
  if (req.path === "/health") {
    next();
    return;
  }
  const provided = req.header("x-radio-key");
  if (provided !== radioApiKey) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.use(requireApiKeyUnlessDisabled);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "security-radio-api" });
});

app.get("/v1/channels", async (_req, res) => {
  try {
    const rows = await listChannelsFromDb();
    const channels = rows && rows.length > 0 ? rows : [...DEFAULT_GREEN_CHANNELS];
    res.json({ channels });
  } catch (error) {
    console.error("Failed to read channels", error);
    res.status(500).json({ error: "channel_query_failed" });
  }
});

/** While PTT is held, Android polls this. Set AIR_OCCUPIED=1 on Railway to simulate another caller. */
app.get("/v1/air", (_req, res) => {
  const raw = process.env.AIR_OCCUPIED?.trim().toLowerCase();
  const occupied = raw === "1" || raw === "true" || raw === "yes";
  res.json({ occupied });
});

const port = Number(process.env.PORT ?? 8080);

async function main(): Promise<void> {
  await ensureChannelSchema().catch((error) => {
    console.error("Database bootstrap failed (continuing without DB)", error);
  });

  app.listen(port, () => {
    console.log(`Security Radio API listening on ${port}`);
    console.log(`RADIO_API_KEY ${radioApiKey ? "enabled" : "disabled"}`);
    console.log(`DATABASE_URL ${process.env.DATABASE_URL ? "configured" : "not set (in-memory defaults)"}`);
  });
}

main().catch((error) => {
  console.error("Fatal startup error", error);
  process.exit(1);
});
