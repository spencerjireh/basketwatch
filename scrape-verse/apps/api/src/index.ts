import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ingest } from "./routes/ingest.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.route("/ingest", ingest);

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`orchestrator-api listening on :${port}`);
