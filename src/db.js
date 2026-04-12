const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const { ROLES } = require("./rbac");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = process.env.DB_PATH || path.join(dataDir, "hrms.sqlite");

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

  db.exec(`
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
  `);

  const namedBranches = ["Jaipur", "Amritsar", "CA OFFICE MEERUT"];
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
  if (userCount === 0) {
    seedInitialOrg(db);
  }

  ensurePrakritiSuperAdmin(db);

  return db;
}

function seedInitialOrg(db) {
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

  const demoPw =
    process.env.SEED_DEMO_PASSWORD || process.env.SEED_ADMIN_PASSWORD || "ChangeMe!123";

  const insertUser = db.prepare(`
    INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, shift_start, shift_end, grace_minutes)
    VALUES (@email, @login_id, @hash, @name, @role, @branch_id, '09:00', '18:00', 15)
  `);

  const mandeepHash = bcrypt.hashSync(
    process.env.SEED_ADMIN_PASSWORD || "Prakriti@123",
    10
  );
  insertUser.run({
    email: "mandeep@prakriti.local",
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
}

function ensurePrakritiSuperAdmin(db) {
  const branchRow = db.prepare("SELECT id FROM branches ORDER BY id LIMIT 1").get();
  if (!branchRow) return;
  const branchId = branchRow.id;
  const hash = bcrypt.hashSync(
    process.env.SEED_ADMIN_PASSWORD || "Prakriti@123",
    10
  );
  const byLogin = db.prepare("SELECT id FROM users WHERE login_id = ?").get("prakritiherbs");
  if (byLogin) {
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
      em: "mandeep@prakriti.local",
      id: byLogin.id,
    });
    return;
  }
  const firstSuper = db
    .prepare("SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1")
    .get(ROLES.SUPER_ADMIN);
  if (firstSuper) {
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
      em: "mandeep@prakriti.local",
      hash,
      role: ROLES.SUPER_ADMIN,
      id: firstSuper.id,
    });
    return;
  }
  db.prepare(
    `INSERT INTO users (email, login_id, password_hash, full_name, role, branch_id, shift_start, shift_end, grace_minutes)
     VALUES (@email, @lid, @hash, @name, @role, @bid, '09:00', '18:00', 15)`
  ).run({
    email: "mandeep@prakriti.local",
    lid: "prakritiherbs",
    hash,
    name: "Mandeep Kumar",
    role: ROLES.SUPER_ADMIN,
    bid: branchId,
  });
}

module.exports = { openDb, dbPath };
