/**
 * Outbound sync to Google Apps Script Web App (dynamic JSON; no hardcoded business fields).
 * Env: GOOGLE_APPS_SCRIPT_WEBAPP_URL (required to enable outbound sync), APPS_SCRIPT_SYNC_ENABLED=0 to disable
 */
const crypto = require("crypto");

const STRIP_KEYS = new Set(["password_hash"]);

function getWebAppUrl() {
  return String(process.env.GOOGLE_APPS_SCRIPT_WEBAPP_URL || "").trim();
}

function isEnabled() {
  if (process.env.APPS_SCRIPT_SYNC_ENABLED === "0") return false;
  return !!getWebAppUrl();
}

function sanitizeValue(v) {
  if (v === undefined || v === null) return v;
  if (typeof v === "bigint") return String(v);
  if (Buffer.isBuffer(v)) return v.toString("base64");
  if (typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
    return sanitizeObject(v);
  }
  return v;
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (STRIP_KEYS.has(k)) continue;
    const v = obj[k];
    out[k] = sanitizeValue(v);
  }
  return out;
}

function buildSinglePayload(tab, row, matchKey) {
  const o = sanitizeObject(row);
  const payload = { __tab: tab, ...o };
  if (matchKey) payload.__matchKey = matchKey;
  return payload;
}

function buildBulkPayload(tab, rows, matchKey) {
  const payload = {
    __tab: tab,
    records: rows.map((r) => sanitizeObject(r)),
  };
  if (matchKey) payload.__matchKey = matchKey;
  return payload;
}

async function postWithRetry(url, body, { retries = 4 } = {}) {
  let lastErr;
  const bodyStr = JSON.stringify(body);
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyStr,
        redirect: "follow",
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { _raw: text.slice(0, 1500) };
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 600)}`);
      }
      return { ok: true, status: res.status, json };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 450 * 2 ** i));
    }
  }
  throw lastErr;
}

function logLine(db, tab, ok, detail) {
  try {
    const snippet =
      typeof detail === "string" ? detail.slice(0, 2000) : JSON.stringify(detail).slice(0, 2000);
    const err = ok ? null : snippet;
    db.prepare(
      `INSERT INTO apps_script_sync_log (tab, ok, response_snippet, error) VALUES (?,?,?,?)`
    ).run(tab || "", ok ? 1 : 0, ok ? snippet : null, ok ? null : err);
  } catch (e) {
    console.error("[appsScriptSync] log failed", e.message);
  }
}

async function sendPayload(db, tab, payload) {
  const url = getWebAppUrl();
  const result = await postWithRetry(url, payload);
  logLine(db, tab, true, result.json);
  return result;
}

function queueJob(db, tab, asyncWork) {
  if (!isEnabled()) return;
  setImmediate(async () => {
    try {
      await asyncWork();
    } catch (e) {
      console.error("[appsScriptSync]", tab, e.message);
      logLine(db, tab, false, e.message);
    }
  });
}

async function sendChunkedBulk(db, tab, rows, matchKey, chunkSize = 120) {
  if (!isEnabled() || !rows.length) return { ok: true, chunks: 0 };
  let chunks = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    await sendPayload(db, tab, buildBulkPayload(tab, slice, matchKey));
    chunks++;
  }
  return { ok: true, chunks };
}

function scheduleAttendance(db, attendanceId) {
  queueJob(db, "Attendance", async () => {
    const rec = db
      .prepare(
        `SELECT ar.*, u.full_name AS user_full_name, u.email AS user_email, u.login_id AS user_login_id, u.role AS user_role,
                b.name AS branch_name
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id
         LEFT JOIN branches b ON b.id = u.branch_id
         WHERE ar.id = ?`
      )
      .get(Number(attendanceId));
    if (!rec) return;
    await sendPayload(db, "Attendance", buildSinglePayload("Attendance", rec, "id"));
  });
}

function scheduleLeave(db, leaveId) {
  queueJob(db, "Leave Requests", async () => {
    const row = db
      .prepare(
        `SELECT lr.*, u.full_name AS user_full_name, u.email AS user_email, u.role AS user_role
         FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.id = ?`
      )
      .get(Number(leaveId));
    if (!row) return;
    await sendPayload(db, "Leave Requests", buildSinglePayload("Leave Requests", row, "id"));
  });
}

function scheduleUser(db, userId) {
  queueJob(db, "Users", async () => {
    const u = db
      .prepare(
        `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active, created_at
         FROM users WHERE id = ?`
      )
      .get(Number(userId));
    if (!u) return;
    await sendPayload(db, "Users", buildSinglePayload("Users", u, "id"));
  });
}

function scheduleBranch(db, branchId) {
  queueJob(db, "Branches", async () => {
    const b = db.prepare("SELECT * FROM branches WHERE id = ?").get(Number(branchId));
    if (!b) return;
    await sendPayload(db, "Branches", buildSinglePayload("Branches", b, "id"));
  });
}

function scheduleAudit(db, auditId) {
  queueJob(db, "Logs", async () => {
    const a = db.prepare("SELECT * FROM audit_logs WHERE id = ?").get(Number(auditId));
    if (!a) return;
    await sendPayload(db, "Logs", buildSinglePayload("Logs", a, "id"));
  });
}

function scheduleNotice(db, noticeId) {
  queueJob(db, "Notices", async () => {
    const n = db
      .prepare(
        `SELECT n.*, u.full_name AS author_name
         FROM notices n JOIN users u ON u.id = n.created_by
         WHERE n.id = ?`
      )
      .get(Number(noticeId));
    if (!n) return;
    await sendPayload(db, "Notices", buildSinglePayload("Notices", n, "id"));
  });
}

async function fullBulkPushAll(db) {
  if (!isEnabled()) {
    return { ok: false, message: "Apps Script sync disabled or URL missing" };
  }
  const out = { tabs: {} };

  const att = db
    .prepare(
      `SELECT ar.*, u.full_name AS user_full_name, u.email AS user_email, u.login_id AS user_login_id, u.role AS user_role,
              b.name AS branch_name
       FROM attendance_records ar
       JOIN users u ON u.id = ar.user_id
       LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY ar.id ASC LIMIT 20000`
    )
    .all();
  out.tabs.Attendance = await sendChunkedBulk(db, "Attendance", att, "id");

  const leaves = db
    .prepare(
      `SELECT lr.*, u.full_name AS user_full_name, u.email AS user_email, u.role AS user_role
       FROM leave_requests lr JOIN users u ON u.id = lr.user_id ORDER BY lr.id ASC LIMIT 10000`
    )
    .all();
  out.tabs["Leave Requests"] = await sendChunkedBulk(db, "Leave Requests", leaves, "id");

  const users = db
    .prepare(
      `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active, created_at
       FROM users ORDER BY id ASC`
    )
    .all();
  out.tabs.Users = await sendChunkedBulk(db, "Users", users, "id");

  const branches = db.prepare("SELECT * FROM branches ORDER BY id ASC").all();
  out.tabs.Branches = await sendChunkedBulk(db, "Branches", branches, "id");

  const audits = db.prepare("SELECT * FROM audit_logs ORDER BY id ASC LIMIT 20000").all();
  out.tabs.Logs = await sendChunkedBulk(db, "Logs", audits, "id");

  const notices = db
    .prepare(
      `SELECT n.*, u.full_name AS author_name FROM notices n JOIN users u ON u.id = n.created_by ORDER BY n.id ASC`
    )
    .all();
  out.tabs.Notices = await sendChunkedBulk(db, "Notices", notices, "id");

  return { ok: true, ...out };
}

async function runStartupSmokeTest(db) {
  if (!isEnabled()) {
    console.log("[appsScriptSync] Skipped startup test (disabled or no URL)");
    return { skipped: true };
  }
  const row = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get("apps_script_startup_test_ok");
  if (row && row.v === "1" && process.env.APPS_SCRIPT_FORCE_TEST !== "1") {
    return { skipped: true, reason: "already_ok" };
  }
  const testId = `hrms_test_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const payload = {
    __tab: "HRMS_Integration_Test",
    __matchKey: "test_id",
    test_id: testId,
    message: "HRMS portal automatic connectivity test",
    at: new Date().toISOString(),
    source: "hrms-portal",
  };
  try {
    await sendPayload(db, "HRMS_Integration_Test", payload);
    db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
      "apps_script_startup_test_ok",
      "1"
    );
    console.log("[appsScriptSync] Startup test OK → Google Apps Script");
    return { ok: true, testId };
  } catch (e) {
    console.error("[appsScriptSync] Startup test failed:", e.message);
    return { ok: false, error: e.message };
  }
}

function getAppsScriptStatus(db) {
  const enabled = isEnabled();
  const url = getWebAppUrl();
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  const logs = db
    .prepare(
      `SELECT id, created_at, tab, ok, substr(COALESCE(response_snippet, error, ''), 1, 400) AS detail
       FROM apps_script_sync_log ORDER BY id DESC LIMIT 25`
    )
    .all();
  const tested = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get("apps_script_startup_test_ok");
  return {
    enabled,
    webapp_host: host,
    startup_test_completed: !!(tested && tested.v === "1"),
    recent_logs: logs,
  };
}

module.exports = {
  getWebAppUrl,
  isEnabled,
  scheduleAttendance,
  scheduleLeave,
  scheduleUser,
  scheduleBranch,
  scheduleAudit,
  scheduleNotice,
  fullBulkPushAll,
  runStartupSmokeTest,
  getAppsScriptStatus,
  sanitizeObject,
};
