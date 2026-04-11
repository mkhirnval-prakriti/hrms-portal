const path = require("path");
const express = require("express");
const session = require("express-session");
const { openDb } = require("./src/db");
const { createApiRouter } = require("./src/api");
const { runStartupSmokeTest } = require("./src/appsScriptSync");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;

const db = openDb();
const apiRouter = createApiRouter(db);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "hrms-portal",
    env: process.env.NODE_ENV || "development",
    ts: new Date().toISOString(),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "hrms-portal",
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static("public"));

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

const server = app.listen(PORT, () => {
  console.log("Server Running");
  console.log(
    process.env.RENDER
      ? `Listening on port ${PORT} (Render)`
      : `http://localhost:${PORT}`
  );
  setImmediate(() => {
    runStartupSmokeTest(db).catch((e) => console.error("[appsScriptSync] startup test", e.message));
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT.`);
    process.exit(1);
  }
  throw err;
});
