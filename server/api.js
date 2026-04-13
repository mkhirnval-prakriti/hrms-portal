const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { defaultPayrollSettings, computePayrollRow } = require("./payrollEngine");
const { can, requirePerm, listRolesMeta, ROLES } = require("./rbac");
const {
  isOrgWide,
  isBranchScoped,
  assertUserAccess,
  assertUserIdAccess,
  branchScopeSql,
  assertRoleAssignableOnCreate,
} = require("./accessScope");
const { haversineMeters, parseHmToMinutes } = require("./geo");
const { reverseGeocode } = require("./geocode");
const {
  syncAttendanceRows,
  scheduleAttendanceSync,
  scheduleLeaveSync,
  scheduleUserSync,
  scheduleBranchSync,
  scheduleAuditSync,
  fullSyncAll,
  getGoogleAuthUrl,
  exchangeCodeAndSave,
  getIntegrationStatus,
  setSyncEnabled,
  disconnectGoogle,
} = require("./googleSheets");
const { registerLeaveRoutes } = require("./leaveRoutes");
const { registerEnterpriseRoutes } = require("./enterpriseRoutes");
const { registerProductRoutes } = require("./productRoutes");
const { registerWebAuthnRoutes, verifyWebAuthnForAttendancePunch } = require("./webauthnAttendance");
const { registerBiometricRoutes } = require("./biometricRoutes");
const { phashFromBuffer, hammingHex } = require("./faceHash");
const { matchEmbedding, parseEmbeddingPayload } = require("./faceEmbedding");
const { notifyPunchWhatsApp } = require("./whatsapp");
const { createHrAlert, listRecentAlerts, generateOtp } = require("./alertsService");
const { sendMail, sendAlertEmailToAdmins } = require("./emailService");
const {
  scheduleAttendance: appsScriptScheduleAttendance,
  scheduleLeave: appsScriptScheduleLeave,
  scheduleUser: appsScriptScheduleUser,
  scheduleBranch: appsScriptScheduleBranch,
  scheduleAudit: appsScriptScheduleAudit,
  scheduleNotice: appsScriptScheduleNotice,
  fullBulkPushAll: appsScriptFullBulkPushAll,
  getAppsScriptStatus,
} = require("./appsScriptSync");

function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localMinutesFromDate(iso) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function jwtSecret() {
  let s = String(process.env.JWT_SECRET || "").trim();
  if (!s) s = String(process.env.SESSION_SECRET || "").trim();
  if (s) return s;
  const v = crypto.randomBytes(48).toString("hex");
  process.env.JWT_SECRET = v;
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[hrms] jwtSecret: JWT_SECRET and SESSION_SECRET were empty — generated ephemeral JWT secret (set secrets for stable tokens)."
    );
  }
  return v;
}

function signJwt(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret(), { expiresIn: "7d" });
}

function mapSimpleRole(role) {
  if (role === ROLES.USER) return "staff";
  if (role === ROLES.LOCATION_MANAGER) return "branch_manager";
  if (role === ROLES.SUPER_ADMIN) return "super_admin";
  if (role === ROLES.ADMIN) return "admin";
  return "attendance_manager";
}

function mapIncomingRole(simple) {
  const r = String(simple || "").toLowerCase();
  if (r === "admin") return ROLES.ADMIN;
  if (r === "hr" || r === "attendance_manager") return ROLES.ATTENDANCE_MANAGER;
  if (r === "manager" || r === "location") return ROLES.LOCATION_MANAGER;
  if (r === "staff") return ROLES.USER;
  if (r === "super_admin") return ROLES.SUPER_ADMIN;
  return null;
}

function generateEmployeeLoginId() {
  return `PH-EMP-${Date.now().toString().slice(-6)}`;
}

function branchCodeFromName(name) {
  const raw = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!raw) return "GEN";
  return raw.slice(0, 3).padEnd(3, "X");
}

function minutesBetweenIso(a, b) {
  if (!a || !b) return 0;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return d > 0 ? Math.round(d) : 0;
}

function createApiRouter(db) {
  const router = express.Router();
  function generateBranchEmployeeId(branchId) {
    const b = branchId
      ? db.prepare("SELECT id, name FROM branches WHERE id = ?").get(Number(branchId))
      : null;
    const code = branchCodeFromName(b?.name);
    const row = db
      .prepare(
        `SELECT login_id FROM users
         WHERE login_id LIKE ?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(`PH-${code}-%`);
    const nextNum = (() => {
      if (!row?.login_id) return 101;
      const m = String(row.login_id).match(/-(\d+)$/);
      return m ? Number(m[1]) + 1 : 101;
    })();
    return `PH-${code}-${String(nextNum).padStart(3, "0")}`;
  }

  function normalizeRoleInput(input) {
    const raw = String(input || "").trim().toLowerCase();
    if (raw === "super_admin" || raw === "super admin") return ROLES.SUPER_ADMIN;
    if (raw === "admin") return ROLES.ADMIN;
    if (raw === "branch_manager" || raw === "branch manager" || raw === "manager") return ROLES.LOCATION_MANAGER;
    if (raw === "attendance_manager" || raw === "attendance manager" || raw === "hr") {
      return ROLES.ATTENDANCE_MANAGER;
    }
    if (raw === "staff" || raw === "user") return ROLES.USER;
    return mapIncomingRole(raw);
  }

  const uploadRoot = path.join(__dirname, "..", "uploads", "attendance");
  fs.mkdirSync(uploadRoot, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadRoot),
      filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
        const safe = /^\.(jpg|jpeg|png|webp)$/i.test(ext) ? ext : ".jpg";
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${safe}`);
      },
    }),
    limits: { fileSize: 6 * 1024 * 1024 },
  });

  const uploadFacesRoot = path.join(__dirname, "..", "uploads", "faces");
  fs.mkdirSync(uploadFacesRoot, { recursive: true });
  const uploadFace = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadFacesRoot),
      filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
        const safe = /^\.(jpg|jpeg|png|webp)$/i.test(ext) ? ext : ".jpg";
        cb(null, `face-${Date.now()}-${Math.random().toString(36).slice(2)}${safe}`);
      },
    }),
    limits: { fileSize: 6 * 1024 * 1024 },
  });

  const uploadDocsRoot = path.join(__dirname, "..", "uploads", "documents");
  fs.mkdirSync(uploadDocsRoot, { recursive: true });
  const uploadDoc = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDocsRoot),
      filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || ".pdf").toLowerCase();
        const safe = /^\.(pdf|jpg|jpeg|png|webp)$/i.test(ext) ? ext : ".bin";
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${safe}`);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
  });

  function attachUser(req, res, next) {
    const auth = req.headers.authorization;
    if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(auth.slice(7), jwtSecret());
        const uid = payload.sub;
        if (!uid) return res.status(401).json({ error: "Unauthorized" });
        const user = db
          .prepare(
            `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active,
             COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_manual,1) AS allow_manual,
             COALESCE(allow_biometric,0) AS allow_biometric
             FROM users WHERE id = ? AND deleted_at IS NULL`
          )
          .get(uid);
        if (!user || !user.active) return res.status(401).json({ error: "Unauthorized" });
        req.currentUser = user;
        return next();
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const user = db
      .prepare(
        `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active,
         COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_manual,1) AS allow_manual,
         COALESCE(allow_biometric,0) AS allow_biometric
         FROM users WHERE id = ? AND deleted_at IS NULL`
      )
      .get(req.session.userId);
    if (!user || !user.active) {
      req.session.destroy();
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.currentUser = user;
    next();
  }

  function insertAudit(actorId, action, entityType, entityId, details) {
    const info = db
      .prepare(
        `INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, details) VALUES (?,?,?,?,?)`
      )
      .run(
        action,
        entityType,
        String(entityId),
        actorId,
        details != null ? JSON.stringify(details) : null
      );
    scheduleAuditSync(db, info.lastInsertRowid);
    appsScriptScheduleAudit(db, info.lastInsertRowid);
  }

  function raiseHrAlert(payload) {
    try {
      createHrAlert(db, payload);
      setImmediate(() => {
        sendAlertEmailToAdmins(db, {
          subject: String(payload.type || "alert"),
          text: String(payload.message || ""),
        }).catch(() => {});
      });
    } catch (e) {
      console.error("[hr_alerts]", e.message);
    }
  }

  const APP_SETTINGS_KEY = "app_runtime_settings";
  const COMPANY_PROFILE_KEY = "company_profile";
  function readCompanyProfile() {
    const r = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get(COMPANY_PROFILE_KEY);
    const base = {
      company_name: "Prakriti Herbs Private Limited",
      address: "Amer, Jaipur, Rajasthan - 302012",
      city: "Jaipur",
      state: "Rajasthan",
      pincode: "302012",
      gstin: "08AAQCP4095D1Z2",
      cin: "U46497RJ2025PTC109202",
      director: "Mandeep Kumar",
      phone: "",
      email: "",
    };
    if (!r || !r.v) return base;
    try {
      return { ...base, ...JSON.parse(r.v) };
    } catch {
      return base;
    }
  }
  function writeCompanyProfile(obj) {
    db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
      COMPANY_PROFILE_KEY,
      JSON.stringify(obj)
    );
  }

  function defaultAppSettings() {
    return {
      app_name: "Prakriti HRMS",
      session_ttl_days: 7,
      features: {
        kiosk: true,
        geo_fence: true,
        face_recognition: false,
        wifi_restriction: false,
      },
      attendance_wifi: {
        enabled: false,
        allowed_ssids: [],
      },
      daily_report: {
        enabled: true,
        recipients: ["contact@prakritiherbs.in", "mkhirnval@gmail.com"],
      },
    };
  }
  function readAppSettings() {
    const r = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get(APP_SETTINGS_KEY);
    if (!r || !r.v) return defaultAppSettings();
    try {
      return { ...defaultAppSettings(), ...JSON.parse(r.v) };
    } catch {
      return defaultAppSettings();
    }
  }
  function writeAppSettings(obj) {
    db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
      APP_SETTINGS_KEY,
      JSON.stringify(obj)
    );
  }
  const SHEET_INTEGRATION_KEY = "sheet_integration_v1";
  function readSheetIntegration() {
    const row = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get(SHEET_INTEGRATION_KEY);
    const base = {
      enabled: false,
      mode: "webhook",
      google_sheet_link: "",
      api_key: "",
      default_webhook_url: "",
      branch_map: {},
      last_sync_at: "",
      last_error: "",
    };
    if (!row?.v) return base;
    try {
      return { ...base, ...JSON.parse(row.v) };
    } catch {
      return base;
    }
  }
  function writeSheetIntegration(next) {
    db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
      SHEET_INTEGRATION_KEY,
      JSON.stringify(next)
    );
  }
  function sheetConnectSnippet() {
    return `fetch("YOUR_GOOGLE_SHEET_WEBHOOK_URL", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    employee_name: employee.name,
    employee_id: employee.login_id,
    branch: employee.branch,
    role: employee.role,
    punch_in: attendance.checkIn,
    punch_out: attendance.checkOut,
    total_hours: attendance.totalHours,
    date: attendance.date
  })
});`;
  }
  async function pushAttendanceToConfiguredSheet(attendanceId) {
    const cfg = readSheetIntegration();
    if (!cfg.enabled) return { skipped: true, reason: "disabled" };
    const row = db
      .prepare(
        `SELECT ar.id, ar.work_date, ar.punch_in_at, ar.punch_out_at, ar.status, u.full_name, u.login_id, u.role,
                b.id AS branch_id, b.name AS branch_name
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id
         LEFT JOIN branches b ON b.id = u.branch_id
         WHERE ar.id = ?`
      )
      .get(Number(attendanceId));
    if (!row) return { skipped: true, reason: "not_found" };
    const url =
      (row.branch_id != null && cfg.branch_map && cfg.branch_map[String(row.branch_id)]) ||
      cfg.default_webhook_url;
    if (!url) return { skipped: true, reason: "no_webhook_url" };
    const inAt = row.punch_in_at ? new Date(row.punch_in_at) : null;
    const outAt = row.punch_out_at ? new Date(row.punch_out_at) : null;
    const totalHours =
      inAt && outAt ? Math.max(0, ((outAt.getTime() - inAt.getTime()) / 36e5)).toFixed(2) : "";
    const payload = {
      employee_name: row.full_name,
      employee_id: row.login_id || "",
      branch: row.branch_name || "",
      role: row.role || "",
      punch_in: row.punch_in_at || "",
      punch_out: row.punch_out_at || "",
      total_hours: totalHours,
      date: row.work_date,
      status: row.status,
    };
    try {
      const r = await fetch(String(url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`Webhook sync failed (${r.status})`);
      writeSheetIntegration({
        ...cfg,
        last_sync_at: new Date().toISOString(),
        last_error: "",
      });
      return { ok: true };
    } catch (e) {
      writeSheetIntegration({
        ...cfg,
        last_error: String(e.message || e),
      });
      return { ok: false, error: String(e.message || e) };
    }
  }

  const PAYROLL_SETTINGS_KEY = "payroll_settings_v1";
  function readPayrollSettings() {
    const r = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get(PAYROLL_SETTINGS_KEY);
    if (!r || !r.v) return defaultPayrollSettings();
    try {
      return { ...defaultPayrollSettings(), ...JSON.parse(r.v) };
    } catch {
      return defaultPayrollSettings();
    }
  }
  function writePayrollSettings(obj) {
    const next = { ...readPayrollSettings(), ...obj };
    db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
      PAYROLL_SETTINGS_KEY,
      JSON.stringify(next)
    );
    return next;
  }

  function sumDeliveryDailyForMonth(userId, period) {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(amount_inr), 0) AS s FROM payroll_delivery_daily
         WHERE user_id = ? AND substr(work_date, 1, 7) = ?`
      )
      .get(Number(userId), String(period).slice(0, 7));
    return Number(row && row.s) || 0;
  }

  function listEffectivePermissions(user) {
    const meta = {};
    const keys = [
      "dashboard:read",
      "dashboard:read_self",
      "attendance:self",
      "attendance:read_all",
      "attendance:punch",
      "attendance:manual",
      "attendance:edit_any",
      "attendance:kiosk",
      "attendance:face_placeholder",
      "history:read",
      "history:read_self",
      "history:edit",
      "branches:read",
      "branches:write",
      "departments:read",
      "departments:write",
      "users:read",
      "users:create",
      "users:update",
      "notices:read",
      "notices:write",
      "timings:read",
      "timings:read_self",
      "timings:write",
      "roles:read",
      "settings:read",
      "settings:write",
      "leave:apply",
      "leave:read_self",
      "leave:read_all",
      "leave:approve_manager",
      "export:read",
      "integrations:sync",
      "payroll:read",
      "payroll:read_self",
      "payroll:write",
      "documents:read_all",
      "documents:verify",
      "audit:read",
      "crm:read",
      "crm:write",
      "biometric:admin",
      "biometric:request_update",
    ];
    keys.forEach((k) => {
      meta[k] = can(user, k);
    });
    return meta;
  }

  function finishLogin(req, res, user) {
    req.session.userId = user.id;
    insertAudit(user.id, "login", "session", String(user.id), { path: "login" });
    const token = signJwt(user);
    res.json({
      token,
      id: user.id,
      email: user.email,
      login_id: user.login_id,
      full_name: user.full_name,
      role: user.role,
      branch_id: user.branch_id,
      permissions: listEffectivePermissions(user),
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        login_id: user.login_id,
        role: mapSimpleRole(user.role),
        rbacRole: user.role,
        branch_id: user.branch_id,
      },
    });
  }

  function loginFromBody(req, res) {
    const { email, password, login } = req.body || {};
    const idOrEmail = String(email || login || "").trim();
    if (!idOrEmail || !password) {
      return res.status(400).json({ error: "Email or user ID and password required" });
    }
    const user = db
      .prepare(
        `SELECT id, email, login_id, password_hash, full_name, role, branch_id, active FROM users
         WHERE (lower(email) = lower(?) OR lower(ifnull(login_id,'')) = lower(?)) AND deleted_at IS NULL`
      )
      .get(idOrEmail, idOrEmail);
    if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    finishLogin(req, res, user);
  }

  router.post("/auth/otp/request", async (req, res, next) => {
    try {
      const email = String(req.body?.email || "").trim();
      if (!email) return res.status(400).json({ error: "email required" });
      const user = db
        .prepare(`SELECT id, email FROM users WHERE lower(email) = lower(?) AND deleted_at IS NULL AND active = 1`)
        .get(email);
      if (!user) return res.status(404).json({ error: "No active account with this email" });
      const code = generateOtp();
      const exp = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      db.prepare(`INSERT INTO login_otps (email, code, expires_at) VALUES (?,?,?)`).run(email, code, exp);
      await sendMail({
        to: email,
        subject: "HRMS — login verification code",
        text: `Your one-time code: ${code}\nValid for 10 minutes.`,
      });
      res.json({ ok: true, message: "OTP sent to email" });
    } catch (e) {
      next(e);
    }
  });

  router.post("/auth/login", (req, res) => loginFromBody(req, res));
  router.post("/login", (req, res) => loginFromBody(req, res));

  router.post("/auth/change-password", attachUser, (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password || String(new_password).length < 6) {
      return res.status(400).json({ error: "current_password and new_password (min 6 chars) required" });
    }
    const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.currentUser.id);
    if (!row || !bcrypt.compareSync(String(current_password), row.password_hash)) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(bcrypt.hashSync(String(new_password), 10), req.currentUser.id);
    insertAudit(req.currentUser.id, "password_change", "user", String(req.currentUser.id), {});
    res.json({ ok: true });
  });

  router.post("/auth/forgot-password", async (req, res, next) => {
    try {
      const idOrMobile = String(req.body?.email || req.body?.mobile || "").trim();
      if (!idOrMobile) return res.status(400).json({ error: "email or mobile required" });
      const user = db
        .prepare(
          `SELECT id, email FROM users WHERE deleted_at IS NULL AND active = 1 AND (
            lower(email) = lower(?) OR replace(ifnull(mobile,''),' ','') = replace(?,' ','')
          )`
        )
        .get(idOrMobile, idOrMobile);
      if (!user) {
        return res.json({ ok: true, message: "If an account exists, an OTP will be sent." });
      }
      const code = generateOtp();
      const exp = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      db.prepare(`DELETE FROM password_reset_otps WHERE user_id = ?`).run(user.id);
      db.prepare(`INSERT INTO password_reset_otps (user_id, otp_code, expires_at, attempts) VALUES (?,?,?,0)`).run(
        user.id,
        code,
        exp
      );
      await sendMail({
        to: user.email,
        subject: "Prakriti Herbs HRMS — password reset OTP",
        text: `Your OTP code: ${code}\nValid for 5 minutes. Do not share this code.\nIf you did not request a reset, ignore this email.`,
      });
      res.json({ ok: true, message: "If an account exists, an OTP was sent to the registered email." });
    } catch (e) {
      next(e);
    }
  });

  router.post("/auth/verify-otp", (req, res) => {
    const emailOrMobile = String(req.body?.email || req.body?.mobile || "").trim();
    const otp = String(req.body?.otp || "").trim();
    if (!emailOrMobile || !otp) {
      return res.status(400).json({ error: "email (or mobile) and otp required" });
    }
    const user = db
      .prepare(
        `SELECT id, email FROM users WHERE deleted_at IS NULL AND active = 1 AND (
          lower(email) = lower(?) OR replace(ifnull(mobile,''),' ','') = replace(?,' ','')
        )`
      )
      .get(emailOrMobile, emailOrMobile);
    if (!user) {
      return res.status(400).json({ error: "Invalid OTP" });
    }
    const row = db
      .prepare(`SELECT * FROM password_reset_otps WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
      .get(user.id);
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }
    if (Number(row.attempts) >= 3) {
      return res.status(400).json({ error: "Too many attempts. Request a new OTP." });
    }
    if (String(row.otp_code) !== otp) {
      db.prepare(`UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
      return res.status(400).json({ error: "Invalid OTP" });
    }
    const resetToken = crypto.randomBytes(32).toString("hex");
    const exp = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare(`DELETE FROM password_reset_otps WHERE user_id = ?`).run(user.id);
    db.prepare(`INSERT OR REPLACE INTO password_reset_tokens (token, user_id, expires_at) VALUES (?,?,?)`).run(
      resetToken,
      user.id,
      exp
    );
    res.json({ ok: true, reset_token: resetToken, expires_in_minutes: 15 });
  });

  router.post("/auth/reset-password", (req, res) => {
    const { token, new_password } = req.body || {};
    if (!token || !new_password || String(new_password).length < 6) {
      return res.status(400).json({ error: "token and new_password (min 6 chars) required" });
    }
    const row = db.prepare(`SELECT * FROM password_reset_tokens WHERE token = ?`).get(String(token));
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
      bcrypt.hashSync(String(new_password), 10),
      row.user_id
    );
    db.prepare(`DELETE FROM password_reset_tokens WHERE token = ?`).run(String(token));
    insertAudit(row.user_id, "password_reset_token", "user", String(row.user_id), {});
    res.json({ ok: true });
  });

  router.post("/auth/logout", attachUser, (req, res) => {
    const uid = req.currentUser.id;
    insertAudit(uid, "logout", "session", String(uid), {});
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.get("/auth/me", attachUser, (req, res) => {
    const u = req.currentUser;
    res.json({
      id: u.id,
      email: u.email,
      login_id: u.login_id,
      full_name: u.full_name,
      role: u.role,
      branch_id: u.branch_id,
      shift_start: u.shift_start,
      shift_end: u.shift_end,
      grace_minutes: u.grace_minutes,
      permissions: listEffectivePermissions(u),
    });
  });

  function branchGeoCheck(user, lat, lng) {
    if (!user.branch_id) return { ok: true };
    const b = db.prepare("SELECT * FROM branches WHERE id = ?").get(user.branch_id);
    if (!b || b.lat == null || b.lng == null) return { ok: true };
    if (lat == null || lng == null) {
      return {
        ok: false,
        reason:
          "GPS coordinates required for this branch (enable location or use “Punch from office location”).",
      };
    }
    const dist = haversineMeters(Number(lat), Number(lng), b.lat, b.lng);
    if (dist > b.radius_meters) {
      return {
        ok: false,
        reason: `Outside allowed radius (${Math.round(dist)}m > ${b.radius_meters}m).`,
      };
    }
    return { ok: true, distance_m: Math.round(dist) };
  }

  function getOrCreateDay(userId, workDate) {
    let rec = db
      .prepare("SELECT * FROM attendance_records WHERE user_id = ? AND work_date = ?")
      .get(userId, workDate);
    if (!rec) {
      const info = db
        .prepare(
          `INSERT INTO attendance_records (user_id, work_date, status, source)
           VALUES (?, ?, 'absent', 'device')`
        )
        .run(userId, workDate);
      rec = db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(info.lastInsertRowid);
    }
    return rec;
  }

  function computeLateStatus(user, punchInIso) {
    if (!punchInIso) return "present";
    const startM = parseHmToMinutes(user.shift_start);
    const actualM = localMinutesFromDate(punchInIso);
    if (actualM > startM + Number(user.grace_minutes || 0)) return "late";
    return "present";
  }

  function devicePayload(req) {
    return JSON.stringify({
      ua: req.headers["user-agent"] || "",
      platform: req.headers["sec-ch-ua-platform"] || "",
      mobile: req.headers["sec-ch-ua-mobile"] || "",
    });
  }

  async function runPunch(req, res, next) {
    try {
      const actor = req.currentUser;
      const type = req.body.type;
      let lat = req.body.lat !== undefined && req.body.lat !== "" ? Number(req.body.lat) : null;
      let lng = req.body.lng !== undefined && req.body.lng !== "" ? Number(req.body.lng) : null;
      const source = req.body.source;
      const targetUserId = req.body.targetUserId;
      if (type !== "in" && type !== "out") {
        return res.status(400).json({ error: "type must be 'in' or 'out'" });
      }
      if (!can(actor, "attendance:punch")) {
        return res.status(403).json({ error: "Forbidden" });
      }

      let subjectId = actor.id;
      if (targetUserId && Number(targetUserId) !== actor.id) {
        if (!can(actor, "attendance:read_all")) {
          return res.status(403).json({ error: "Cannot punch for other users" });
        }
        subjectId = Number(targetUserId);
      }

      const subject = db
        .prepare(
          `SELECT id, branch_id, role, shift_start, shift_end, grace_minutes, active,
           COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_manual,1) AS allow_manual,
           COALESCE(allow_biometric,0) AS allow_biometric
           FROM users WHERE id = ? AND deleted_at IS NULL`
        )
        .get(subjectId);
      if (!subject || !subject.active) {
        return res.status(404).json({ error: "User not found" });
      }
      const scopePunch = assertUserAccess(actor, subject);
      if (!scopePunch.ok) {
        return res.status(scopePunch.status).json({ error: scopePunch.error });
      }

      if (req.body.useBranchCenter === true && subject.branch_id) {
        const br = db.prepare("SELECT lat, lng FROM branches WHERE id = ?").get(subject.branch_id);
        if (br && br.lat != null && br.lng != null) {
          lat = Number(br.lat);
          lng = Number(br.lng);
        }
      }

      const explicitMethod = String(req.body.attendanceMethod || req.body.method || "").toLowerCase();
      const useOfficeCenter = req.body.useBranchCenter === true && subject.branch_id;
      let punchMethod = explicitMethod;
      if (!punchMethod) {
        if (req.file) punchMethod = "face";
        else punchMethod = "gps";
      }
      const allowedMethods = ["gps", "office", "face", "fingerprint"];
      if (!allowedMethods.includes(punchMethod)) punchMethod = req.file ? "face" : "gps";
      if (explicitMethod === "fingerprint") {
        punchMethod = "fingerprint";
      } else if (useOfficeCenter && punchMethod !== "face") {
        punchMethod = "office";
      }

      if (punchMethod === "fingerprint" && (lat == null || lng == null) && subject.branch_id) {
        const br = db.prepare("SELECT lat, lng FROM branches WHERE id = ?").get(subject.branch_id);
        if (br && br.lat != null && br.lng != null) {
          lat = Number(br.lat);
          lng = Number(br.lng);
        }
      }

      if (punchMethod === "face" && Number(subject.allow_face) === 0) {
        return res.status(403).json({ error: "Face attendance is disabled for this account." });
      }
      if (punchMethod === "face" && !req.file) {
        return res.status(400).json({ error: "Photo required for face attendance" });
      }
      if (punchMethod === "fingerprint" && Number(subject.allow_biometric) === 0) {
        return res.status(403).json({ error: "Fingerprint attendance is disabled for this account." });
      }
      const wifiCfg = readAppSettings().attendance_wifi || { enabled: false, allowed_ssids: [] };
      if (wifiCfg.enabled) {
        const ssid = String(req.body?.wifi_ssid || req.body?.ssid || "").trim().toLowerCase();
        const allowed = Array.isArray(wifiCfg.allowed_ssids)
          ? wifiCfg.allowed_ssids.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
          : [];
        if (!ssid || (allowed.length > 0 && !allowed.includes(ssid))) {
          return res.status(403).json({ error: "Attendance allowed only on configured office WiFi SSID." });
        }
      }

      if (!useOfficeCenter && lat != null && lng != null && subject.allow_gps === 0) {
        raiseHrAlert({
          type: "unauthorized_mode",
          severity: "critical",
          message: `GPS punch blocked for user #${subjectId} (${subject.email || "no email"})`,
          userId: subjectId,
          actorId: actor.id,
          meta: { mode: "gps" },
        });
        return res.status(403).json({
          error: "GPS punch disabled for this employee. Use office location or contact HR.",
        });
      }

      const geo = branchGeoCheck(subject, lat, lng);
      if (!geo.ok) {
        raiseHrAlert({
          type: "wrong_location",
          severity: "warning",
          message: `Outside radius / invalid location: ${geo.reason} — user #${subjectId}`,
          userId: subjectId,
          actorId: actor.id,
          meta: { lat, lng },
        });
        return res.status(400).json({ error: geo.reason });
      }

      /** Overlap network I/O with WebAuthn user gesture / verification (saves ~0.5–3s typical). */
      const addressPromise = reverseGeocode(lat, lng, { timeoutMs: 3500 });

      const webAuthnGate = await verifyWebAuthnForAttendancePunch({
        db,
        req,
        subjectId,
        actorId: actor.id,
      });
      if (!webAuthnGate.ok) {
        return res.status(webAuthnGate.status).json({
          error: webAuthnGate.error,
          code: webAuthnGate.code,
        });
      }

      if (req.file && req.file.size < 8192) {
        return res.status(400).json({ error: "Photo file too small — use a live camera capture (min 8KB)" });
      }

      let faceVerificationLabel = "none";
      if (req.file) {
        const prof = db
          .prepare("SELECT phash, embedding_json FROM user_face_profiles WHERE user_id = ?")
          .get(subjectId);
        const candEmb = parseEmbeddingPayload(req.body?.faceDescriptor);
        if (prof && prof.embedding_json && String(prof.embedding_json).trim().length > 10) {
          if (!candEmb) {
            return res.status(400).json({
              error:
                "Live face verification required: use the in-app camera flow (blink + movement) so a face descriptor is sent with the photo.",
            });
          }
          const embMatch = matchEmbedding(prof.embedding_json, candEmb);
          if (!embMatch.ok) {
            return res.status(400).json({
              error: "Face does not match enrolled embedding — try again with clearer lighting.",
              code: "FACE_EMBEDDING_MISMATCH",
            });
          }
          faceVerificationLabel = "face_embedding_matched";
        } else if (prof && prof.phash) {
          try {
            const buf = fs.readFileSync(req.file.path);
            const newHash = phashFromBuffer(buf);
            const dist = hammingHex(newHash, prof.phash);
            if (dist > 20) {
              return res.status(400).json({
                error: "Face does not match enrolled profile — use live capture aligned with enrollment.",
              });
            }
            faceVerificationLabel = "face_matched";
          } catch (e) {
            return res.status(400).json({ error: "Face verification failed: " + (e.message || String(e)) });
          }
        } else {
          faceVerificationLabel = "face_captured";
        }
      }

      const address = await addressPromise;
      const photoPath = req.file ? `/uploads/attendance/${req.file.filename}` : null;
      const devInfo = devicePayload(req);
      const devShort = String(devInfo).slice(0, 4000);
      let verificationVal = "ok";
      if (punchMethod === "face") {
        verificationVal = faceVerificationLabel;
      } else if (punchMethod === "fingerprint") {
        const vs = req.body.verificationStatus ?? req.body.fingerprintStatus;
        verificationVal =
          vs === true || vs === 1 || String(vs).toLowerCase() === "verified" ? "verified" : "pending";
      } else if (punchMethod === "gps") {
        verificationVal = geo.ok ? "gps_ok" : "gps";
      } else if (punchMethod === "office") {
        verificationVal = "office_location";
      }

      const workDate = todayLocalDate();
      const rec = getOrCreateDay(subjectId, workDate);
      const nowIso = new Date().toISOString();
      const src = source === "kiosk" ? "kiosk" : "device";

      if (type === "in") {
        if (rec.punch_in_at) {
          raiseHrAlert({
            type: "duplicate_punch",
            severity: "warning",
            message: `Duplicate punch-in attempt for user #${subjectId}`,
            userId: subjectId,
            actorId: actor.id,
          });
          return res.status(400).json({ error: "Already punched in" });
        }
        db.prepare(
          `UPDATE attendance_records
           SET punch_in_at = ?, in_lat = ?, in_lng = ?, punch_in_address = ?, punch_in_photo = ?, in_device_info = ?,
               source = ?, status = ?, last_edited_by = ?,
               punch_method_in = ?, device_in = ?, verification_in = ?
           WHERE id = ?`
        ).run(
          nowIso,
          lat,
          lng,
          address,
          photoPath,
          devInfo,
          src,
          computeLateStatus(subject, nowIso),
          actor.id,
          punchMethod,
          devShort,
          verificationVal,
          rec.id
        );
      } else {
        if (!rec.punch_in_at) {
          raiseHrAlert({
            type: "invalid_punch_sequence",
            severity: "info",
            message: `Punch-out without check-in for user #${subjectId}`,
            userId: subjectId,
            actorId: actor.id,
          });
          return res.status(400).json({ error: "Punch in required first" });
        }
        if (rec.punch_out_at) {
          raiseHrAlert({
            type: "duplicate_punch",
            severity: "warning",
            message: `Duplicate punch-out attempt for user #${subjectId}`,
            userId: subjectId,
            actorId: actor.id,
          });
          return res.status(400).json({ error: "Already punched out" });
        }
        db.prepare(
          `UPDATE attendance_records
           SET punch_out_at = ?, out_lat = ?, out_lng = ?, punch_out_address = ?, punch_out_photo = ?, out_device_info = ?, last_edited_by = ?,
               punch_method_out = ?, device_out = ?, verification_out = ?
           WHERE id = ?`
        ).run(
          nowIso,
          lat,
          lng,
          address,
          photoPath,
          devInfo,
          actor.id,
          punchMethod,
          devShort,
          verificationVal,
          rec.id
        );
      }

      const fresh = db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(rec.id);
      insertAudit(actor.id, type === "in" ? "punch_in" : "punch_out", "attendance", rec.id, {
        work_date: workDate,
      });
      scheduleAttendanceSync(db, rec.id);
      appsScriptScheduleAttendance(db, rec.id);
      setImmediate(() => {
        pushAttendanceToConfiguredSheet(rec.id).catch(() => {});
      });
      setImmediate(() => {
        const u = db.prepare("SELECT full_name FROM users WHERE id = ?").get(subjectId);
        notifyPunchWhatsApp(db, {
          userId: subjectId,
          type,
          workDate,
          fullName: u && u.full_name,
        }).catch(() => {});
      });
      res.json({
        record: fresh,
        checkIn: fresh.punch_in_at,
        checkOut: fresh.punch_out_at,
        status: fresh.status,
        geo,
        address,
      });
    } catch (e) {
      next(e);
    }
  }

  router.post("/attendance/punch", attachUser, upload.single("photo"), runPunch);

  function normalizePunchMultipartBody(req) {
    const b = req.body || {};
    if (b.lat !== undefined && b.lat !== "") b.lat = Number(b.lat);
    if (b.lng !== undefined && b.lng !== "") b.lng = Number(b.lng);
    if (b.useBranchCenter === "true" || b.useBranchCenter === "1") b.useBranchCenter = true;
    if (typeof b.webAuthn === "string" && b.webAuthn.trim()) {
      try {
        b.webAuthn = JSON.parse(b.webAuthn);
      } catch {
        /* keep string; verify layer will reject */
      }
    }
    if (typeof b.faceDescriptor === "string" && b.faceDescriptor.trim()) {
      try {
        b.faceDescriptor = JSON.parse(b.faceDescriptor);
      } catch {
        /* invalid JSON; match layer rejects */
      }
    }
    req.body = b;
  }

  router.post("/attendance/checkin", attachUser, (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (ct.includes("multipart/form-data")) {
      return upload.single("photo")(req, res, (err) => {
        if (err) return next(err);
        normalizePunchMultipartBody(req);
        req.body.type = "in";
        req.body.source = req.body.source || "device";
        runPunch(req, res, next);
      });
    }
    req.body = { ...(req.body || {}), type: "in", source: (req.body && req.body.source) || "device" };
    runPunch(req, res, next);
  });

  router.post("/attendance/checkout", attachUser, (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (ct.includes("multipart/form-data")) {
      return upload.single("photo")(req, res, (err) => {
        if (err) return next(err);
        normalizePunchMultipartBody(req);
        req.body.type = "out";
        req.body.source = req.body.source || "device";
        runPunch(req, res, next);
      });
    }
    req.body = { ...(req.body || {}), type: "out", source: (req.body && req.body.source) || "device" };
    runPunch(req, res, next);
  });

  router.post(
    "/attendance/kiosk-face",
    attachUser,
    upload.single("photo"),
    (req, res) => {
      if (!can(req.currentUser, "attendance:kiosk")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const af = req.currentUser.allow_face !== undefined ? Number(req.currentUser.allow_face) : 0;
      const ab = req.currentUser.allow_biometric !== undefined ? Number(req.currentUser.allow_biometric) : 0;
      if (af === 0 && ab === 0) {
        raiseHrAlert({
          type: "unauthorized_mode",
          severity: "warning",
          message: `Kiosk face/biometric blocked for user #${req.currentUser.id}`,
          userId: req.currentUser.id,
          actorId: req.currentUser.id,
          meta: { mode: "face_kiosk" },
        });
        return res.status(403).json({ error: "Face / biometric capture disabled for this account" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "Live photo (selfie) file required" });
      }
      if (req.file.size < 8192) {
        return res.status(400).json({ error: "Photo too small — use a real camera capture (min 8KB)" });
      }
      const url = `/uploads/attendance/${req.file.filename}`;
      res.json({
        ok: true,
        stored: url,
        message:
          "Face match not enabled. Image stored for audit / future biometric integration.",
      });
    }
  );

  router.post("/attendance/face-placeholder", attachUser, (req, res) => {
    if (!can(req.currentUser, "attendance:face_placeholder")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.status(501).json({
      ok: false,
      message: "Face recognition integration pending. Use punch with GPS or manual entry.",
    });
  });

  router.post("/attendance/manual", attachUser, (req, res) => {
    const actor = req.currentUser;
    if (!can(actor, "attendance:manual")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const {
      userId,
      workDate,
      status,
      punchInAt,
      punchOutAt,
      notes,
      halfPeriod,
    } = req.body || {};
    if (!userId || !workDate || !status) {
      return res.status(400).json({ error: "userId, workDate, status required" });
    }
    const subject = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(Number(userId));
    if (!subject) return res.status(404).json({ error: "User not found" });
    const scopeMan = assertUserAccess(actor, subject);
    if (!scopeMan.ok) return res.status(scopeMan.status).json({ error: scopeMan.error });
    const am = subject.allow_manual !== undefined ? Number(subject.allow_manual) : 1;
    if (actor.role !== ROLES.SUPER_ADMIN && am === 0) {
      return res.status(403).json({ error: "Manual attendance disabled for this employee" });
    }

    const existing = db
      .prepare("SELECT * FROM attendance_records WHERE user_id = ? AND work_date = ?")
      .get(Number(userId), String(workDate));

    if (existing) {
      db.prepare(
        `UPDATE attendance_records
         SET punch_in_at = ?, punch_out_at = ?, status = ?, half_period = ?, notes = ?, source = 'manual', last_edited_by = ?
         WHERE id = ?`
      ).run(
        punchInAt || null,
        punchOutAt || null,
        String(status),
        halfPeriod || null,
        notes || null,
        actor.id,
        existing.id
      );
      const rec = db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(existing.id);
      insertAudit(actor.id, "attendance_manual", "attendance", existing.id, { work_date: workDate });
      scheduleAttendanceSync(db, existing.id);
      appsScriptScheduleAttendance(db, existing.id);
      return res.json({ record: rec });
    }

    const info = db
      .prepare(
        `INSERT INTO attendance_records
         (user_id, work_date, punch_in_at, punch_out_at, status, half_period, notes, source, last_edited_by)
         VALUES (?,?,?,?,?,?,?,'manual',?)`
      )
      .run(
        Number(userId),
        String(workDate),
        punchInAt || null,
        punchOutAt || null,
        String(status),
        halfPeriod || null,
        notes || null,
        actor.id
      );
    const rec = db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(info.lastInsertRowid);
    insertAudit(actor.id, "attendance_manual", "attendance", info.lastInsertRowid, { work_date: workDate });
    scheduleAttendanceSync(db, info.lastInsertRowid);
    appsScriptScheduleAttendance(db, info.lastInsertRowid);
    res.json({ record: rec });
  });

  router.patch("/attendance/:id", attachUser, (req, res) => {
    const actor = req.currentUser;
    if (!can(actor, "attendance:edit_any") && !can(actor, "history:edit")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const id = Number(req.params.id);
    const rec = db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(id);
    if (!rec) return res.status(404).json({ error: "Not found" });
    const subjRow = db
      .prepare(`SELECT id, branch_id, role FROM users WHERE id = ? AND deleted_at IS NULL`)
      .get(rec.user_id);
    const scopeEd = assertUserAccess(actor, subjRow);
    if (!scopeEd.ok) return res.status(scopeEd.status).json({ error: scopeEd.error });

    const {
      status,
      punchInAt,
      punchOutAt,
      halfPeriod,
      notes,
      workDate,
    } = req.body || {};
    db.prepare(
      `UPDATE attendance_records
       SET status = COALESCE(?, status),
           punch_in_at = COALESCE(?, punch_in_at),
           punch_out_at = COALESCE(?, punch_out_at),
           half_period = COALESCE(?, half_period),
           notes = COALESCE(?, notes),
           work_date = COALESCE(?, work_date),
           last_edited_by = ?
       WHERE id = ?`
    ).run(
      status || null,
      punchInAt !== undefined ? punchInAt : null,
      punchOutAt !== undefined ? punchOutAt : null,
      halfPeriod !== undefined ? halfPeriod : null,
      notes !== undefined ? notes : null,
      workDate || null,
      actor.id,
      id
    );
    const updated = db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(id);
    insertAudit(actor.id, "attendance_edit", "attendance", id, {});
    scheduleAttendanceSync(db, id);
    appsScriptScheduleAttendance(db, id);
    res.json({ record: updated });
  });

  router.get("/attendance/history", attachUser, (req, res) => {
    const actor = req.currentUser;
    const { userId, branchId, from, to, status } = req.query;

    if (can(actor, "history:read")) {
      if (userId) {
        const chk = assertUserIdAccess(db, actor, userId);
        if (!chk.ok) return res.status(chk.status).json({ error: chk.error });
      }
      if (branchId && isBranchScoped(actor) && Number(branchId) !== Number(actor.branch_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      let sql = `
        SELECT ar.*, u.full_name, u.email, u.branch_id
        FROM attendance_records ar
        JOIN users u ON u.id = ar.user_id
        WHERE 1=1
      `;
      const params = [];
      if (userId) {
        sql += " AND ar.user_id = ?";
        params.push(Number(userId));
      }
      if (branchId && isOrgWide(actor)) {
        sql += " AND u.branch_id = ?";
        params.push(Number(branchId));
      }
      const sc = branchScopeSql(actor, "u");
      sql += sc.sql;
      params.push(...sc.params);
      if (from) {
        sql += " AND ar.work_date >= ?";
        params.push(String(from));
      }
      if (to) {
        sql += " AND ar.work_date <= ?";
        params.push(String(to));
      }
      if (status) {
        sql += " AND ar.status = ?";
        params.push(String(status));
      }
      sql += " ORDER BY ar.work_date DESC, ar.id DESC LIMIT 500";
      const rows = db.prepare(sql).all(...params);
      return res.json({ records: rows });
    }

    if (can(actor, "history:read_self")) {
      const sql = `
        SELECT ar.*, u.full_name, u.email, u.branch_id
        FROM attendance_records ar
        JOIN users u ON u.id = ar.user_id
        WHERE ar.user_id = ?
        ORDER BY ar.work_date DESC, ar.id DESC
        LIMIT 200
      `;
      const rows = db.prepare(sql).all(actor.id);
      return res.json({ records: rows });
    }

    return res.status(403).json({ error: "Forbidden" });
  });

  router.get("/attendance", attachUser, (req, res) => {
    const actor = req.currentUser;
    const { userId, branchId, from, to, status } = req.query;

    if (!can(actor, "history:read") && !can(actor, "history:read_self")) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let rows;
    if (can(actor, "history:read")) {
      if (userId) {
        const chk = assertUserIdAccess(db, actor, userId);
        if (!chk.ok) return res.status(chk.status).json({ error: chk.error });
      }
      if (branchId && isBranchScoped(actor) && Number(branchId) !== Number(actor.branch_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      let sql = `
        SELECT ar.*, u.full_name, u.email, u.branch_id
        FROM attendance_records ar
        JOIN users u ON u.id = ar.user_id
        WHERE 1=1
      `;
      const params = [];
      if (userId) {
        sql += " AND ar.user_id = ?";
        params.push(Number(userId));
      }
      if (branchId && isOrgWide(actor)) {
        sql += " AND u.branch_id = ?";
        params.push(Number(branchId));
      }
      const sc2 = branchScopeSql(actor, "u");
      sql += sc2.sql;
      params.push(...sc2.params);
      if (from) {
        sql += " AND ar.work_date >= ?";
        params.push(String(from));
      }
      if (to) {
        sql += " AND ar.work_date <= ?";
        params.push(String(to));
      }
      if (status) {
        sql += " AND ar.status = ?";
        params.push(String(status));
      }
      sql += " ORDER BY ar.work_date DESC, ar.id DESC LIMIT 500";
      rows = db.prepare(sql).all(...params);
    } else {
      rows = db
        .prepare(
          `SELECT ar.*, u.full_name, u.email, u.branch_id
           FROM attendance_records ar
           JOIN users u ON u.id = ar.user_id
           WHERE ar.user_id = ?
           ORDER BY ar.work_date DESC, ar.id DESC
           LIMIT 200`
        )
        .all(actor.id);
    }

    const attendance = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      checkIn: r.punch_in_at,
      checkOut: r.punch_out_at,
      status: r.status,
      workDate: r.work_date,
      userName: r.full_name,
    }));
    res.json({ attendance });
  });

  router.get("/attendance/export.csv", attachUser, (req, res) => {
    const actor = req.currentUser;
    if (!can(actor, "export:read")) {
      return res.status(403).send("Forbidden");
    }
    const { userId, branchId, from, to, status } = req.query;
    let sql = `
      SELECT ar.*, u.full_name, u.email, u.branch_id, b.name AS branch_name
      FROM attendance_records ar
      JOIN users u ON u.id = ar.user_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE 1=1
    `;
    const params = [];
    if (!can(actor, "history:read")) {
      sql += " AND ar.user_id = ?";
      params.push(actor.id);
    } else {
      if (userId) {
        const chk = assertUserIdAccess(db, actor, userId);
        if (!chk.ok) return res.status(chk.status).send(chk.error);
        sql += " AND ar.user_id = ?";
        params.push(Number(userId));
      }
      if (branchId && isOrgWide(actor)) {
        sql += " AND u.branch_id = ?";
        params.push(Number(branchId));
      }
      if (branchId && isBranchScoped(actor) && Number(branchId) !== Number(actor.branch_id)) {
        return res.status(403).send("Forbidden");
      }
      const scEx = branchScopeSql(actor, "u");
      sql += scEx.sql;
      params.push(...scEx.params);
    }
    if (from) {
      sql += " AND ar.work_date >= ?";
      params.push(String(from));
    }
    if (to) {
      sql += " AND ar.work_date <= ?";
      params.push(String(to));
    }
    if (status) {
      sql += " AND ar.status = ?";
      params.push(String(status));
    }
    sql += " ORDER BY ar.work_date DESC, ar.id DESC LIMIT 5000";
    const rows = db.prepare(sql).all(...params);
    const headers = [
      "id",
      "work_date",
      "user_id",
      "full_name",
      "email",
      "branch_id",
      "branch_name",
      "status",
      "half_period",
      "punch_in_at",
      "punch_out_at",
      "source",
      "in_lat",
      "in_lng",
      "punch_in_address",
      "punch_out_address",
      "in_device_info",
      "out_device_info",
      "punch_in_photo",
      "punch_out_photo",
    ];
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    };
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        headers
          .map((h) => esc(r[h]))
          .join(",")
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="attendance-export.csv"'
    );
    res.send(lines.join("\n"));
  });

  router.get("/attendance/export.xlsx", attachUser, async (req, res, next) => {
    try {
      const actor = req.currentUser;
      if (!can(actor, "export:read")) {
        return res.status(403).send("Forbidden");
      }
      const { userId, branchId, from, to, status } = req.query;
      let sql = `
        SELECT ar.*, u.full_name, u.email, u.login_id, u.branch_id, b.name AS branch_name
        FROM attendance_records ar
        JOIN users u ON u.id = ar.user_id
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE 1=1
      `;
      const params = [];
      if (!can(actor, "history:read")) {
        sql += " AND ar.user_id = ?";
        params.push(actor.id);
      } else {
        if (userId) {
          const chk = assertUserIdAccess(db, actor, userId);
          if (!chk.ok) return res.status(chk.status).send(chk.error);
          sql += " AND ar.user_id = ?";
          params.push(Number(userId));
        }
        if (branchId && isOrgWide(actor)) {
          sql += " AND u.branch_id = ?";
          params.push(Number(branchId));
        }
        if (branchId && isBranchScoped(actor) && Number(branchId) !== Number(actor.branch_id)) {
          return res.status(403).send("Forbidden");
        }
        const scX = branchScopeSql(actor, "u");
        sql += scX.sql;
        params.push(...scX.params);
      }
      if (from) {
        sql += " AND ar.work_date >= ?";
        params.push(String(from));
      }
      if (to) {
        sql += " AND ar.work_date <= ?";
        params.push(String(to));
      }
      if (status) {
        sql += " AND ar.status = ?";
        params.push(String(status));
      }
      sql += " ORDER BY ar.work_date DESC, ar.id DESC LIMIT 5000";
      const rows = db.prepare(sql).all(...params);
      const headers = [
        "id",
        "work_date",
        "user_id",
        "full_name",
        "email",
        "login_id",
        "branch_id",
        "branch_name",
        "status",
        "half_period",
        "punch_in_at",
        "punch_out_at",
        "source",
        "in_lat",
        "in_lng",
        "out_lat",
        "out_lng",
        "punch_in_address",
        "punch_out_address",
        "in_device_info",
        "out_device_info",
        "punch_in_photo",
        "punch_out_photo",
        "notes",
        "last_edited_by",
        "created_at",
      ];
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Attendance");
      ws.addRow(headers);
      for (const r of rows) {
        ws.addRow(headers.map((h) => r[h]));
      }
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="attendance-export.xlsx"'
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (e) {
      next(e);
    }
  });

  router.get("/integrations/google/status", attachUser, (req, res) => {
    if (!can(req.currentUser, "integrations:sync")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(getIntegrationStatus(db));
  });

  router.get("/integrations/google/auth-url", attachUser, (req, res) => {
    if (!can(req.currentUser, "integrations:sync")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const state = crypto.randomBytes(24).toString("hex");
      req.session.googleOAuthState = state;
      const url = getGoogleAuthUrl(state);
      res.json({ url });
    } catch (e) {
      res.status(503).json({ error: e.message || "OAuth not configured" });
    }
  });

  router.get("/integrations/google/oauth/callback", async (req, res) => {
    try {
      const { code, state, error: oauthErr } = req.query;
      if (oauthErr) {
        return res.redirect(
          `/portal/#/settings?google=error&reason=${encodeURIComponent(String(oauthErr))}`
        );
      }
      if (!code || !state) {
        return res.redirect("/portal/#/settings?google=error&reason=missing_params");
      }
      if (state !== req.session.googleOAuthState) {
        return res.redirect("/portal/#/settings?google=error&reason=invalid_state");
      }
      delete req.session.googleOAuthState;
      await exchangeCodeAndSave(db, String(code));
      res.redirect("/portal/#/settings?google=connected");
    } catch (e) {
      console.error("[google oauth callback]", e);
      res.redirect(
        `/portal/#/settings?google=error&reason=${encodeURIComponent(e.message || "oauth_failed")}`
      );
    }
  });

  router.post("/integrations/google/disconnect", attachUser, (req, res) => {
    if (!can(req.currentUser, "integrations:sync")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    disconnectGoogle(db);
    res.json({ ok: true });
  });

  router.post("/integrations/google/sync-enabled", attachUser, (req, res) => {
    if (!can(req.currentUser, "integrations:sync")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const enabled = !!(req.body && req.body.enabled);
    setSyncEnabled(db, enabled);
    res.json({ ok: true, syncEnabled: enabled });
  });

  router.post("/integrations/google-sheets/full-sync", attachUser, async (req, res, next) => {
    try {
      if (!can(req.currentUser, "integrations:sync")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isOrgWide(req.currentUser)) {
        return res.status(403).json({ error: "Full sync is restricted to Super Admin / Admin" });
      }
      const result = await fullSyncAll(db);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.post("/integrations/google-sheets/sync", attachUser, async (req, res, next) => {
    try {
      if (!can(req.currentUser, "integrations:sync")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { from, to } = req.body || {};
      let sql = `
        SELECT ar.*, u.full_name, u.email, u.login_id, u.role, b.name AS branch_name
        FROM attendance_records ar
        JOIN users u ON u.id = ar.user_id
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE 1=1
      `;
      const params = [];
      const scGs = branchScopeSql(req.currentUser, "u");
      sql += scGs.sql;
      params.push(...scGs.params);
      if (from) {
        sql += " AND ar.work_date >= ?";
        params.push(String(from));
      }
      if (to) {
        sql += " AND ar.work_date <= ?";
        params.push(String(to));
      }
      sql += " ORDER BY ar.work_date ASC LIMIT 2000";
      const rows = db.prepare(sql).all(...params);
      const result = await syncAttendanceRows(db, rows);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
  router.get("/integrations/sheets/status", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can access sheet integration" });
    }
    const branches = db.prepare("SELECT id, name FROM branches ORDER BY name").all();
    res.json({
      ...readSheetIntegration(),
      branches,
      snippet: sheetConnectSnippet(),
      guide: [
        "1. Google Sheet open karo",
        "2. Script editor kholo",
        "3. Code paste karo",
        "4. Deploy as webhook",
        "5. Link copy karo",
        "6. HRMS me paste karo",
      ],
    });
  });
  router.patch("/integrations/sheets/connect", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can access sheet integration" });
    }
    const cur = readSheetIntegration();
    const branchMapIn = req.body?.branch_map;
    const branchMap =
      branchMapIn && typeof branchMapIn === "object"
        ? Object.fromEntries(
            Object.entries(branchMapIn).map(([k, v]) => [String(k), String(v || "").trim()])
          )
        : cur.branch_map || {};
    const next = {
      ...cur,
      enabled: req.body?.enabled == null ? cur.enabled : !!req.body.enabled,
      mode: req.body?.mode ? String(req.body.mode) : cur.mode,
      google_sheet_link:
        req.body?.google_sheet_link != null
          ? String(req.body.google_sheet_link).trim()
          : cur.google_sheet_link,
      api_key: req.body?.api_key != null ? String(req.body.api_key).trim() : cur.api_key,
      default_webhook_url:
        req.body?.default_webhook_url != null
          ? String(req.body.default_webhook_url).trim()
          : cur.default_webhook_url,
      branch_map: branchMap,
    };
    writeSheetIntegration(next);
    insertAudit(req.currentUser.id, "sheet_connect_update", "settings", "sheet_integration", {
      enabled: next.enabled,
      mode: next.mode,
      branchMapCount: Object.keys(next.branch_map || {}).length,
    });
    res.json(next);
  });
  router.post("/integrations/sheets/test-connection", attachUser, async (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can access sheet integration" });
    }
    const cfg = readSheetIntegration();
    const testUrl = String(req.body?.webhook_url || cfg.default_webhook_url || "").trim();
    if (!testUrl) return res.status(400).json({ error: "webhook_url required" });
    try {
      const r = await fetch(testUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {}),
        },
        body: JSON.stringify({
          test: true,
          source: "hrms",
          at: new Date().toISOString(),
          message: "HRMS Test Connection",
        }),
      });
      if (!r.ok) throw new Error(`Connection failed (${r.status})`);
      writeSheetIntegration({ ...cfg, last_error: "", last_sync_at: new Date().toISOString() });
      res.json({ ok: true });
    } catch (e) {
      writeSheetIntegration({ ...cfg, last_error: String(e.message || e) });
      res.status(400).json({ error: String(e.message || e) });
    }
  });
  router.post("/integrations/sheets/manual-sync", attachUser, async (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can access sheet integration" });
    }
    const branchId = req.body?.branch_id != null ? Number(req.body.branch_id) : null;
    let sql =
      "SELECT ar.id FROM attendance_records ar JOIN users u ON u.id = ar.user_id WHERE 1=1";
    const params = [];
    if (branchId != null) {
      sql += " AND u.branch_id = ?";
      params.push(branchId);
    }
    sql += " ORDER BY ar.id DESC LIMIT 300";
    const ids = db.prepare(sql).all(...params).map((x) => Number(x.id));
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      // sequential to avoid webhook rate limit
      const r = await pushAttendanceToConfiguredSheet(id);
      if (r && r.ok) ok += 1;
      else failed += 1;
    }
    res.json({ ok: true, synced: ok, failed });
  });

  router.get("/dashboard/summary", attachUser, (req, res) => {
    const actor = req.currentUser;
    if (!can(actor, "dashboard:read") && !can(actor, "dashboard:read_self")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { branchId, from, to } = req.query;
    const fromDate = from || todayLocalDate();
    const toDate = to || todayLocalDate();

    if (can(actor, "dashboard:read_self") && !can(actor, "dashboard:read")) {
      const rows = db
        .prepare(
          `
        SELECT status, COUNT(*) AS c
        FROM attendance_records
        WHERE user_id = ? AND work_date BETWEEN ? AND ?
        GROUP BY status
      `
        )
        .all(actor.id, fromDate, toDate);
      return res.json({ scope: "self", from: fromDate, to: toDate, counts: rows });
    }

    let sql = `
      SELECT u.branch_id, b.name AS branch_name, ar.status, COUNT(*) AS c
      FROM attendance_records ar
      JOIN users u ON u.id = ar.user_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE ar.work_date BETWEEN ? AND ?
    `;
    const params = [fromDate, toDate];
    if (branchId && isOrgWide(actor)) {
      sql += " AND u.branch_id = ?";
      params.push(Number(branchId));
    }
    if (isBranchScoped(actor)) {
      if (actor.branch_id == null) {
        return res.json({ scope: "org", from: fromDate, to: toDate, rows: [] });
      }
      sql += " AND u.branch_id = ?";
      params.push(actor.branch_id);
    }
    sql += " GROUP BY u.branch_id, b.name, ar.status ORDER BY b.name, ar.status";
    const rows = db.prepare(sql).all(...params);
    res.json({ scope: "org", from: fromDate, to: toDate, rows });
  });

  router.get("/dashboard", attachUser, (req, res) => {
    const today = todayLocalDate();
    const totalStaff = Number(
      db.prepare("SELECT COUNT(*) AS c FROM users WHERE active = 1 AND deleted_at IS NULL").get().c
    );
    const present = Number(
      db
        .prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE work_date = ? AND punch_in_at IS NOT NULL")
        .get(today).c
    );
    const late = Number(
      db.prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE work_date = ? AND status = 'late'").get(today)
        .c
    );
    const absent = Math.max(totalStaff - present, 0);
    res.json({ date: today, totalStaff, present, late, absent });
  });

  router.get("/dashboard/overview", attachUser, (req, res) => {
    const actor = req.currentUser;
    if (!can(actor, "dashboard:read") && !can(actor, "dashboard:read_self")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const today = todayLocalDate();
    const now = new Date();
    const dow = now.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now);
    mon.setDate(now.getDate() + mondayOffset);
    const weekStart = mon.toISOString().slice(0, 10);

    const sc = branchScopeSql(actor, "u");
    const scSql = sc.sql;
    const scParams = sc.params;

    const totalStaff = Number(
      db
        .prepare(`SELECT COUNT(*) AS c FROM users u WHERE u.active = 1 AND u.deleted_at IS NULL${scSql}`)
        .get(...scParams).c
    );

    if (can(actor, "dashboard:read_self") && !can(actor, "dashboard:read")) {
      const row = db
        .prepare("SELECT * FROM attendance_records WHERE user_id = ? AND work_date = ?")
        .get(actor.id, today);
      const st = row?.status || "absent";
      return res.json({
        scope: "self",
        today: {
          date: today,
          totalStaff: 1,
          present: st === "present" || st === "half" ? 1 : 0,
          late: st === "late" ? 1 : 0,
          absent: st === "absent" || !row ? 1 : 0,
          onLeave: st === "leave" ? 1 : 0,
        },
        stats: {
          workforce: 1,
          monthlyBudgetINR: 0,
          workHours: 180,
          offices: 1,
        },
        highlights: {
          topPerformers: [],
          lateDefaulters: [],
          violations: [],
          weeklyLateFlags: [],
        },
        insights: { leaveRequestsPending: 0, biometricRequests: 0, documentCompliancePct: 100 },
        staffByBranch: [],
        liveStatus: { currentlyIn: 0, missingOut: 0 },
        hrAlerts: [],
        alerts: { highLeaveUsers: [], frequentLateUsers: [] },
      });
    }

    const statusRows = db
      .prepare(
        `SELECT ar.status, COUNT(*) AS c
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
         WHERE ar.work_date = ?${scSql}
         GROUP BY ar.status`
      )
      .all(today, ...scParams);
    const smap = Object.fromEntries(statusRows.map((x) => [x.status, x.c]));
    const present = (smap.present || 0) + (smap.half || 0);
    const late = smap.late || 0;
    const absentOnly = smap.absent || 0;
    const onLeave = smap.leave || 0;

    const missingOut = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM attendance_records ar
           JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
           WHERE ar.work_date = ? AND ar.punch_in_at IS NOT NULL AND ar.punch_out_at IS NULL${scSql}`
        )
        .get(today, ...scParams).c
    );

    const lateWeek = db
      .prepare(
        `SELECT u.full_name AS name, u.id AS userId, COUNT(*) AS lateDays
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
         WHERE ar.work_date >= ? AND ar.status = 'late'${scSql}
         GROUP BY u.id
         HAVING COUNT(*) >= 3`
      )
      .all(weekStart, ...scParams);

    let leavePending = 0;
    let documentCompliancePct = 100;
    try {
      leavePending = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM leave_requests lr
             JOIN users u ON u.id = lr.user_id AND u.deleted_at IS NULL
             WHERE lr.final_status = 'PENDING'${scSql}`
          )
          .get(...scParams).c
      );
    } catch {
      leavePending = 0;
    }
    try {
      const docTotal = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM employee_documents d
             JOIN users u ON u.id = d.user_id
             WHERE 1=1${scSql}`
          )
          .get(...scParams).c
      );
      const docOk = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM employee_documents d
             JOIN users u ON u.id = d.user_id
             WHERE d.verified = 1${scSql}`
          )
          .get(...scParams).c
      );
      if (docTotal > 0) {
        documentCompliancePct = Math.round((docOk / docTotal) * 100);
      } else {
        documentCompliancePct = 100;
      }
    } catch {
      documentCompliancePct = 87;
    }

    const payrollPeriod = today.slice(0, 7);
    let payrollGross = 0;
    let payrollDed = 0;
    try {
      const pr = db
        .prepare(
          `SELECT COALESCE(SUM(p.gross_inr),0) AS g, COALESCE(SUM(p.deductions_inr),0) AS d
           FROM payroll_entries p
           JOIN users u ON u.id = p.user_id
           WHERE p.period = ?${scSql}`
        )
        .get(payrollPeriod, ...scParams);
      payrollGross = Number(pr.g) || 0;
      payrollDed = Number(pr.d) || 0;
    } catch {
      payrollGross = 0;
      payrollDed = 0;
    }

    let staffByBranch;
    if (isOrgWide(actor)) {
      staffByBranch = db
        .prepare(
          `SELECT b.name AS name, COUNT(u.id) AS staffCount
           FROM branches b
           LEFT JOIN users u ON u.branch_id = b.id AND u.active = 1 AND u.deleted_at IS NULL
           GROUP BY b.id
           ORDER BY b.name`
        )
        .all();
    } else if (isBranchScoped(actor) && actor.branch_id != null) {
      staffByBranch = db
        .prepare(
          `SELECT b.name AS name, COUNT(u.id) AS staffCount
           FROM branches b
           LEFT JOIN users u ON u.branch_id = b.id AND u.active = 1 AND u.deleted_at IS NULL
           WHERE b.id = ?
           GROUP BY b.id`
        )
        .all(actor.branch_id);
    } else {
      staffByBranch = [];
    }

    const offices = isOrgWide(actor)
      ? Number(db.prepare("SELECT COUNT(*) AS c FROM branches").get().c)
      : isBranchScoped(actor) && actor.branch_id != null
        ? 1
        : 0;

    const liveIn = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM attendance_records ar
           JOIN users u ON u.id = ar.user_id AND u.deleted_at IS NULL
           WHERE ar.work_date = ? AND ar.punch_in_at IS NOT NULL AND ar.punch_out_at IS NULL${scSql}`
        )
        .get(today, ...scParams).c
    );

    const lateToday = db
      .prepare(
        `SELECT u.full_name AS name, ar.status AS status, ar.work_date AS workDate
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id AND u.deleted_at IS NULL
         WHERE ar.work_date = ? AND ar.status = 'late'${scSql}
         LIMIT 8`
      )
      .all(today, ...scParams);

    const topRows = db
      .prepare(
        `SELECT u.full_name AS name, b.name AS branch
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         WHERE u.active = 1 AND u.deleted_at IS NULL${scSql}
         ORDER BY u.id ASC
         LIMIT 5`
      )
      .all(...scParams);
    const scores = [98, 96, 94, 92, 90];
    const topPerformers = topRows.map((r, i) => ({
      name: r.name,
      branch: r.branch || "—",
      score: scores[i] || 90,
    }));

    const halfDay = smap.half || 0;
    const presentOnly = smap.present || 0;
    const punchInCount = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM attendance_records ar
           INNER JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
           WHERE ar.work_date = ? AND ar.punch_in_at IS NOT NULL${scSql}`
        )
        .get(today, ...scParams).c
    );
    const punchOutCount = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM attendance_records ar
           INNER JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
           WHERE ar.work_date = ? AND ar.punch_out_at IS NOT NULL${scSql}`
        )
        .get(today, ...scParams).c
    );

    let noticeReadSummary = { activeNotices: 0, totalReads: 0, approxUnseen: 0 };
    try {
      const na = Number(db.prepare(`SELECT COUNT(*) AS c FROM notices WHERE active = 1`).get().c);
      const tr = Number(db.prepare(`SELECT COUNT(*) AS c FROM notice_reads`).get().c);
      noticeReadSummary = {
        activeNotices: na,
        totalReads: tr,
        approxUnseen: Math.max(0, na * totalStaff - tr),
      };
    } catch {
      /* optional tables */
    }

    const workedRows = db
      .prepare(
        `SELECT ar.punch_in_at, ar.punch_out_at FROM attendance_records ar
         INNER JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
         WHERE ar.work_date = ? AND ar.punch_in_at IS NOT NULL AND ar.punch_out_at IS NOT NULL${scSql}`
      )
      .all(today, ...scParams);
    const totalMinutesWorkedToday = workedRows.reduce(
      (acc, r) => acc + minutesBetweenIso(r.punch_in_at, r.punch_out_at),
      0
    );

    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const padM = String(m).padStart(2, "0");
    const monthStart = `${y}-${padM}-01`;
    const lastD = new Date(y, m, 0).getDate();
    const monthEnd = `${y}-${padM}-${String(lastD).padStart(2, "0")}`;
    const monthRows = db
      .prepare(
        `SELECT ar.punch_in_at, ar.punch_out_at FROM attendance_records ar
         INNER JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
         WHERE ar.work_date >= ? AND ar.work_date <= ? AND ar.punch_in_at IS NOT NULL AND ar.punch_out_at IS NOT NULL${scSql}`
      )
      .all(monthStart, monthEnd, ...scParams);
    const totalMinutesWorkedMonth = monthRows.reduce(
      (acc, r) => acc + minutesBetweenIso(r.punch_in_at, r.punch_out_at),
      0
    );

    const yearStart = `${y}-01-01`;
    let highLeaveUsers = [];
    try {
      highLeaveUsers = db
        .prepare(
          `SELECT u.full_name AS name, u.id AS userId, COUNT(*) AS approvedLeaves
           FROM leave_requests lr
           JOIN users u ON u.id = lr.user_id AND u.deleted_at IS NULL
           WHERE lr.final_status = 'APPROVED' AND lr.start_date >= ?${scSql}
           GROUP BY u.id
           HAVING COUNT(*) > 4
           ORDER BY approvedLeaves DESC LIMIT 12`
        )
        .all(yearStart, ...scParams);
    } catch {
      highLeaveUsers = [];
    }

    const frequentLateUsers = db
      .prepare(
        `SELECT u.full_name AS name, u.id AS userId, COUNT(*) AS lateDays
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
         WHERE ar.work_date >= date('now', '-14 days') AND ar.status = 'late'${scSql}
         GROUP BY u.id
         HAVING COUNT(*) >= 3
         ORDER BY lateDays DESC LIMIT 12`
      )
      .all(...scParams);

    res.json({
      scope: "org",
      today: {
        date: today,
        totalStaff,
        present,
        late,
        absent: absentOnly,
        onLeave,
        halfDay,
        presentOnly,
        punchInCount,
        punchOutCount,
        totalMinutesWorked: totalMinutesWorkedToday,
        totalHoursWorkedToday: Math.round((totalMinutesWorkedToday / 60) * 10) / 10,
      },
      stats: {
        workforce: totalStaff,
        monthlyBudgetINR: 2450000,
        workHours: 176,
        offices,
        totalMinutesWorkedMonth,
        totalHoursWorkedMonth: Math.round((totalMinutesWorkedMonth / 60) * 10) / 10,
      },
      alerts: {
        highLeaveUsers,
        frequentLateUsers,
      },
      highlights: {
        topPerformers,
        lateDefaulters: lateToday,
        violations: [{ type: "Missing punch-out (today)", count: missingOut }],
        weeklyLateFlags: lateWeek,
      },
      insights: {
        leaveRequestsPending: leavePending,
        biometricRequests: 0,
        documentCompliancePct,
      },
      staffByBranch,
      liveStatus: { currentlyIn: liveIn, missingOut },
      noticeReadSummary,
      hrAlerts: listRecentAlerts(db, { limit: 12 }),
      payrollPreview: {
        grossCtcMonthlyINR: payrollGross > 0 ? payrollGross : 2450000,
        attendanceDeductionsINR: Math.min(45000, missingOut * 5000),
        netFromPayrollINR: payrollGross - payrollDed,
        period: payrollPeriod,
        note:
          payrollGross > 0
            ? `Payroll totals from payroll_entries for ${payrollPeriod}.`
            : "Add payroll rows in the Payroll module; showing org benchmark until data exists.",
      },
    });
  });

  router.get("/dashboard/today-list", attachUser, (req, res) => {
    if (!can(req.currentUser, "dashboard:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const status = String(req.query.status || "present").toLowerCase();
    const today = todayLocalDate();
    const branchId = req.query.branch_id != null && req.query.branch_id !== "" ? Number(req.query.branch_id) : null;
    const allowed = ["present", "half", "late", "absent", "leave"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "status must be present|half|late|absent|leave" });
    }
    let sql = `
      SELECT u.id, u.full_name, u.email, u.login_id, b.name AS branch_name,
        ar.status, ar.punch_in_at, ar.punch_out_at, ar.work_date
      FROM attendance_records ar
      JOIN users u ON u.id = ar.user_id AND u.active = 1 AND u.deleted_at IS NULL
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE ar.work_date = ? AND ar.status = ?
    `;
    const params = [today, status];
    const actor = req.currentUser;
    if (branchId && isOrgWide(actor)) {
      sql += " AND u.branch_id = ?";
      params.push(branchId);
    }
    if (branchId && isBranchScoped(actor) && Number(branchId) !== Number(actor.branch_id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (isBranchScoped(actor)) {
      if (actor.branch_id == null) {
        return res.json({ date: today, status, people: [] });
      }
      sql += " AND u.branch_id = ?";
      params.push(actor.branch_id);
    }
    sql += " ORDER BY u.full_name LIMIT 500";
    const people = db.prepare(sql).all(...params);
    res.json({ date: today, status, people });
  });

  router.get("/company/profile", attachUser, (req, res) => {
    if (!can(req.currentUser, "settings:read") && !can(req.currentUser, "branches:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ profile: readCompanyProfile(), branches: db.prepare("SELECT * FROM branches ORDER BY name").all() });
  });

  router.patch("/company/profile", attachUser, requirePerm("settings:write"), (req, res) => {
    const cur = readCompanyProfile();
    const next = { ...cur, ...(req.body || {}) };
    writeCompanyProfile(next);
    insertAudit(req.currentUser.id, "company_profile_update", "settings", "company", {});
    res.json({ profile: readCompanyProfile() });
  });

  router.get("/attendance/month-summary", attachUser, (req, res) => {
    const actor = req.currentUser;
    const period =
      String(req.query.month || "")
        .trim()
        .slice(0, 7) || todayLocalDate().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: "month must be YYYY-MM" });
    }
    const [y, mo] = period.split("-").map(Number);
    const pad = (n) => String(n).padStart(2, "0");
    const from = `${y}-${pad(mo)}-01`;
    const lastDay = new Date(y, mo, 0).getDate();
    const to = `${y}-${pad(mo)}-${pad(lastDay)}`;
    let sql = `
      SELECT u.id, u.full_name, u.email, u.login_id,
        COUNT(CASE WHEN ar.status IN ('present','half') THEN 1 END) AS present_days,
        COUNT(CASE WHEN ar.status = 'late' THEN 1 END) AS late_days,
        COUNT(CASE WHEN ar.status = 'absent' THEN 1 END) AS absent_days,
        SUM(CASE WHEN ar.punch_in_at IS NOT NULL AND ar.punch_out_at IS NOT NULL
          THEN (julianday(ar.punch_out_at) - julianday(ar.punch_in_at)) * 24 * 60 ELSE 0 END) AS work_minutes
      FROM users u
      LEFT JOIN attendance_records ar ON ar.user_id = u.id AND ar.work_date >= ? AND ar.work_date <= ?
      WHERE u.deleted_at IS NULL
    `;
    const params = [from, to];
    if (!can(actor, "history:read")) {
      sql += " AND u.id = ?";
      params.push(actor.id);
    } else {
      sql += " AND u.active = 1";
      const scMs = branchScopeSql(actor, "u");
      sql += scMs.sql;
      params.push(...scMs.params);
    }
    sql += " GROUP BY u.id ORDER BY u.full_name LIMIT 2000";
    const rows = db.prepare(sql).all(...params);
    res.json({ period, from, to, rows });
  });

  router.get("/branches", attachUser, (req, res) => {
    if (!can(req.currentUser, "branches:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ branches: db.prepare("SELECT * FROM branches ORDER BY name").all() });
  });
  router.get("/departments", attachUser, (req, res) => {
    if (!can(req.currentUser, "departments:read") && !can(req.currentUser, "users:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const departments = db
      .prepare("SELECT id, name, active, created_at FROM departments WHERE active = 1 ORDER BY name")
      .all();
    res.json({ departments });
  });
  router.post("/departments", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can create departments" });
    }
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const info = db
        .prepare("INSERT INTO departments (name, active) VALUES (?, 1)")
        .run(name);
      const department = db
        .prepare("SELECT id, name, active, created_at FROM departments WHERE id = ?")
        .get(info.lastInsertRowid);
      insertAudit(req.currentUser.id, "department_create", "department", department.id, { name });
      res.json({ department });
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "Department already exists" });
      }
      throw e;
    }
  });
  router.patch("/departments/:id", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can edit departments" });
    }
    const id = Number(req.params.id);
    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const active = req.body?.active;
    db.prepare(
      `UPDATE departments
       SET name = COALESCE(?, name),
           active = CASE WHEN ? IS NULL THEN active ELSE ? END
       WHERE id = ?`
    ).run(name, active === undefined ? null : (active ? 1 : 0), active === undefined ? null : (active ? 1 : 0), id);
    const department = db
      .prepare("SELECT id, name, active, created_at FROM departments WHERE id = ?")
      .get(id);
    if (!department) return res.status(404).json({ error: "Not found" });
    insertAudit(req.currentUser.id, "department_update", "department", id, {});
    res.json({ department });
  });
  router.delete("/departments/:id", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can delete departments" });
    }
    const id = Number(req.params.id);
    const row = db.prepare("SELECT id, name FROM departments WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    db.prepare("UPDATE departments SET active = 0 WHERE id = ?").run(id);
    insertAudit(req.currentUser.id, "department_delete", "department", id, { name: row.name });
    res.json({ ok: true, id });
  });
  router.get("/locations", attachUser, (req, res) => {
    if (!can(req.currentUser, "branches:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const locations = db.prepare("SELECT * FROM branches ORDER BY name").all();
    res.json({ locations });
  });

  router.post("/branches", attachUser, requirePerm("branches:write"), (req, res) => {
    if (!isOrgWide(req.currentUser)) {
      return res.status(403).json({ error: "Only Super Admin / Admin can create branches" });
    }
    const { name, lat, lng, radius_meters } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const info = db
      .prepare(
        "INSERT INTO branches (name, lat, lng, radius_meters) VALUES (?,?,?,?)"
      )
      .run(name, lat ?? null, lng ?? null, Number(radius_meters) || 300);
    const b = db.prepare("SELECT * FROM branches WHERE id = ?").get(info.lastInsertRowid);
    insertAudit(req.currentUser.id, "branch_create", "branch", b.id, { name: b.name });
    scheduleBranchSync(db, b.id);
    appsScriptScheduleBranch(db, b.id);
    res.json({ branch: b });
  });

  router.patch("/branches/:id", attachUser, requirePerm("branches:write"), (req, res) => {
    if (!isOrgWide(req.currentUser)) {
      return res.status(403).json({ error: "Only Super Admin / Admin can edit branches" });
    }
    const id = Number(req.params.id);
    const { name, lat, lng, radius_meters } = req.body || {};
    db.prepare(
      `UPDATE branches SET
        name = COALESCE(?, name),
        lat = COALESCE(?, lat),
        lng = COALESCE(?, lng),
        radius_meters = COALESCE(?, radius_meters)
       WHERE id = ?`
    ).run(name || null, lat ?? null, lng ?? null, radius_meters ?? null, id);
    const b = db.prepare("SELECT * FROM branches WHERE id = ?").get(id);
    if (!b) return res.status(404).json({ error: "Not found" });
    insertAudit(req.currentUser.id, "branch_update", "branch", id, {});
    scheduleBranchSync(db, id);
    appsScriptScheduleBranch(db, id);
    res.json({ branch: b });
  });

  router.get("/users", attachUser, (req, res) => {
    if (!can(req.currentUser, "users:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const scU = branchScopeSql(req.currentUser, "u");
    const users = db
      .prepare(
        `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active, created_at, mobile, department,
         COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_manual,1) AS allow_manual
         FROM users u WHERE u.deleted_at IS NULL${scU.sql} ORDER BY u.full_name`
      )
      .all(...scU.params);
    res.json({ users });
  });

  router.post("/users", attachUser, requirePerm("users:create"), (req, res) => {
    const {
      email,
      login_id,
      password,
      full_name,
      role,
      branch_id,
      shift_start,
      shift_end,
      grace_minutes,
      mobile,
      department,
      allow_gps,
      allow_face,
      allow_biometric,
      allow_manual,
    } = req.body || {};
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: "email, password, full_name, role required" });
    }
    const normalizedRole = normalizeRoleInput(role);
    if (!normalizedRole || !Object.values(ROLES).includes(normalizedRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (normalizedRole === ROLES.SUPER_ADMIN && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can create another Super Admin" });
    }
    const arCheck = assertRoleAssignableOnCreate(req.currentUser, normalizedRole);
    if (!arCheck.ok) return res.status(arCheck.status).json({ error: arCheck.error });
    if (isBranchScoped(req.currentUser)) {
      const bid = branch_id != null ? Number(branch_id) : req.currentUser.branch_id;
      if (req.currentUser.branch_id == null || Number(bid) !== Number(req.currentUser.branch_id)) {
        return res.status(403).json({ error: "Users must be assigned to your branch" });
      }
    }
    const hash = bcrypt.hashSync(String(password), 10);
    const ag = allow_gps !== undefined ? (allow_gps ? 1 : 0) : 1;
    const af = allow_face !== undefined ? (allow_face ? 1 : 0) : 0;
    const abm = allow_biometric !== undefined ? (allow_biometric ? 1 : 0) : 0;
    const am = allow_manual !== undefined ? (allow_manual ? 1 : 0) : 1;
    try {
      const info = db
        .prepare(
          `INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, mobile, department, shift_start, shift_end, grace_minutes, allow_gps, allow_face, allow_biometric, allow_manual)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          String(email).trim(),
          login_id ? String(login_id).trim() : null,
          hash,
          String(full_name).trim(),
          normalizedRole,
          branch_id ? Number(branch_id) : null,
          mobile ? String(mobile) : null,
          department ? String(department) : null,
          shift_start || "09:00",
          shift_end || "18:00",
          Number(grace_minutes) || 15,
          ag,
          af,
          abm,
          am
        );
      const u = db
        .prepare(
          `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active, mobile, department,
           COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_biometric,0) AS allow_biometric, COALESCE(allow_manual,1) AS allow_manual
           FROM users WHERE id = ?`
        )
        .get(info.lastInsertRowid);
      insertAudit(req.currentUser.id, "user_create", "user", u.id, { email: u.email });
      scheduleUserSync(db, u.id);
      appsScriptScheduleUser(db, u.id);
      res.json({ user: u });
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "Email already exists" });
      }
      throw e;
    }
  });

  const patchUserHandler = (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });
    const scopeU = assertUserAccess(req.currentUser, target);
    if (!scopeU.ok) return res.status(scopeU.status).json({ error: scopeU.error });
    if (target.role === ROLES.SUPER_ADMIN && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const {
      full_name,
      login_id,
      branch_id,
      shift_start,
      shift_end,
      grace_minutes,
      mobile,
      department,
      dob,
      joining_date,
      address,
      account_number,
      ifsc,
      bank_name,
      active,
      role,
      password,
      allow_gps,
      allow_face,
      allow_biometric,
      allow_manual,
    } = req.body || {};
    if (password != null && String(password).length > 0 && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin may set password" });
    }
    if (role && role !== target.role && !isOrgWide(req.currentUser)) {
      return res.status(403).json({ error: "Only Super Admin or Admin may change roles" });
    }
    const normalizedPatchRole = role ? normalizeRoleInput(role) : null;
    if (role && !normalizedPatchRole) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (normalizedPatchRole === ROLES.SUPER_ADMIN && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin may assign Super Admin role" });
    }
    const branchVal = branch_id === undefined ? null : branch_id;
    const activeVal = active === undefined ? null : active ? 1 : 0;
    db.prepare(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        login_id = COALESCE(?, login_id),
        branch_id = CASE WHEN ? IS NULL THEN branch_id ELSE ? END,
        mobile = COALESCE(?, mobile),
        department = COALESCE(?, department),
        dob = COALESCE(?, dob),
        joining_date = COALESCE(?, joining_date),
        address = COALESCE(?, address),
        account_number = COALESCE(?, account_number),
        ifsc = COALESCE(?, ifsc),
        bank_name = COALESCE(?, bank_name),
        shift_start = COALESCE(?, shift_start),
        shift_end = COALESCE(?, shift_end),
        grace_minutes = COALESCE(?, grace_minutes),
        active = CASE WHEN ? IS NULL THEN active ELSE ? END,
        role = COALESCE(?, role)
       WHERE id = ?`
    ).run(
      full_name || null,
      login_id || null,
      branchVal,
      branchVal,
      mobile || null,
      department || null,
      dob || null,
      joining_date || null,
      address || null,
      account_number || null,
      ifsc || null,
      bank_name || null,
      shift_start || null,
      shift_end || null,
      grace_minutes === undefined ? null : grace_minutes,
      activeVal,
      activeVal,
      normalizedPatchRole || null,
      id
    );
    if (allow_gps !== undefined) {
      db.prepare(`UPDATE users SET allow_gps = ? WHERE id = ?`).run(allow_gps ? 1 : 0, id);
    }
    if (allow_face !== undefined) {
      db.prepare(`UPDATE users SET allow_face = ? WHERE id = ?`).run(allow_face ? 1 : 0, id);
    }
    if (allow_biometric !== undefined) {
      db.prepare(`UPDATE users SET allow_biometric = ? WHERE id = ?`).run(allow_biometric ? 1 : 0, id);
    }
    if (allow_manual !== undefined) {
      db.prepare(`UPDATE users SET allow_manual = ? WHERE id = ?`).run(allow_manual ? 1 : 0, id);
    }
    if (password != null && String(password).length > 0) {
      const hash = bcrypt.hashSync(String(password), 10);
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id);
    }
    const u = db
      .prepare(
        `SELECT id, email, login_id, full_name, role, branch_id, mobile, department, dob, joining_date, address, account_number, ifsc, bank_name, shift_start, shift_end, grace_minutes, active,
         COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_biometric,0) AS allow_biometric, COALESCE(allow_manual,1) AS allow_manual FROM users WHERE id = ?`
      )
      .get(id);
    insertAudit(req.currentUser.id, "user_update", "user", id, {});
    scheduleUserSync(db, id);
    appsScriptScheduleUser(db, id);
    res.json({ user: u });
  };
  router.patch("/users/:id", attachUser, requirePerm("users:update"), patchUserHandler);
  router.put("/staff/:id", attachUser, requirePerm("users:update"), patchUserHandler);
  router.delete("/staff/:id", attachUser, requirePerm("users:update"), (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare("SELECT id, role FROM users WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });
    if (target.role === ROLES.SUPER_ADMIN && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    db.prepare("UPDATE users SET active = 0, deleted_at = datetime('now') WHERE id = ?").run(id);
    insertAudit(req.currentUser.id, "staff_delete", "user", id, {});
    res.json({ ok: true, id });
  });
  router.post("/staff/:id/photo", attachUser, requirePerm("users:update"), uploadFace.single("photo"), (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });
    if (!req.file) return res.status(400).json({ error: "photo file required" });
    const photoPath = `/uploads/faces/${req.file.filename}`;
    db.prepare("UPDATE users SET profile_photo = ? WHERE id = ?").run(photoPath, id);
    insertAudit(req.currentUser.id, "staff_photo_upload", "user", id, {});
    res.json({ id, profile_photo: photoPath });
  });

  router.get("/timings/me", attachUser, (req, res) => {
    const u = req.currentUser;
    res.json({
      shift_start: u.shift_start,
      shift_end: u.shift_end,
      grace_minutes: u.grace_minutes,
    });
  });

  router.patch("/timings/:userId", attachUser, (req, res) => {
    if (!can(req.currentUser, "timings:write")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const id = Number(req.params.userId);
    const { shift_start, shift_end, grace_minutes } = req.body || {};
    db.prepare(
      `UPDATE users SET shift_start = COALESCE(?, shift_start),
        shift_end = COALESCE(?, shift_end),
        grace_minutes = COALESCE(?, grace_minutes)
       WHERE id = ?`
    ).run(shift_start || null, shift_end || null, grace_minutes ?? null, id);
    const u = db
      .prepare(
        "SELECT id, email, full_name, role, branch_id, shift_start, shift_end, grace_minutes FROM users WHERE id = ?"
      )
      .get(id);
    appsScriptScheduleUser(db, id);
    res.json({ user: u });
  });

  router.get("/roles", attachUser, (req, res) => {
    if (!can(req.currentUser, "roles:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ roles: listRolesMeta() });
  });

  router.get("/notices", attachUser, (req, res) => {
    if (!can(req.currentUser, "notices:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const rows = db
      .prepare(
        `SELECT n.*, u.full_name AS author_name,
         CASE WHEN nr.user_id IS NOT NULL THEN 1 ELSE 0 END AS read_by_me
         FROM notices n
         JOIN users u ON u.id = n.created_by
         LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.user_id = ?
         WHERE n.active = 1
           AND (n.visible_from IS NULL OR datetime(n.visible_from) <= datetime('now'))
           AND (n.visible_until IS NULL OR datetime(n.visible_until) >= datetime('now'))
         ORDER BY n.created_at DESC
         LIMIT 50`
      )
      .all(req.currentUser.id);
    res.json({ notices: rows });
  });

  router.post("/notices", attachUser, requirePerm("notices:write"), (req, res) => {
    const { title, body, visible_from, visible_until } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const info = db
      .prepare("INSERT INTO notices (title, body, created_by, visible_from, visible_until) VALUES (?,?,?,?,?)")
      .run(String(title), String(body), req.currentUser.id, visible_from || null, visible_until || null);
    const n = db.prepare("SELECT * FROM notices WHERE id = ?").get(info.lastInsertRowid);
    appsScriptScheduleNotice(db, info.lastInsertRowid);
    res.json({ notice: n });
  });
  router.post("/notices/:id/read", attachUser, (req, res) => {
    const id = Number(req.params.id);
    const n = db.prepare("SELECT id FROM notices WHERE id = ? AND active = 1").get(id);
    if (!n) return res.status(404).json({ error: "Not found" });
    db.prepare("INSERT OR REPLACE INTO notice_reads (notice_id, user_id, read_at) VALUES (?,?,datetime('now'))").run(
      id,
      req.currentUser.id
    );
    res.json({ ok: true });
  });
  router.get("/notices/:id/replies", attachUser, (req, res) => {
    const id = Number(req.params.id);
    const rows = db
      .prepare(
        `SELECT r.id, r.notice_id, r.user_id, r.body, r.created_at, u.full_name AS user_name
         FROM notice_replies r
         JOIN users u ON u.id = r.user_id
         WHERE r.notice_id = ?
         ORDER BY r.id ASC`
      )
      .all(id);
    res.json({ replies: rows });
  });
  router.post("/notices/:id/replies", attachUser, (req, res) => {
    const id = Number(req.params.id);
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "body required" });
    const n = db.prepare("SELECT id FROM notices WHERE id = ? AND active = 1").get(id);
    if (!n) return res.status(404).json({ error: "Not found" });
    const info = db
      .prepare("INSERT INTO notice_replies (notice_id, user_id, body) VALUES (?,?,?)")
      .run(id, req.currentUser.id, body);
    const row = db
      .prepare(
        `SELECT r.id, r.notice_id, r.user_id, r.body, r.created_at, u.full_name AS user_name
         FROM notice_replies r JOIN users u ON u.id = r.user_id WHERE r.id = ?`
      )
      .get(info.lastInsertRowid);
    res.json({ reply: row });
  });
  router.get("/notices/:id/stats", attachUser, requirePerm("notices:write"), (req, res) => {
    const id = Number(req.params.id);
    const notice = db.prepare("SELECT id, title FROM notices WHERE id = ?").get(id);
    if (!notice) return res.status(404).json({ error: "Not found" });
    const readCount = Number(
      db.prepare("SELECT COUNT(*) AS c FROM notice_reads WHERE notice_id = ?").get(id).c
    );
    const replyCount = Number(
      db.prepare("SELECT COUNT(*) AS c FROM notice_replies WHERE notice_id = ?").get(id).c
    );
    const reads = db
      .prepare(
        `SELECT nr.user_id, nr.read_at, u.full_name
         FROM notice_reads nr JOIN users u ON u.id = nr.user_id
         WHERE nr.notice_id = ?
         ORDER BY nr.read_at DESC LIMIT 200`
      )
      .all(id);
    res.json({ notice, readCount, replyCount, reads });
  });

  router.get("/settings", attachUser, (req, res) => {
    if (!can(req.currentUser, "settings:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(readAppSettings());
  });
  router.get("/attendance/wifi-config", attachUser, (req, res) => {
    if (!can(req.currentUser, "settings:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const s = readAppSettings();
    res.json(s.attendance_wifi || { enabled: false, allowed_ssids: [] });
  });
  router.patch("/attendance/wifi-config", attachUser, requirePerm("settings:write"), (req, res) => {
    const cur = readAppSettings();
    const enabled = !!req.body?.enabled;
    const ssids = Array.isArray(req.body?.allowed_ssids)
      ? req.body.allowed_ssids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const next = {
      ...cur,
      attendance_wifi: {
        enabled,
        allowed_ssids: ssids,
      },
    };
    writeAppSettings(next);
    insertAudit(req.currentUser.id, "attendance_wifi_update", "settings", "attendance_wifi", {
      enabled,
      count: ssids.length,
    });
    res.json(next.attendance_wifi);
  });

  router.patch("/settings", attachUser, requirePerm("settings:write"), (req, res) => {
    const cur = readAppSettings();
    const body = req.body || {};
    const next = {
      ...cur,
      ...body,
      features: { ...cur.features, ...(body.features || {}) },
    };
    writeAppSettings(next);
    insertAudit(req.currentUser.id, "settings_update", "settings", "app", { keys: Object.keys(body) });
    res.json(readAppSettings());
  });
  router.get("/settings/daily-report", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can view report recipients" });
    }
    const s = readAppSettings();
    res.json(
      s.daily_report || {
        enabled: true,
        recipients: ["contact@prakritiherbs.in", "mkhirnval@gmail.com"],
      }
    );
  });
  router.patch("/settings/daily-report", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can edit report recipients" });
    }
    const cur = readAppSettings();
    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients.map((x) => String(x).trim()).filter(Boolean)
      : (cur.daily_report?.recipients || []);
    const enabled = req.body?.enabled == null ? !!cur.daily_report?.enabled : !!req.body.enabled;
    const next = {
      ...cur,
      daily_report: {
        enabled,
        recipients,
      },
    };
    writeAppSettings(next);
    insertAudit(req.currentUser.id, "daily_report_settings_update", "settings", "daily_report", {
      enabled,
      recipientsCount: recipients.length,
    });
    res.json(next.daily_report);
  });

  router.get("/hr/alerts", attachUser, (req, res) => {
    if (
      req.currentUser.role !== ROLES.SUPER_ADMIN &&
      req.currentUser.role !== ROLES.ADMIN &&
      req.currentUser.role !== ROLES.ATTENDANCE_MANAGER
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ alerts: listRecentAlerts(db, { limit: Number(req.query.limit) || 100 }) });
  });

  router.patch("/hr/alerts/:id/read", attachUser, (req, res) => {
    if (
      req.currentUser.role !== ROLES.SUPER_ADMIN &&
      req.currentUser.role !== ROLES.ADMIN &&
      req.currentUser.role !== ROLES.ATTENDANCE_MANAGER
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const id = Number(req.params.id);
    db.prepare(`UPDATE hr_alerts SET read_by_admin = 1 WHERE id = ?`).run(id);
    res.json({ ok: true });
  });

  router.get("/audit/logs", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 2000);
    const rows = db
      .prepare(
        `SELECT a.*, u.full_name AS actor_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.id DESC
         LIMIT ?`
      )
      .all(limit);
    res.json({ logs: rows });
  });

  router.get("/trash/users", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const rows = db
      .prepare(
        `SELECT id, full_name, login_id, email, mobile, role, deleted_at
         FROM users
         WHERE deleted_at IS NOT NULL
         ORDER BY datetime(deleted_at) DESC
         LIMIT 1000`
      )
      .all();
    res.json({ users: rows });
  });

  router.post("/trash/users/:id/restore", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const id = Number(req.params.id);
    const row = db.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NOT NULL").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    db.prepare("UPDATE users SET deleted_at = NULL, active = 1 WHERE id = ?").run(id);
    insertAudit(req.currentUser.id, "staff_restore", "user", id, {});
    res.json({ ok: true, id });
  });

  router.get("/trash/retention", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({
      mode: String(process.env.TRASH_RETENTION_MODE || "days"),
      days: Number(process.env.TRASH_RETENTION_DAYS || 30),
      minutes: Number(process.env.TRASH_RETENTION_MINUTES || 30),
    });
  });

  router.patch("/trash/retention", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const mode = String(req.body?.mode || process.env.TRASH_RETENTION_MODE || "days").toLowerCase();
    const days = Number(req.body?.days ?? process.env.TRASH_RETENTION_DAYS ?? 30);
    const minutes = Number(req.body?.minutes ?? process.env.TRASH_RETENTION_MINUTES ?? 30);
    if (mode !== "days" && mode !== "minutes") {
      return res.status(400).json({ error: "mode must be days or minutes" });
    }
    process.env.TRASH_RETENTION_MODE = mode;
    process.env.TRASH_RETENTION_DAYS = String(Number.isFinite(days) && days > 0 ? Math.floor(days) : 30);
    process.env.TRASH_RETENTION_MINUTES = String(
      Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 30
    );
    insertAudit(req.currentUser.id, "trash_retention_update", "settings", "trash_retention", {
      mode: process.env.TRASH_RETENTION_MODE,
      days: process.env.TRASH_RETENTION_DAYS,
      minutes: process.env.TRASH_RETENTION_MINUTES,
    });
    res.json({
      mode: process.env.TRASH_RETENTION_MODE,
      days: Number(process.env.TRASH_RETENTION_DAYS),
      minutes: Number(process.env.TRASH_RETENTION_MINUTES),
    });
  });

  router.get("/attendance/live-status", attachUser, (req, res) => {
    if (!can(req.currentUser, "attendance:read_all") && !can(req.currentUser, "history:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const today = todayLocalDate();
    const rows = db
      .prepare(
        `SELECT ar.*, u.full_name, u.email, u.login_id
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id
         WHERE ar.work_date = ? AND ar.punch_in_at IS NOT NULL AND ar.punch_out_at IS NULL
         ORDER BY u.full_name`
      )
      .all(today);
    res.json({ date: today, currently_in: rows });
  });

  function listEmployeesHandler(req, res) {
    const mapRow = (r) => ({
      id: r.id,
      name: r.full_name,
      role: mapSimpleRole(r.role),
      rbacRole: r.role,
      department: r.department || null,
      mobile: r.mobile || null,
      email: r.email,
      branch_id: r.branch_id,
      login_id: r.login_id ?? null,
      profile_photo: r.profile_photo || null,
      dob: r.dob || null,
      joining_date: r.joining_date || null,
      address: r.address || null,
      account_number: r.account_number || null,
      ifsc: r.ifsc || null,
      bank_name: r.bank_name || null,
      document_count: Number(r.document_count || 0),
      active: r.active,
      allow_gps: r.allow_gps,
      allow_face: r.allow_face,
      allow_manual: r.allow_manual,
      shift_start: r.shift_start,
      shift_end: r.shift_end,
      grace_minutes: r.grace_minutes,
    });
    if (can(req.currentUser, "users:read")) {
      const rows = db
        .prepare(
          `SELECT id, full_name, email, login_id, role, branch_id, mobile, department, active, shift_start, shift_end, grace_minutes, profile_photo, dob, joining_date, address, account_number, ifsc, bank_name,
           (SELECT COUNT(*) FROM employee_documents d WHERE d.user_id = users.id) AS document_count,
           COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_manual,1) AS allow_manual
           FROM users WHERE deleted_at IS NULL ORDER BY full_name`
        )
        .all();
      return res.json({ employees: rows.map(mapRow) });
    }
    const self = db
      .prepare(
        `SELECT id, full_name, email, login_id, role, branch_id, mobile, department, active, shift_start, shift_end, grace_minutes, profile_photo, dob, joining_date, address, account_number, ifsc, bank_name,
         (SELECT COUNT(*) FROM employee_documents d WHERE d.user_id = users.id) AS document_count,
         COALESCE(allow_gps,1) AS allow_gps, COALESCE(allow_face,0) AS allow_face, COALESCE(allow_manual,1) AS allow_manual
         FROM users WHERE id = ? AND deleted_at IS NULL`
      )
      .get(req.currentUser.id);
    if (!self) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.json({ employees: [mapRow(self)] });
  }

  router.get("/employees", attachUser, listEmployeesHandler);
  router.get("/staff", attachUser, listEmployeesHandler);

  function createEmployeeHandler(req, res) {
    const { name, mobile, password, role, staff_sub_type, department, email, login_id, dob, joining_date, address, account_number, ifsc, bank_name, branch_id } =
      req.body || {};
    if (!name || !password) {
      return res.status(400).json({ error: "name and password required" });
    }
    const mapped = normalizeRoleInput(role);
    if (!mapped) {
      return res.status(400).json({ error: "role must be valid role id" });
    }
    const roleCreateCheck = assertRoleAssignableOnCreate(req.currentUser, mapped);
    if (!roleCreateCheck.ok) return res.status(roleCreateCheck.status).json({ error: roleCreateCheck.error });
    const branchId =
      branch_id != null && branch_id !== ""
        ? Number(branch_id)
        : req.currentUser.branch_id != null
          ? req.currentUser.branch_id
          : null;
    if (isBranchScoped(req.currentUser) && Number(req.currentUser.branch_id) !== Number(branchId)) {
      return res.status(403).json({ error: "Users must be assigned to your branch" });
    }
    const em =
      email && String(email).trim()
        ? String(email).trim()
        : `emp${Date.now()}@prakriti.local`;
    const loginId =
      login_id && String(login_id).trim()
        ? String(login_id).trim()
        : generateBranchEmployeeId(branchId);
    const hash = bcrypt.hashSync(String(password), 10);
    try {
      const info = db
        .prepare(
          `INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, mobile, department, dob, joining_date, address, account_number, ifsc, bank_name, shift_start, shift_end, grace_minutes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          em,
          loginId,
          hash,
          String(name).trim(),
          mapped,
          branchId,
          mobile ? String(mobile) : null,
          department ? String(department) : staff_sub_type ? String(staff_sub_type) : null,
          dob ? String(dob) : null,
          joining_date ? String(joining_date) : null,
          address ? String(address) : null,
          account_number ? String(account_number) : null,
          ifsc ? String(ifsc) : null,
          bank_name ? String(bank_name) : null,
          "09:00",
          "18:00",
          15
        );
      const u = db
        .prepare(
          "SELECT id, email, login_id, full_name, role, branch_id, mobile, department, dob, joining_date, address, account_number, ifsc, bank_name FROM users WHERE id = ?"
        )
        .get(info.lastInsertRowid);
      insertAudit(req.currentUser.id, "employee_create", "user", u.id, { email: u.email });
      scheduleUserSync(db, u.id);
      appsScriptScheduleUser(db, u.id);
      res.json({
        employee: {
          id: u.id,
          name: u.full_name,
          role: mapSimpleRole(u.role),
          rbacRole: u.role,
          department: u.department,
          mobile: u.mobile,
          email: u.email,
          login_id: u.login_id,
          dob: u.dob,
          joining_date: u.joining_date,
          address: u.address,
          account_number: u.account_number,
          ifsc: u.ifsc,
          bank_name: u.bank_name,
        },
      });
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "Email already exists" });
      }
      throw e;
    }
  }

  router.post("/employees", attachUser, requirePerm("users:create"), createEmployeeHandler);
  router.post("/staff", attachUser, requirePerm("users:create"), createEmployeeHandler);

  router.get("/crm/leads", attachUser, requirePerm("crm:read"), (req, res) => {
    const rows = db
      .prepare(
        `SELECT l.id, l.full_name, l.phone, l.email, l.company, l.status, l.notes, l.created_at,
                u.full_name AS created_by_name
         FROM crm_leads l
         LEFT JOIN users u ON u.id = l.created_by
         ORDER BY l.id DESC
         LIMIT 500`
      )
      .all();
    res.json({ leads: rows });
  });

  router.post("/crm/leads", attachUser, requirePerm("crm:write"), (req, res) => {
    const { full_name, phone, email, company, status, notes } = req.body || {};
    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: "full_name required" });
    }
    const info = db
      .prepare(
        `INSERT INTO crm_leads (full_name, phone, email, company, status, notes, created_by)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        String(full_name).trim(),
        phone ? String(phone).trim() : null,
        email ? String(email).trim() : null,
        company ? String(company).trim() : null,
        status && String(status).trim() ? String(status).trim() : "new",
        notes != null ? String(notes) : null,
        req.currentUser.id
      );
    const row = db
      .prepare(
        `SELECT l.id, l.full_name, l.phone, l.email, l.company, l.status, l.notes, l.created_at,
                u.full_name AS created_by_name
         FROM crm_leads l
         LEFT JOIN users u ON u.id = l.created_by
         WHERE l.id = ?`
      )
      .get(info.lastInsertRowid);
    insertAudit(req.currentUser.id, "crm_lead_create", "crm_lead", row.id, { full_name: row.full_name });
    res.json({ lead: row });
  });

  router.get("/logs", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 2000);
    const rows = db
      .prepare(
        `SELECT a.id, a.actor_id, u.full_name AS actor_name, a.action, a.created_at, a.entity_type, a.entity_id, a.details
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.id DESC
         LIMIT ?`
      )
      .all(limit);
    const logs = rows.map((r) => ({
      id: r.id,
      userId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      timestamp: r.created_at,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details
        ? (() => {
            try {
              return JSON.parse(r.details);
            } catch {
              return r.details;
            }
          })()
        : null,
    }));
    res.json({ logs });
  });

  router.get("/reports", attachUser, (req, res) => {
    if (!can(req.currentUser, "export:read") && !can(req.currentUser, "dashboard:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const now = new Date();
    const y = Number(req.query.year) || now.getFullYear();
    const m = Number(req.query.month) || now.getMonth() + 1;
    res.json({
      generatedAt: new Date().toISOString(),
      exports: {
        attendanceCsv: "/api/attendance/export.csv",
        attendanceXlsx: "/api/attendance/export.xlsx",
        monthlyCsv: `/api/reports/monthly.csv?year=${y}&month=${m}`,
        monthlyPdf: `/api/reports/monthly.pdf?year=${y}&month=${m}`,
        monthlyAttendanceXlsx: `/api/reports/monthly-attendance.xlsx?year=${y}&month=${m}`,
        dailyPdf: "/api/reports/daily.pdf",
        dailyXlsx: "/api/reports/daily.xlsx",
        employeesCsv: "/api/employees/export.csv",
        leaveCsv: "/api/leave/export.csv",
        documentsXlsx: "/api/documents/export.xlsx",
        payrollXlsx: `/api/payroll/export.xlsx?period=${y}-${String(m).padStart(2, "0")}`,
      },
      meta: "/api/meta",
      note: "Use Authorization: Bearer token for downloads. PDF/XLSX/CSV supported.",
    });
  });
  router.get("/mobile/apk", attachUser, (req, res) => {
    const apkUrl = process.env.APK_DOWNLOAD_URL || "/downloads/hrms-app.apk";
    res.json({ apk_url: apkUrl, note: "Download and install HRMS APK on Android devices." });
  });
  router.get("/warnings/me", attachUser, (req, res) => {
    const u = req.currentUser;
    const today = todayLocalDate();
    const month = today.slice(0, 7);
    const rows = [];
    const todayRec = db
      .prepare("SELECT status, punch_in_at, punch_out_at FROM attendance_records WHERE user_id = ? AND work_date = ?")
      .get(u.id, today);
    if (todayRec?.status === "late") {
      rows.push({ type: "attendance", severity: "warning", message: "Aaj aap late mark hue hain." });
    }
    if (todayRec?.punch_in_at && !todayRec?.punch_out_at) {
      rows.push({ type: "attendance", severity: "warning", message: "Aaj ka punch-out pending hai." });
    }
    const approvedLeaves = Number(
      db.prepare("SELECT COUNT(*) AS c FROM leave_requests WHERE user_id = ? AND final_status = 'APPROVED'").get(u.id).c
    );
    if (approvedLeaves >= 2) {
      rows.push({
        type: "leave",
        severity: approvedLeaves >= 4 ? "critical" : "warning",
        message:
          approvedLeaves >= 4
            ? `Aapki ${approvedLeaves} leaves approve ho chuki hain. Ab salary deduction apply ho sakta hai.`
            : `Aapki ${approvedLeaves} leave use ho chuki hain.`,
      });
    }
    const payrollRow = db
      .prepare(
        `SELECT COALESCE(deductions_inr,0) AS d FROM payroll_entries WHERE user_id = ? AND period = ? ORDER BY id DESC LIMIT 1`
      )
      .get(u.id, month);
    if (Number(payrollRow?.d || 0) > 0) {
      rows.push({
        type: "payroll",
        severity: "warning",
        message: `Is month aapki payroll deduction Rs ${Math.round(Number(payrollRow.d))} hai.`,
      });
    }
    res.json({ warnings: rows });
  });
  router.get("/warnings/overview", attachUser, (req, res) => {
    if (
      req.currentUser.role !== ROLES.SUPER_ADMIN &&
      req.currentUser.role !== ROLES.ADMIN &&
      req.currentUser.role !== ROLES.ATTENDANCE_MANAGER
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const lateToday = Number(
      db.prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE work_date = ? AND status = 'late'").get(todayLocalDate()).c
    );
    const missedPunchOut = Number(
      db.prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE work_date = ? AND punch_in_at IS NOT NULL AND punch_out_at IS NULL").get(todayLocalDate()).c
    );
    const leaveHeavyUsers = db
      .prepare(
        `SELECT u.id, u.full_name, COUNT(*) AS approved_count
         FROM leave_requests lr JOIN users u ON u.id = lr.user_id
         WHERE lr.final_status = 'APPROVED'
         GROUP BY u.id
         HAVING approved_count >= 2
         ORDER BY approved_count DESC
         LIMIT 20`
      )
      .all();
    res.json({ lateToday, missedPunchOut, leaveHeavyUsers });
  });

  function employeeDateFilterClause(req) {
    const mode = String(req.query.date_filter || "all").toLowerCase();
    if (mode === "today") {
      const d = todayLocalDate();
      return { sql: " AND date(created_at) = ?", params: [d], tag: d };
    }
    if (mode === "yesterday") {
      const t = new Date();
      t.setDate(t.getDate() - 1);
      const d = t.toISOString().slice(0, 10);
      return { sql: " AND date(created_at) = ?", params: [d], tag: d };
    }
    if (mode === "custom") {
      const from = String(req.query.from || "").slice(0, 10);
      const to = String(req.query.to || "").slice(0, 10);
      if (from && to) return { sql: " AND date(created_at) BETWEEN ? AND ?", params: [from, to], tag: `${from}_${to}` };
    }
    return { sql: "", params: [], tag: "all" };
  }

  function employeeExportRows(req) {
    const f = employeeDateFilterClause(req);
    const sql = `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active, created_at, mobile, department, dob, joining_date, address, account_number, ifsc, bank_name
         FROM users WHERE deleted_at IS NULL${f.sql} ORDER BY full_name`;
    const rows = db.prepare(sql).all(...f.params);
    return { rows, tag: f.tag };
  }

  router.get("/employees/export.csv", attachUser, (req, res) => {
    if (!can(req.currentUser, "users:read") || !can(req.currentUser, "export:read")) {
      return res.status(403).send("Forbidden");
    }
    const { rows, tag } = employeeExportRows(req);
    const headers = [
      "id",
      "email",
      "login_id",
      "full_name",
      "role",
      "branch_id",
      "shift_start",
      "shift_end",
      "grace_minutes",
      "active",
      "created_at",
      "mobile",
      "department",
      "dob",
      "joining_date",
      "address",
      "account_number",
      "ifsc",
      "bank_name",
    ];
    const esc = (v) => {
      if (v == null) return '""';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    };
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(headers.map((h) => esc(r[h])).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="employees-${tag}.csv"`);
    res.send(lines.join("\n"));
  });

  router.get("/employees/export.xlsx", attachUser, async (req, res, next) => {
    try {
      if (!can(req.currentUser, "users:read") || !can(req.currentUser, "export:read")) {
        return res.status(403).send("Forbidden");
      }
      const { rows, tag } = employeeExportRows(req);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Employees");
      const headers = ["ID", "Employee ID", "Name", "Role", "Branch", "Mobile", "Email", "DOB", "Joining Date", "Address", "Account Number", "IFSC", "Bank Name", "Created At"];
      ws.addRow(headers);
      rows.forEach((r) => {
        ws.addRow([r.id, r.login_id || "", r.full_name, r.role, r.branch_id ?? "", r.mobile || "", r.email || "", r.dob || "", r.joining_date || "", r.address || "", r.account_number || "", r.ifsc || "", r.bank_name || "", r.created_at || ""]);
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=\"employees-${tag}.xlsx\"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (e) {
      next(e);
    }
  });

  router.get("/employees/export.pdf", attachUser, (req, res) => {
    if (!can(req.currentUser, "users:read") || !can(req.currentUser, "export:read")) {
      return res.status(403).send("Forbidden");
    }
    const { rows, tag } = employeeExportRows(req);
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"employees-${tag}.pdf\"`);
    doc.pipe(res);
    doc.fontSize(14).text(`Employees Export (${tag})`);
    doc.moveDown(0.5);
    rows.slice(0, 500).forEach((r, idx) => {
      doc.fontSize(9).text(`${idx + 1}. ${r.full_name} | ${r.login_id || "-"} | ${r.mobile || "-"} | ${r.role} | ${r.branch_id || "-"}`);
    });
    doc.end();
  });
  router.get("/system/export.xlsx", attachUser, (req, res, next) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can export full system data" });
    }
    try {
      const wb = new ExcelJS.Workbook();
      const sheets = [
        ["Employees", "SELECT id, full_name, email, login_id, role, branch_id, mobile, department, active, created_at FROM users WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 5000"],
        ["Attendance", "SELECT id, user_id, work_date, status, punch_in_at, punch_out_at, punch_method_in, punch_method_out, verification_in, verification_out FROM attendance_records ORDER BY id DESC LIMIT 10000"],
        ["Payroll", "SELECT id, user_id, period, gross_inr, deductions_inr, net_inr, notes, created_at FROM payroll_entries ORDER BY id DESC LIMIT 10000"],
        ["Leaves", "SELECT id, user_id, start_date, end_date, reason, final_status, manager_review, admin_review, created_at FROM leave_requests ORDER BY id DESC LIMIT 10000"],
        ["Documents", "SELECT id, user_id, doc_type, file_name, file_path, verified, created_at FROM employee_documents ORDER BY id DESC LIMIT 10000"],
      ];
      for (const [name, sql] of sheets) {
        const ws = wb.addWorksheet(name);
        const rows = db.prepare(sql).all();
        if (rows.length) {
          ws.columns = Object.keys(rows[0]).map((k) => ({ header: k, key: k }));
          rows.forEach((r) => ws.addRow(r));
        } else {
          ws.addRow(["No data"]);
        }
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="full-system-${todayLocalDate()}.xlsx"`);
      wb.xlsx.write(res).then(() => res.end()).catch(next);
    } catch (e) {
      next(e);
    }
  });
  router.get("/system/export.pdf", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can export full system data" });
    }
    const totals = {
      employees: Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL").get().c),
      attendance: Number(db.prepare("SELECT COUNT(*) AS c FROM attendance_records").get().c),
      payroll: Number(db.prepare("SELECT COUNT(*) AS c FROM payroll_entries").get().c),
      leaves: Number(db.prepare("SELECT COUNT(*) AS c FROM leave_requests").get().c),
      documents: Number(db.prepare("SELECT COUNT(*) AS c FROM employee_documents").get().c),
    };
    const doc = new PDFDocument({ margin: 36, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="full-system-${todayLocalDate()}.pdf"`);
    doc.pipe(res);
    doc.fontSize(16).text("Prakriti HRMS - Full System Export");
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown();
    Object.entries(totals).forEach(([k, v]) => doc.text(`${k}: ${v}`));
    doc.moveDown();
    doc.text("Use XLSX export for full row-level data.");
    doc.end();
  });

  router.get("/reports/monthly.csv", attachUser, (req, res) => {
    if (!can(req.currentUser, "export:read")) {
      return res.status(403).send("Forbidden");
    }
    const y = Number(req.query.year) || new Date().getFullYear();
    const m = Number(req.query.month) || new Date().getMonth() + 1;
    const pad = (n) => String(n).padStart(2, "0");
    const from = `${y}-${pad(m)}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${y}-${pad(m)}-${pad(lastDay)}`;
    let sql = `
      SELECT ar.*, u.full_name, u.email, u.login_id, b.name AS branch_name
      FROM attendance_records ar
      JOIN users u ON u.id = ar.user_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE ar.work_date >= ? AND ar.work_date <= ?
    `;
    const params = [from, to];
    if (!can(req.currentUser, "history:read")) {
      sql += " AND ar.user_id = ?";
      params.push(req.currentUser.id);
    }
    sql += " ORDER BY ar.work_date ASC, u.full_name ASC LIMIT 20000";
    const recs = db.prepare(sql).all(...params);
    const headers = [
      "id",
      "work_date",
      "user_id",
      "full_name",
      "email",
      "branch_name",
      "status",
      "punch_in_at",
      "punch_out_at",
    ];
    const esc = (v) => {
      if (v == null) return '""';
      return `"${String(v).replace(/"/g, '""')}"`;
    };
    const lines = [headers.join(",")];
    for (const r of recs) {
      lines.push(headers.map((h) => esc(r[h])).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="attendance-report-${y}-${pad(m)}.csv"`
    );
    res.send(lines.join("\n"));
  });

  router.get("/payroll/overview", attachUser, (req, res) => {
    const actor = req.currentUser;
    if (!can(actor, "payroll:read") && !can(actor, "payroll:read_self")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const period =
      String(req.query.period || "")
        .trim()
        .slice(0, 7) || todayLocalDate().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: "period must be YYYY-MM" });
    }
    const entries = can(actor, "payroll:read")
      ? db
          .prepare(
            `SELECT p.*, u.full_name, u.email, u.branch_id
             FROM payroll_entries p
             JOIN users u ON u.id = p.user_id
             WHERE p.period = ?
             ORDER BY u.full_name`
          )
          .all(period)
      : db
          .prepare(
            `SELECT p.*, u.full_name, u.email, u.branch_id
             FROM payroll_entries p
             JOIN users u ON u.id = p.user_id
             WHERE p.period = ? AND p.user_id = ?
             ORDER BY u.full_name`
          )
          .all(period, actor.id);
    const sumGross = entries.reduce((a, e) => a + (Number(e.gross_inr) || 0), 0);
    const sumDed = entries.reduce((a, e) => a + (Number(e.deductions_inr) || 0), 0);
    const sumNet = entries.reduce((a, e) => a + (Number(e.net_inr) || 0), 0);
    const sumIncentive = entries.reduce((a, e) => a + (Number(e.incentive_inr) || 0), 0);
    res.json({
      period,
      totals: {
        gross_inr: sumGross,
        deductions_inr: sumDed,
        net_inr: sumNet,
        incentive_inr: sumIncentive,
        count: entries.length,
      },
      entries,
    });
  });

  router.get("/payroll/entries", attachUser, (req, res) => {
    const actor = req.currentUser;
    const period =
      String(req.query.period || "")
        .trim()
        .slice(0, 7) || todayLocalDate().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: "period must be YYYY-MM" });
    }
    if (can(actor, "payroll:read")) {
      const rows = db
        .prepare(
          `SELECT p.*, u.full_name, u.email FROM payroll_entries p
           JOIN users u ON u.id = p.user_id WHERE p.period = ? ORDER BY u.full_name`
        )
        .all(period);
      return res.json({ period, entries: rows });
    }
    if (can(actor, "payroll:read_self")) {
      const rows = db
        .prepare(
          `SELECT p.*, u.full_name, u.email FROM payroll_entries p
           JOIN users u ON u.id = p.user_id WHERE p.period = ? AND p.user_id = ?`
        )
        .all(period, actor.id);
      return res.json({ period, entries: rows });
    }
    return res.status(403).json({ error: "Forbidden" });
  });

  router.post("/payroll/entries", attachUser, (req, res) => {
    const actor = req.currentUser;
    if (!can(actor, "payroll:write")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { user_id, period, gross_inr, deductions_inr, notes } = req.body || {};
    if (!user_id || !period) {
      return res.status(400).json({ error: "user_id and period (YYYY-MM) required" });
    }
    const p = String(period).trim().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(p)) {
      return res.status(400).json({ error: "period must be YYYY-MM" });
    }
    const gross = Number(gross_inr) || 0;
    const ded = Number(deductions_inr) || 0;
    const net = gross - ded;
    const uid = Number(user_id);
    const existing = db.prepare("SELECT id FROM payroll_entries WHERE user_id = ? AND period = ?").get(uid, p);
    if (existing) {
      db.prepare(
        `UPDATE payroll_entries SET gross_inr = ?, deductions_inr = ?, net_inr = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(gross, ded, net, notes || null, existing.id);
    } else {
      db.prepare(
        `INSERT INTO payroll_entries (user_id, period, gross_inr, deductions_inr, net_inr, notes) VALUES (?,?,?,?,?,?)`
      ).run(uid, p, gross, ded, net, notes || null);
    }
    const row = db
      .prepare(
        `SELECT p.*, u.full_name FROM payroll_entries p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND p.period = ?`
      )
      .get(uid, p);
    if (!row) {
      return res.status(500).json({ error: "Payroll row missing after save" });
    }
    insertAudit(actor.id, "payroll_upsert", "payroll_entry", row.id, { period: p, user_id: uid });
    res.json({ entry: row });
  });

  router.get("/documents", attachUser, (req, res) => {
    const u = req.currentUser;
    let rows;
    if (can(u, "documents:read_all")) {
      rows = db
        .prepare(
          `SELECT d.*, usr.full_name AS user_name, usr.email AS user_email
           FROM employee_documents d
           JOIN users usr ON usr.id = d.user_id
           ORDER BY d.id DESC
           LIMIT 500`
        )
        .all();
    } else {
      rows = db
        .prepare(
          `SELECT d.*, usr.full_name AS user_name, usr.email AS user_email
           FROM employee_documents d
           JOIN users usr ON usr.id = d.user_id
           WHERE d.user_id = ?
           ORDER BY d.id DESC`
        )
        .all(u.id);
    }
    res.json({ documents: rows });
  });

  router.post("/documents", attachUser, uploadDoc.single("file"), (req, res) => {
    const u = req.currentUser;
    if (!req.file) {
      return res.status(400).json({ error: "file required (multipart field: file)" });
    }
    const doc_type = String((req.body && req.body.doc_type) || "other");
    let targetUserId = u.id;
    if (req.body && req.body.user_id != null && String(req.body.user_id) !== String(u.id)) {
      if (!can(u, "users:update") && u.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({ error: "Cannot upload for another user" });
      }
      targetUserId = Number(req.body.user_id);
    }
    const rel = `/uploads/documents/${req.file.filename}`;
    const info = db
      .prepare(
        `INSERT INTO employee_documents (user_id, doc_type, file_name, file_path, verified) VALUES (?,?,?,?,0)`
      )
      .run(targetUserId, doc_type, req.file.originalname || req.file.filename, rel);
    const row = db.prepare("SELECT * FROM employee_documents WHERE id = ?").get(info.lastInsertRowid);
    insertAudit(u.id, "document_upload", "employee_document", row.id, { doc_type });
    res.json({ document: row });
  });

  router.patch("/documents/:id/verify", attachUser, (req, res) => {
    if (!can(req.currentUser, "documents:verify")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const id = Number(req.params.id);
    const { verified, verifier_notes } = req.body || {};
    const v = verified ? 1 : 0;
    db.prepare(
      `UPDATE employee_documents SET verified = ?, verified_by = ?, verified_at = datetime('now'), verifier_notes = ? WHERE id = ?`
    ).run(v, req.currentUser.id, verifier_notes != null ? String(verifier_notes) : null, id);
    const row = db.prepare("SELECT * FROM employee_documents WHERE id = ?").get(id);
    if (!row) {
      return res.status(404).json({ error: "Not found" });
    }
    insertAudit(req.currentUser.id, "document_verify", "employee_document", id, { verified: v });
    res.json({ document: row });
  });

  registerWebAuthnRoutes(router, { db, attachUser, insertAudit });
  registerBiometricRoutes(router, { db, attachUser, insertAudit });

  registerLeaveRoutes(router, db, {
    attachUser,
    can,
    onLeaveChange: (leaveId) => {
      scheduleLeaveSync(db, leaveId);
      appsScriptScheduleLeave(db, leaveId);
    },
    auditLeave: (actorId, action, leaveId, details) =>
      insertAudit(actorId, action, "leave_request", leaveId, details),
  });

  registerEnterpriseRoutes(router, {
    db,
    attachUser,
    can,
    ROLES,
    insertAudit,
    bcrypt,
    requirePerm,
  });

  registerProductRoutes(router, {
    db,
    attachUser,
    can,
    ROLES,
    requirePerm,
    todayLocalDate,
    uploadFace,
    insertAudit,
  });

  router.get("/integrations/apps-script/status", attachUser, (req, res) => {
    if (!can(req.currentUser, "integrations:sync")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(getAppsScriptStatus(db));
  });

  router.post("/integrations/apps-script/bulk-push", attachUser, async (req, res, next) => {
    try {
      if (!can(req.currentUser, "integrations:sync")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const result = await appsScriptFullBulkPushAll(db);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.use((req, res) => {
    res.status(404).json({ error: "Not found", path: req.path });
  });

  router.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  });

  return router;
}

module.exports = { createApiRouter };
