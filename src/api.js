const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const { can, requirePerm, listRolesMeta, ROLES } = require("./rbac");
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

function createApiRouter(db) {
  const router = express.Router();

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

  function attachUser(req, res, next) {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const user = db
      .prepare(
        `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active
         FROM users WHERE id = ?`
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

  router.post("/auth/login", (req, res) => {
    const { email, password, login } = req.body || {};
    const idOrEmail = String(email || login || "").trim();
    if (!idOrEmail || !password) {
      return res.status(400).json({ error: "Email or user ID and password required" });
    }
    const user = db
      .prepare(
        `SELECT id, email, login_id, password_hash, full_name, role, branch_id, active FROM users
         WHERE lower(email) = lower(?) OR lower(ifnull(login_id,'')) = lower(?)`
      )
      .get(idOrEmail, idOrEmail);
    if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    req.session.userId = user.id;
    res.json({
      id: user.id,
      email: user.email,
      login_id: user.login_id,
      full_name: user.full_name,
      role: user.role,
      branch_id: user.branch_id,
    });
  });

  router.post("/auth/logout", attachUser, (req, res) => {
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
    ];
    keys.forEach((k) => {
      meta[k] = can(user, k);
    });
    return meta;
  }

  function branchGeoCheck(user, lat, lng) {
    if (lat == null || lng == null) {
      return { ok: false, reason: "GPS coordinates required for punch at this branch." };
    }
    if (!user.branch_id) return { ok: true };
    const b = db.prepare("SELECT * FROM branches WHERE id = ?").get(user.branch_id);
    if (!b || b.lat == null || b.lng == null) return { ok: true };
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

  router.post(
    "/attendance/punch",
    attachUser,
    upload.single("photo"),
    async (req, res, next) => {
      try {
        const actor = req.currentUser;
        const type = req.body.type;
        const lat = req.body.lat !== undefined && req.body.lat !== "" ? Number(req.body.lat) : null;
        const lng = req.body.lng !== undefined && req.body.lng !== "" ? Number(req.body.lng) : null;
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
            "SELECT id, branch_id, shift_start, shift_end, grace_minutes, active FROM users WHERE id = ?"
          )
          .get(subjectId);
        if (!subject || !subject.active) {
          return res.status(404).json({ error: "User not found" });
        }

        const geo = branchGeoCheck(subject, lat, lng);
        if (!geo.ok) {
          return res.status(400).json({ error: geo.reason });
        }

        const address = await reverseGeocode(lat, lng);
        const photoPath = req.file ? `/uploads/attendance/${req.file.filename}` : null;
        const devInfo = devicePayload(req);

        const workDate = todayLocalDate();
        const rec = getOrCreateDay(subjectId, workDate);
        const nowIso = new Date().toISOString();
        const src = source === "kiosk" ? "kiosk" : "device";

        if (type === "in") {
          if (rec.punch_in_at) {
            return res.status(400).json({ error: "Already punched in" });
          }
          db.prepare(
            `UPDATE attendance_records
             SET punch_in_at = ?, in_lat = ?, in_lng = ?, punch_in_address = ?, punch_in_photo = ?, in_device_info = ?,
                 source = ?, status = ?, last_edited_by = ?
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
            rec.id
          );
        } else {
          if (!rec.punch_in_at) {
            return res.status(400).json({ error: "Punch in required first" });
          }
          if (rec.punch_out_at) {
            return res.status(400).json({ error: "Already punched out" });
          }
          db.prepare(
            `UPDATE attendance_records
             SET punch_out_at = ?, out_lat = ?, out_lng = ?, punch_out_address = ?, punch_out_photo = ?, out_device_info = ?, last_edited_by = ?
             WHERE id = ?`
          ).run(
            nowIso,
            lat,
            lng,
            address,
            photoPath,
            devInfo,
            actor.id,
            rec.id
          );
        }

        const fresh = db.prepare("SELECT * FROM attendance_records WHERE id = ?").get(rec.id);
        insertAudit(actor.id, type === "in" ? "punch_in" : "punch_out", "attendance", rec.id, {
          work_date: workDate,
        });
        scheduleAttendanceSync(db, rec.id);
        appsScriptScheduleAttendance(db, rec.id);
        res.json({ record: fresh, geo, address });
      } catch (e) {
        next(e);
      }
    }
  );

  router.post(
    "/attendance/kiosk-face",
    attachUser,
    upload.single("photo"),
    (req, res) => {
      if (!can(req.currentUser, "attendance:kiosk")) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "Live photo (selfie) file required" });
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
    const subject = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(userId));
    if (!subject) return res.status(404).json({ error: "User not found" });

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
      if (branchId) {
        sql += " AND u.branch_id = ?";
        params.push(Number(branchId));
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
        sql += " AND ar.user_id = ?";
        params.push(Number(userId));
      }
      if (branchId) {
        sql += " AND u.branch_id = ?";
        params.push(Number(branchId));
      }
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
          sql += " AND ar.user_id = ?";
          params.push(Number(userId));
        }
        if (branchId) {
          sql += " AND u.branch_id = ?";
          params.push(Number(branchId));
        }
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
          `/portal/#settings?google=error&reason=${encodeURIComponent(String(oauthErr))}`
        );
      }
      if (!code || !state) {
        return res.redirect("/portal/#settings?google=error&reason=missing_params");
      }
      if (state !== req.session.googleOAuthState) {
        return res.redirect("/portal/#settings?google=error&reason=invalid_state");
      }
      delete req.session.googleOAuthState;
      await exchangeCodeAndSave(db, String(code));
      res.redirect("/portal/#settings?google=connected");
    } catch (e) {
      console.error("[google oauth callback]", e);
      res.redirect(
        `/portal/#settings?google=error&reason=${encodeURIComponent(e.message || "oauth_failed")}`
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
    if (branchId) {
      sql += " AND u.branch_id = ?";
      params.push(Number(branchId));
    }
    sql += " GROUP BY u.branch_id, b.name, ar.status ORDER BY b.name, ar.status";
    const rows = db.prepare(sql).all(...params);
    res.json({ scope: "org", from: fromDate, to: toDate, rows });
  });

  router.get("/branches", attachUser, (req, res) => {
    if (!can(req.currentUser, "branches:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ branches: db.prepare("SELECT * FROM branches ORDER BY name").all() });
  });

  router.post("/branches", attachUser, requirePerm("branches:write"), (req, res) => {
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
    const users = db
      .prepare(
        `SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active, created_at
         FROM users ORDER BY full_name`
      )
      .all();
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
    } = req.body || {};
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: "email, password, full_name, role required" });
    }
    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (role === ROLES.SUPER_ADMIN && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can create another Super Admin" });
    }
    const hash = bcrypt.hashSync(String(password), 10);
    try {
      const info = db
        .prepare(
          `INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, shift_start, shift_end, grace_minutes)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        .run(
          String(email).trim(),
          login_id ? String(login_id).trim() : null,
          hash,
          String(full_name).trim(),
          role,
          branch_id ? Number(branch_id) : null,
          shift_start || "09:00",
          shift_end || "18:00",
          Number(grace_minutes) || 15
        );
      const u = db
        .prepare(
          "SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active FROM users WHERE id = ?"
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

  router.patch("/users/:id", attachUser, requirePerm("users:update"), (req, res) => {
    const id = Number(req.params.id);
    const target = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!target) return res.status(404).json({ error: "Not found" });
    if (target.role === ROLES.SUPER_ADMIN && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const {
      full_name,
      branch_id,
      shift_start,
      shift_end,
      grace_minutes,
      active,
      role,
    } = req.body || {};
    if (role && role !== target.role && req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin may change roles" });
    }
    const branchVal = branch_id === undefined ? null : branch_id;
    const activeVal = active === undefined ? null : active ? 1 : 0;
    db.prepare(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        branch_id = CASE WHEN ? IS NULL THEN branch_id ELSE ? END,
        shift_start = COALESCE(?, shift_start),
        shift_end = COALESCE(?, shift_end),
        grace_minutes = COALESCE(?, grace_minutes),
        active = CASE WHEN ? IS NULL THEN active ELSE ? END,
        role = COALESCE(?, role)
       WHERE id = ?`
    ).run(
      full_name || null,
      branchVal,
      branchVal,
      shift_start || null,
      shift_end || null,
      grace_minutes === undefined ? null : grace_minutes,
      activeVal,
      activeVal,
      role || null,
      id
    );
    const u = db
      .prepare(
        "SELECT id, email, login_id, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active FROM users WHERE id = ?"
      )
      .get(id);
    insertAudit(req.currentUser.id, "user_update", "user", id, {});
    scheduleUserSync(db, id);
    appsScriptScheduleUser(db, id);
    res.json({ user: u });
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
        `SELECT n.*, u.full_name AS author_name
         FROM notices n
         JOIN users u ON u.id = n.created_by
         WHERE n.active = 1
         ORDER BY n.created_at DESC
         LIMIT 50`
      )
      .all();
    res.json({ notices: rows });
  });

  router.post("/notices", attachUser, requirePerm("notices:write"), (req, res) => {
    const { title, body } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title and body required" });
    const info = db
      .prepare("INSERT INTO notices (title, body, created_by) VALUES (?,?,?)")
      .run(String(title), String(body), req.currentUser.id);
    const n = db.prepare("SELECT * FROM notices WHERE id = ?").get(info.lastInsertRowid);
    appsScriptScheduleNotice(db, info.lastInsertRowid);
    res.json({ notice: n });
  });

  router.get("/settings", attachUser, (req, res) => {
    if (!can(req.currentUser, "settings:read")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({
      app_name: "Prakriti HRMS",
      session_ttl_days: 7,
      features: {
        kiosk: true,
        geo_fence: true,
        face_recognition: false,
      },
    });
  });

  router.patch("/settings", attachUser, requirePerm("settings:write"), (req, res) => {
    res.json({ ok: true, message: "Persist settings in DB or env for production." });
  });

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

  router.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  });

  return router;
}

module.exports = { createApiRouter };
