/**
 * Smoke test against a running server. Run: node server.js & node scripts/verify-smoke.js
 * Uses PORT or 5000.
 */
const http = require("http");

const port = Number(process.env.PORT) || 5000;
const host = process.env.VERIFY_HOST || "127.0.0.1";

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { host, port, path, method, timeout: 10000 };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body != null) {
      req.setHeader("Content-Type", "application/json");
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  let r = await request("GET", "/health");
  if (r.status !== 200) throw new Error(`/health -> ${r.status}`);
  JSON.parse(r.body);

  r = await request("GET", "/api/health");
  if (r.status !== 200) throw new Error(`/api/health -> ${r.status}`);
  JSON.parse(r.body);

  r = await request("POST", "/api/login", {});
  if (r.status !== 400) {
    throw new Error(`POST /api/login {} expected 400, got ${r.status}`);
  }

  r = await request("GET", "/api/__smoke_not_found_route__");
  if (r.status !== 404) {
    throw new Error(`unknown /api route expected 404, got ${r.status}`);
  }

  console.log("verify-smoke: OK (health, api health, login validation, api 404)");
}

main().catch((e) => {
  console.error("verify-smoke FAILED:", e.message);
  process.exit(1);
});
