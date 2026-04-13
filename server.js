require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const { openDb } = require("./server/db");
const { createApiRouter } = require("./server/api");
const { runStartupSmokeTest } = require("./server/appsScriptSync");
const { sendDailyHrmsReport } = require("./server/dailyReport");

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT);
const effectivePort =
  Number.isFinite(PORT) && PORT > 0 ? PORT : process.env.NODE_ENV === "production" ? null : 5000;
if (effectivePort == null) {
  console.error("FATAL: PORT must be set in production (Replit and hosts inject PORT).");
  process.exit(1);
}
const HOST = process.env.HOST || "0.0.0.0";

if (process.env.NODE_ENV === "production" && !String(process.env.SESSION_SECRET || "").trim()) {
  console.error("FATAL: SESSION_SECRET is required when NODE_ENV=production (see .env.example).");
  process.exit(1);
}

/**
 * CORS: set ALLOWED_ORIGINS to a comma-separated list of allowed browser origins.
 * - Empty / unset: no CORS middleware (same-origin API calls only — typical for this app).
 * - "*": reflect request origin (avoid with credentials in production).
 * - "https://a.com,https://b.com": allow-list multiple domains.
 * In development, localhost Vite (5173) and API (5000) are auto-appended unless CORS_STRICT=1.
 */
function getCorsMiddleware() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  const s = String(raw).trim();
  if (s === "*") {
    return cors({ origin: true, credentials: true });
  }
  let list = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== "production" && process.env.CORS_STRICT !== "1") {
    const extras = [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:5000",
      "http://localhost:5000",
    ];
    for (const e of extras) {
      if (!list.includes(e)) list.push(e);
    }
  }
  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (list.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin not allowed (${origin})`));
    },
    credentials: true,
  });
}

const corsMw = getCorsMiddleware();
if (corsMw) {
  app.use(corsMw);
}

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

const db = openDb();
const apiRouter = createApiRouter(db);

function purgeDeletedUsers() {
  const mode = String(process.env.TRASH_RETENTION_MODE || "days").toLowerCase();
  const days = Number(process.env.TRASH_RETENTION_DAYS || 30);
  const minutes = Number(process.env.TRASH_RETENTION_MINUTES || 30);
  if (mode === "minutes" && Number.isFinite(minutes) && minutes > 0) {
    return db
      .prepare("DELETE FROM users WHERE deleted_at IS NOT NULL AND datetime(deleted_at) <= datetime('now', ?)")
      .run(`-${Math.floor(minutes)} minutes`);
  }
  return db
    .prepare("DELETE FROM users WHERE deleted_at IS NOT NULL AND datetime(deleted_at) <= datetime('now', ?)")
    .run(`-${Math.floor(days > 0 ? days : 30)} days`);
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "hrms-portal",
    status: "ok",
    env: process.env.NODE_ENV || "development",
    ts: new Date().toISOString(),
  });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "hrms-portal",
    status: "ok",
    env: process.env.NODE_ENV || "development",
    ts: new Date().toISOString(),
  });
});

app.use(express.json({ limit: "1mb" }));

app.use(
  session({
    name: "hrms.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use("/api", apiRouter);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/old", (req, res) => {
  res.redirect(302, "/legacy/");
});

app.use(
  "/legacy",
  express.static(path.join(__dirname, "legacy"), { index: "index.html" })
);

app.use("/portal", express.static(path.join(__dirname, "public", "portal")));

app.get(/^\/portal(\/.*)?$/, (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(__dirname, "public", "portal", "index.html"));
});

/** React (Vite) build — served before root `public/` so `/` is the HRMS SPA. */
const staticAppDir = process.env.STATIC_APP_DIR
  ? path.resolve(process.env.STATIC_APP_DIR)
  : path.join(__dirname, "dist");
const appIndex = path.join(staticAppDir, "index.html");
if (!fs.existsSync(appIndex)) {
  console.warn(`[hrms] SPA bundle not found at ${appIndex}. Run: npm run build`);
}
app.use(express.static(staticAppDir));
app.use(express.static("public"));
/** Optional History-style paths: skip APIs, uploads, legacy, portal, and real files. */
app.get(/^\/.+/, (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (path.extname(req.path)) return next();
  if (req.path.startsWith("/api")) return next();
  if (req.path.startsWith("/uploads")) return next();
  if (req.path.startsWith("/legacy")) return next();
  if (req.path.startsWith("/portal")) return next();
  res.sendFile(appIndex);
});

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found", path: req.path });
  }
  res.status(404).send("Not found");
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

const server = app.listen(effectivePort, HOST, () => {
  console.log("Server Running");
  console.log(
    process.env.RENDER
      ? `Listening on ${HOST}:${effectivePort} (Render)`
      : `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${effectivePort}`
  );
  setImmediate(() => {
    runStartupSmokeTest(db).catch((e) => console.error("[appsScriptSync] startup test", e.message));
  });
  setInterval(() => {
    sendDailyHrmsReport(db).catch((e) => console.error("[dailyReport]", e.message));
  }, 24 * 60 * 60 * 1000);
  setInterval(() => {
    try {
      purgeDeletedUsers();
    } catch (e) {
      console.error("[trash-retention]", e.message);
    }
  }, 10 * 60 * 1000);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${effectivePort} is already in use. Stop the other process or set PORT.`);
    process.exit(1);
  }
  throw err;
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});
