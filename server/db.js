const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const { ROLES } = require("./rbac");

/** Persisted so restarts work without Replit Secrets (zero-config). */
const HRMS_BOOTSTRAP_PW_KEY = "hrms_bootstrap_admin_password";

if (!String(process.env.DATABASE_URL || "").trim() && !String(process.env.DB_PATH || "").trim()) {
  process.env.DATABASE_URL = "file:./data/hrms.sqlite";
}

function readStoredBootstrapPassword(db) {
  try {
    const row = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get(HRMS_BOOTSTRAP_PW_KEY);
    if (!row || !row.v) return "";
    const o = JSON.parse(row.v);
    return String(o.password || "").trim();
  } catch {
    return "";
  }
}

function writeStoredBootstrapPassword(db, password) {
  db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
    HRMS_BOOTSTRAP_PW_KEY,
    JSON.stringify({ password, updated_at: new Date().toISOString() })
  );
}

const HRMS_KV_SESSION_SECRET = "hrms_runtime_session_secret";
const HRMS_KV_JWT_SECRET = "hrms_runtime_jwt_secret";

function readKvSecret(db, key) {
  try {
    const row = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get(key);
    if (!row || !row.v) return "";
    const o = JSON.parse(row.v);
    return String(o.secret || "").trim();
  } catch {
    return "";
  }
}

function writeKvSecret(db, key, secret) {
  db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
    key,
    JSON.stringify({ secret, updated_at: new Date().toISOString() })
  );
}

/**
 * Stable sessions/JWT across restarts without env vars: prefer env, else integration_kv, else generate + persist.
 * Call only after openDb() (integration_kv must exist). Does not log secret values.
 */
function hydrateRuntimeSecrets(db) {
  const prod = process.env.NODE_ENV === "production";

  function hydrateOne(envName, kvKey, byteLength, label) {
    const fromEnv = String(process.env[envName] || "").trim();
    if (fromEnv) {
      process.env[envName] = fromEnv;
      return;
    }
    const fromDb = readKvSecret(db, kvKey);
    if (fromDb) {
      process.env[envName] = fromDb;
      return;
    }
    const generated = crypto.randomBytes(byteLength).toString("hex");
    writeKvSecret(db, kvKey, generated);
    process.env[envName] = generated;
    if (prod) {
      console.warn(
        `[hrms] ${label}: ${envName} was missing — generated once and stored in the database for stable ${label} across restarts.`
      );
    }
  }

  hydrateOne("SESSION_SECRET", HRMS_KV_SESSION_SECRET, 32, "sessions");
  hydrateOne("JWT_SECRET", HRMS_KV_JWT_SECRET, 48, "JWT");
}

function resolveSqliteFilePath() {
  const raw = (process.env.DATABASE_URL || process.env.DB_PATH || "").trim();
  let resolved;
  if (!raw) {
    const dataDir = path.join(__dirname, "..", "data");
    resolved = path.join(dataDir, "hrms.sqlite");
  } else if (raw.startsWith("file:")) {
    const afterScheme = raw.slice("file:".length);
    // Node's `new URL("file:./data/x.sqlite")` becomes `/data/x.sqlite` (disk root) — wrong.
    const isRelativeFilePath =
      afterScheme.startsWith("./") ||
      afterScheme.startsWith("../") ||
      afterScheme.startsWith(".\\") ||
      afterScheme.startsWith("..\\");
    if (isRelativeFilePath) {
      resolved = path.resolve(process.cwd(), afterScheme);
    } else {
      try {
        const parsed = new URL(raw);
        let p = parsed.pathname;
        if (process.platform === "win32" && /^\/[A-Za-z]:/.test(p)) {
          p = p.slice(1);
        }
        resolved = decodeURIComponent(p);
      } catch {
        resolved = raw.replace(/^file:\/+/, "").replace(/^\//, "");
      }
    }
  } else {
    resolved = raw;
  }
  if (!path.isAbsolute(resolved)) {
    resolved = path.resolve(process.cwd(), resolved);
  }
  return resolved;
}

const dbPath = resolveSqliteFilePath();

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function namedToPositional(sql, obj) {
  const re = /@(\w+)/g;
  let m;
  const order = [];
  const seen = new Set();
  while ((m = re.exec(sql))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      order.push(m[1]);
    }
  }
  if (order.length === 0) {
    return { sql, values: [] };
  }
  let out = sql;
  order.forEach((k) => {
    out = out.replace(new RegExp(`@${k}\\b`, "g"), "?");
  });
  const values = order.map((k) => {
    if (!(k in obj)) throw new Error(`Missing SQL bind @${k}`);
    return obj[k];
  });
  return { sql: out, values };
}

function normalizeSqlArgs(sql, args) {
  if (
    args.length === 1 &&
    isPlainObject(args[0]) &&
    sql.includes("@")
  ) {
    return namedToPositional(sql, args[0]);
  }
  return { sql, values: args };
}

function wrapDatabase(raw) {
  return {
    exec(sql) {
      raw.exec(sql);
    },
    prepare(sql) {
      return {
        run(...args) {
          const { sql: s2, values } = normalizeSqlArgs(sql, args);
          return raw.prepare(s2).run(...values);
        },
        get(...args) {
          const { sql: s2, values } = normalizeSqlArgs(sql, args);
          return raw.prepare(s2).get(...values);
        },
        all(...args) {
          const { sql: s2, values } = normalizeSqlArgs(sql, args);
          return raw.prepare(s2).all(...values);
        },
      };
    },
  };
}

function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === col);
}

function tryAddColumn(db, table, def) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  } catch {
    /* exists */
  }
}

function migrate(db) {
  if (!hasColumn(db, "users", "login_id")) {
    tryAddColumn(db, "users", "login_id TEXT");
    try {
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_id ON users(login_id) WHERE login_id IS NOT NULL"
      );
    } catch {
      /* ignore */
    }
  }
  tryAddColumn(db, "users", "mobile TEXT");
  tryAddColumn(db, "users", "department TEXT");
  tryAddColumn(db, "users", "allow_gps INTEGER NOT NULL DEFAULT 1");
  tryAddColumn(db, "users", "allow_face INTEGER NOT NULL DEFAULT 0");
  tryAddColumn(db, "users", "allow_manual INTEGER NOT NULL DEFAULT 1");
  tryAddColumn(db, "users", "allow_biometric INTEGER NOT NULL DEFAULT 0");
  tryAddColumn(db, "users", "profile_photo TEXT");
  tryAddColumn(db, "users", "dob TEXT");
  tryAddColumn(db, "users", "address TEXT");
  tryAddColumn(db, "users", "account_number TEXT");
  tryAddColumn(db, "users", "ifsc TEXT");
  tryAddColumn(db, "users", "bank_name TEXT");
  tryAddColumn(db, "users", "deleted_at TEXT");

  tryAddColumn(db, "branches", "address TEXT");
  tryAddColumn(db, "branches", "city TEXT");
  tryAddColumn(db, "branches", "state TEXT");
  tryAddColumn(db, "branches", "wifi_enabled INTEGER NOT NULL DEFAULT 0");
  tryAddColumn(db, "branches", "wifi_ssids TEXT");
  tryAddColumn(db, "users", "kiosk_pin_hash TEXT");

  const attCols = [
    ["punch_in_address", "TEXT"],
    ["punch_out_address", "TEXT"],
    ["in_device_info", "TEXT"],
    ["out_device_info", "TEXT"],
    ["punch_in_photo", "TEXT"],
    ["punch_out_photo", "TEXT"],
  ];
  for (const [c] of attCols) {
    if (!hasColumn(db, "attendance_records", c)) {
      tryAddColumn(db, "attendance_records", `${c} TEXT`);
    }
  }

  const attMethodCols = [
    ["punch_method_in", "TEXT"],
    ["punch_method_out", "TEXT"],
    ["device_in", "TEXT"],
    ["device_out", "TEXT"],
    ["verification_in", "TEXT"],
    ["verification_out", "TEXT"],
  ];
  for (const [c, t] of attMethodCols) {
    if (!hasColumn(db, "attendance_records", c)) {
      tryAddColumn(db, "attendance_records", `${c} ${t}`);
    }
  }

  tryAddColumn(db, "notices", "visible_from TEXT");
  tryAddColumn(db, "notices", "visible_until TEXT");
  tryAddColumn(db, "notices", "repeat_rule TEXT");
  tryAddColumn(db, "notices", "show_on_punch INTEGER NOT NULL DEFAULT 1");

  tryAddColumn(db, "employee_documents", "account_number TEXT");
  tryAddColumn(db, "employee_documents", "ifsc TEXT");
  tryAddColumn(db, "employee_documents", "bank_name TEXT");
  tryAddColumn(db, "employee_documents", "doc_status TEXT NOT NULL DEFAULT 'pending'");
  db.exec(`
    UPDATE employee_documents
    SET doc_status = CASE
      WHEN verified = 1 THEN 'approved'
      WHEN verified = 0 THEN COALESCE(doc_status, 'pending')
      ELSE 'pending'
    END
    WHERE doc_status IS NULL OR doc_status = '';
  `);
  tryAddColumn(db, "user_face_profiles", "embedding_json TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      final_status TEXT NOT NULL DEFAULT 'PENDING',
      manager_review TEXT,
      admin_review TEXT,
      manager_comment TEXT,
      admin_comment TEXT,
      manager_action_at TEXT,
      admin_action_at TEXT,
      manager_action_by INTEGER,
      admin_action_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (manager_action_by) REFERENCES users(id),
      FOREIGN KEY (admin_action_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(final_status);

    CREATE TABLE IF NOT EXISTS leave_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      leave_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (leave_id) REFERENCES leave_requests(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_leave_threads_leave ON leave_threads(leave_id, id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      doc_status TEXT NOT NULL DEFAULT 'pending',
      verified_by INTEGER,
      verified_at TEXT,
      verifier_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (verified_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_employee_documents_user ON employee_documents(user_id);

    CREATE TABLE IF NOT EXISTS payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      gross_inr REAL NOT NULL DEFAULT 0,
      deductions_inr REAL NOT NULL DEFAULT 0,
      net_inr REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, period),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_entries_period ON payroll_entries(period);

    CREATE TABLE IF NOT EXISTS system_guides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by INTEGER NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notice_reads (
      notice_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (notice_id, user_id),
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_notice_reads_user ON notice_reads(user_id);

    CREATE TABLE IF NOT EXISTS user_face_profiles (
      user_id INTEGER PRIMARY KEY,
      phash TEXT NOT NULL,
      reference_path TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notice_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_notice_replies_notice ON notice_replies(notice_id);

    CREATE TABLE IF NOT EXISTS hr_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_user_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_by_other INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (thread_user_id) REFERENCES users(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_chat_thread ON hr_chat_messages(thread_user_id);

    CREATE TABLE IF NOT EXISTS hr_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      message TEXT NOT NULL,
      user_id INTEGER,
      actor_id INTEGER,
      meta TEXT,
      read_by_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_alerts_created ON hr_alerts(created_at);

    CREATE TABLE IF NOT EXISTS login_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS password_reset_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      otp_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pwreset_otp_user ON password_reset_otps(user_id);
  `);
  db.exec(`
    DELETE FROM branches
    WHERE lower(name) IN ('head office', 'dera bassi')
      AND id NOT IN (SELECT DISTINCT COALESCE(branch_id, -1) FROM users WHERE deleted_at IS NULL);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS custom_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      permissions_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS user_role_assignments (
      user_id INTEGER PRIMARY KEY,
      custom_role_id INTEGER NOT NULL,
      assigned_by INTEGER,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (custom_role_id) REFERENCES custom_roles(id),
      FOREIGN KEY (assigned_by) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key_b64 TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS biometric_update_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      requester_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      reject_reason TEXT,
      resolved_at TEXT,
      resolved_by_id INTEGER,
      approval_expires_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (resolved_by_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bio_req_user_kind_status ON biometric_update_requests(user_id, kind, status);
    CREATE INDEX IF NOT EXISTS idx_bio_req_status_created ON biometric_update_requests(status, created_at);
  `);

  tryAddColumn(db, "users", "base_salary_inr REAL NOT NULL DEFAULT 12000");
  tryAddColumn(db, "users", "joining_date TEXT");
  tryAddColumn(db, "users", "payroll_job_role TEXT NOT NULL DEFAULT 'delivery'");

  const payrollEntryCols = [
    ["delivery_amount", "REAL NOT NULL DEFAULT 0"],
    ["total_leaves", "REAL NOT NULL DEFAULT 0"],
    ["leave_type", "TEXT NOT NULL DEFAULT 'paid'"],
    ["late_minutes", "INTEGER NOT NULL DEFAULT 0"],
    ["incentive_inr", "REAL NOT NULL DEFAULT 0"],
    ["leave_deduction_inr", "REAL NOT NULL DEFAULT 0"],
    ["late_deduction_inr", "REAL NOT NULL DEFAULT 0"],
    ["no_leave_bonus_inr", "REAL NOT NULL DEFAULT 0"],
    ["base_salary_snapshot", "REAL"],
  ];
  for (const [c, t] of payrollEntryCols) {
    if (!hasColumn(db, "payroll_entries", c)) {
      tryAddColumn(db, "payroll_entries", `${c} ${t}`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_delivery_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      amount_inr REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, work_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_delivery_user_date ON payroll_delivery_daily(user_id, work_date);
  `);

  const namedBranches = ["Amritsar", "Jaipur", "Derabassi"];
  for (const nm of namedBranches) {
    const ex = db.prepare("SELECT id FROM branches WHERE name = ?").get(nm);
    if (!ex) {
      db.prepare(
        "INSERT INTO branches (name, lat, lng, radius_meters) VALUES (?,?,?,400)"
      ).run(nm, null, null);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS apps_script_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      tab TEXT,
      ok INTEGER NOT NULL DEFAULT 0,
      response_snippet TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_apps_script_log_created ON apps_script_sync_log(created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      company TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      notes TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_crm_leads_created ON crm_leads(created_at);
  `);
}

function openDb() {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode = WAL;");
  const db = wrapDatabase(raw);

  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      lat REAL,
      lng REAL,
      radius_meters INTEGER NOT NULL DEFAULT 300,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      branch_id INTEGER,
      shift_start TEXT NOT NULL DEFAULT '09:00',
      shift_end TEXT NOT NULL DEFAULT '18:00',
      grace_minutes INTEGER NOT NULL DEFAULT 15,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      punch_in_at TEXT,
      punch_out_at TEXT,
      status TEXT NOT NULL DEFAULT 'absent',
      half_period TEXT,
      source TEXT NOT NULL DEFAULT 'device',
      in_lat REAL,
      in_lng REAL,
      out_lat REAL,
      out_lng REAL,
      notes TEXT,
      last_edited_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, work_date),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (last_edited_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance_records(user_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_users_branch ON users(branch_id);
  `);

  migrate(db);

  const userCount = Number(db.prepare("SELECT COUNT(*) AS c FROM users").get().c);
  const wasEmpty = userCount === 0;
  let firstBootInfo = null;
  if (wasEmpty) {
    firstBootInfo = seedInitialOrg(db);
  }

  ensureBootstrapData(db);
  ensurePrakritiSuperAdmin(db);

  if (firstBootInfo) {
    const absDb = path.resolve(dbPath);
    console.warn("[hrms] ========== FIRST BOOT ==========");
    console.warn("[hrms] Database file:", absDb);
    console.warn("[hrms] Super admin email:", firstBootInfo.email);
    if (firstBootInfo.autoGenerated) {
      console.warn("[hrms] Super admin password (auto-generated):", firstBootInfo.adminPassword);
      console.warn(
        "[hrms] Save this password securely — it will not be shown again in logs. It remains stored in the database for login."
      );
    } else {
      console.warn(
        "[hrms] Super admin password was set from SEED_ADMIN_PASSWORD (not logged). Change it after first login if needed."
      );
    }
    console.warn("[hrms] ================================");
  }

  return db;
}

function normalizeEmailFromName(name) {
  return `${String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")}.${Date.now()}@prakriti.local`;
}

function ensureBootstrapData(db) {
  const branchByName = new Map();
  const rows = db.prepare("SELECT id, name FROM branches").all();
  rows.forEach((r) => branchByName.set(String(r.name).toLowerCase(), r.id));

  const requiredBranches = [
    { name: "Jaipur", lat: 26.99334, lng: 75.73716, radius_meters: 400 },
    { name: "Amritsar", lat: 31.66749, lng: 74.87296, radius_meters: 400 },
    { name: "Meerut", lat: 28.96237, lng: 77.69552, radius_meters: 400 },
  ];
  const requiredDepartments = [
    "Sales Executive",
    "Courier Department",
    "IT",
    "Sales Employee",
    "Courier",
    "Sales",
    "Support",
    "Packing",
  ];
  for (const b of requiredBranches) {
    const key = b.name.toLowerCase();
    if (!branchByName.has(key)) {
      const info = db
        .prepare("INSERT INTO branches (name, lat, lng, radius_meters) VALUES (?,?,?,?)")
        .run(b.name, b.lat, b.lng, b.radius_meters);
      branchByName.set(key, info.lastInsertRowid);
    } else {
      db.prepare("UPDATE branches SET lat = ?, lng = ?, radius_meters = ? WHERE id = ?").run(
        b.lat,
        b.lng,
        b.radius_meters,
        branchByName.get(key)
      );
    }
  }
  for (const dep of requiredDepartments) {
    db.prepare("INSERT OR IGNORE INTO departments (name, active) VALUES (?, 1)").run(dep);
  }

  const amritsarId = branchByName.get("amritsar") || null;
  const jaipurId = branchByName.get("jaipur") || null;
  const meerutId = branchByName.get("meerut") || null;
  const defaultBranchId = amritsarId || jaipurId || meerutId || null;
  const demoPlain =
    String(process.env.SEED_DEMO_PASSWORD || "").trim() ||
    String(process.env.SEED_ADMIN_PASSWORD || "").trim() ||
    readStoredBootstrapPassword(db);
  const defaultHash = demoPlain ? bcrypt.hashSync(demoPlain, 10) : null;

  const preloadEmployees = [
    { name: "Simran kaur", login_id: "PH-AMR-102", role: ROLES.LOCATION_MANAGER, branch_id: amritsarId },
    { name: "Manpreet kaur", login_id: "PH-AMR-103", role: ROLES.USER, branch_id: amritsarId },
    { name: "ANIL", login_id: "PH-AMR-105", role: ROLES.USER, branch_id: amritsarId },
    { name: "VARSHA TAILOR" },
    { name: "SHEETAL KUMARI" },
    { name: "RAVI PHOGAT" },
    { name: "SONU" },
    { name: "SANJU GARHWAL" },
    { name: "SHANU MEENA" },
    { name: "Shivani Sachdeva" },
    { name: "Harpreet kaur" },
    { name: "Simranjit kaur" },
    { name: "Simarjit kaur" },
    { name: "Rajwinder kaur" },
    { name: "PALAK LAKHERA" },
    { name: "KANCHAN PRAJAPAT" },
    { name: "Monu" },
    { name: "Jeevan sharma" },
    { name: "Parul" },
    { name: "Gaurav" },
    { name: "Ankit" },
    { name: "Jasdeep Singh" },
    { name: "Rakesh kumar" },
    { name: "Karanvir Singh" },
    { name: "POOJA VERMA" },
    { name: "GALAXY PRAJAPAT" },
    { name: "Rajneet kaur" },
    { name: "KHUSHBOO PAREEK" },
    { name: "Karanveer old" },
    { name: "Maninder Singh" },
    { name: "Mukesh" },
    { name: "Muskan" },
    { name: "Roshni" },
    { name: "BHUMIKA KANWAR" },
    { name: "VRASHA RAJPUT" },
    { name: "Rupali" },
    { name: "Anjali sonwal" },
    { name: "VISHAL SHARMA" },
    { name: "ALOK KUMAR" },
    { name: "SURAJ KUMAR" },
    { name: "SHAIKH NOOR" },
    { name: "Naveen Kumar" },
    { name: "TANNU" },
    { name: "HIMANSHU" },
    { name: "Deepak Maheswari" },
  ];

  for (const e of preloadEmployees) {
    const existing =
      (e.login_id && db.prepare("SELECT id FROM users WHERE login_id = ?").get(e.login_id)) ||
      db
        .prepare("SELECT id FROM users WHERE lower(full_name) = lower(?) AND deleted_at IS NULL")
        .get(e.name);
    if (existing) continue;
    if (!defaultHash) continue;
    db.prepare(
      `INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, shift_start, shift_end, grace_minutes, active)
       VALUES (?,?,?,?,?,?, '09:00', '18:00', 15, 1)`
    ).run(
      normalizeEmailFromName(e.name),
      e.login_id || null,
      defaultHash,
      e.name,
      e.role || ROLES.USER,
      e.branch_id || defaultBranchId
    );
  }

  const companyKey = "company_profile";
  const row = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get(companyKey);
  if (!row || !row.v) {
    db.prepare("INSERT OR REPLACE INTO integration_kv (k, v) VALUES (?, ?)").run(
      companyKey,
      JSON.stringify({
        company_name: "Prakriti Herbs Private Limited",
        legal_name: "PRAKRITI HERBS PRIVATE LIMITED",
        address: "Amer, Jaipur, Rajasthan - 302012",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302012",
        gstin: "08AAQCP4095D1Z2",
        cin: "U46497RJ2025PTC109202",
        director: "Mandeep Kumar",
        authorized_signatory: "Mandeep Kumar",
        email: "contact@prakritiherbs.in",
        legal_address:
          "Building No. 30 & 31, South Part, Bilochi Nagar A, Amer, Jaipur, Rajasthan - 302012",
      })
    );
  }
}

function seedInitialOrg(db) {
  let adminPw = String(process.env.SEED_ADMIN_PASSWORD || "").trim();
  let autoGenerated = false;
  if (!adminPw) {
    adminPw = readStoredBootstrapPassword(db);
  }
  if (!adminPw) {
    adminPw = crypto.randomBytes(24).toString("base64url");
    autoGenerated = true;
  }
  const demoPw =
    String(process.env.SEED_DEMO_PASSWORD || "").trim() || adminPw;

  const superEmail =
    String(process.env.SUPER_ADMIN_EMAIL || "").trim() || "superadmin@hrms.local";

  const insertBranch = db.prepare(
    "INSERT INTO branches (name, lat, lng, radius_meters) VALUES (@name, @lat, @lng, @radius_meters)"
  );
  const info = insertBranch.run({
    name: "Head Office",
    lat: 28.6139,
    lng: 77.209,
    radius_meters: 500,
  });
  const branchId = info.lastInsertRowid;

  const insertUser = db.prepare(`
    INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, shift_start, shift_end, grace_minutes)
    VALUES (@email, @login_id, @hash, @name, @role, @branch_id, '09:00', '18:00', 15)
  `);

  const mandeepHash = bcrypt.hashSync(adminPw, 10);
  insertUser.run({
    email: superEmail,
    login_id: "prakritiherbs",
    hash: mandeepHash,
    name: "Mandeep Kumar",
    role: ROLES.SUPER_ADMIN,
    branch_id: branchId,
  });

  const h = bcrypt.hashSync(demoPw, 10);
  insertUser.run({
    email: "attendance.manager@prakriti.local",
    login_id: null,
    hash: h,
    name: "Attendance Manager",
    role: ROLES.ATTENDANCE_MANAGER,
    branch_id: branchId,
  });
  insertUser.run({
    email: "location.manager@prakriti.local",
    login_id: null,
    hash: h,
    name: "Location Manager",
    role: ROLES.LOCATION_MANAGER,
    branch_id: branchId,
  });
  insertUser.run({
    email: "user@prakriti.local",
    login_id: null,
    hash: h,
    name: "Sample Staff",
    role: ROLES.USER,
    branch_id: branchId,
  });

  const adminRow = db.prepare("SELECT id FROM users WHERE login_id = ?").get("prakritiherbs");
  const adminId = adminRow ? adminRow.id : 1;
  db.prepare(
    "INSERT INTO notices (title, body, created_by, active) VALUES (@t, @b, @uid, 1)"
  ).run({
    t: "Welcome to HRMS",
    b: "Punch with GPS and optional live photo; leave requests route Manager then Super Admin.",
    uid: adminId,
  });

  writeStoredBootstrapPassword(db, adminPw);

  return {
    email: superEmail,
    adminPassword: adminPw,
    autoGenerated,
  };
}

function ensurePrakritiSuperAdmin(db) {
  const branchRow = db.prepare("SELECT id FROM branches ORDER BY id LIMIT 1").get();
  if (!branchRow) return;
  const branchId = branchRow.id;
  const envAdmin = String(process.env.SEED_ADMIN_PASSWORD || "").trim();
  const hash = envAdmin ? bcrypt.hashSync(envAdmin, 10) : null;
  const superEmail =
    String(process.env.SUPER_ADMIN_EMAIL || "").trim() || "superadmin@hrms.local";
  const byLogin = db.prepare("SELECT id FROM users WHERE login_id = ?").get("prakritiherbs");
  if (byLogin) {
    if (hash) {
      db.prepare(
        `UPDATE users SET
        full_name = @name,
        role = @role,
        password_hash = @hash,
        login_id = @lid,
        email = @em
       WHERE id = @id`
      ).run({
        name: "Mandeep Kumar",
        role: ROLES.SUPER_ADMIN,
        hash,
        lid: "prakritiherbs",
        em: superEmail,
        id: byLogin.id,
      });
    } else {
      db.prepare(
        `UPDATE users SET
        full_name = @name,
        role = @role,
        login_id = @lid,
        email = @em
       WHERE id = @id`
      ).run({
        name: "Mandeep Kumar",
        role: ROLES.SUPER_ADMIN,
        lid: "prakritiherbs",
        em: superEmail,
        id: byLogin.id,
      });
    }
    return;
  }
  const firstSuper = db
    .prepare("SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1")
    .get(ROLES.SUPER_ADMIN);
  if (firstSuper) {
    if (hash) {
      db.prepare(
        `UPDATE users SET
        full_name = @name,
        login_id = @lid,
        email = @em,
        password_hash = @hash,
        role = @role
       WHERE id = @id`
      ).run({
        name: "Mandeep Kumar",
        lid: "prakritiherbs",
        em: superEmail,
        hash,
        role: ROLES.SUPER_ADMIN,
        id: firstSuper.id,
      });
    } else {
      db.prepare(
        `UPDATE users SET
        full_name = @name,
        login_id = @lid,
        email = @em,
        role = @role
       WHERE id = @id`
      ).run({
        name: "Mandeep Kumar",
        lid: "prakritiherbs",
        em: superEmail,
        role: ROLES.SUPER_ADMIN,
        id: firstSuper.id,
      });
    }
    return;
  }
  let insertPw = envAdmin || readStoredBootstrapPassword(db);
  if (!insertPw) {
    insertPw = crypto.randomBytes(24).toString("base64url");
    writeStoredBootstrapPassword(db, insertPw);
    console.warn(
      "[hrms] ensurePrakritiSuperAdmin: created fallback super-admin password (no env / stored seed)."
    );
  }
  const insertHash = bcrypt.hashSync(insertPw, 10);
  db.prepare(
    `INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, shift_start, shift_end, grace_minutes)
     VALUES (@email, @lid, @hash, @name, @role, @bid, '09:00', '18:00', 15)`
  ).run({
    email: superEmail,
    lid: "prakritiherbs",
    hash: insertHash,
    name: "Mandeep Kumar",
    role: ROLES.SUPER_ADMIN,
    bid: branchId,
  });
}

module.exports = { openDb, dbPath, hydrateRuntimeSecrets };
