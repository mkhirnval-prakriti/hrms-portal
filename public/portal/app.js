/* global fetch, document, window, location, FormData */

const appEl = document.getElementById("app");

let me = null;

async function api(path, options = {}) {
  const isForm =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = isForm
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };
  const res = await fetch("/api" + path, {
    credentials: "include",
    headers,
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function can(key) {
  return me && me.permissions && me.permissions[key];
}

function navLink(route, label, perms) {
  const arr = !perms ? [] : Array.isArray(perms) ? perms : [perms];
  const active = currentRoute() === route ? "active" : "";
  const dis = arr.length && !arr.some((p) => can(p)) ? "disabled" : "";
  return `<a class="${active} ${dis}" href="#/${route}">${label}</a>`;
}

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, "") || "dashboard";
  return h.split("?")[0];
}

function layoutShell(title, inner) {
  const kiosk = currentRoute().startsWith("attendance/kiosk");
  if (kiosk) {
    return `<div class="kiosk">${inner}</div>`;
  }
  return `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">Prakriti HRMS</div>
        <div class="nav-section">Main</div>
        <nav class="nav">
          ${navLink("dashboard", "Dashboard", ["dashboard:read", "dashboard:read_self"])}
        </nav>
        <div class="nav-section">Attendance</div>
        <nav class="nav">
          ${navLink("attendance/punch", "Punch In / Out", "attendance:punch")}
          ${navLink("attendance/manual", "Manual Entry", "attendance:manual")}
          ${navLink("attendance/kiosk", "Kiosk Mode", "attendance:kiosk")}
        </nav>
        <div class="nav-section">Directory</div>
        <nav class="nav">
          ${navLink("users", "Users / Staff", "users:read")}
          ${navLink("branches", "Branches & GPS", "branches:read")}
          ${navLink("history", "Attendance History", ["history:read", "history:read_self"])}
          ${navLink("leave", "Leave requests", ["leave:read_all", "leave:read_self"])}
          ${navLink("notices", "Notice Board", "notices:read")}
          ${navLink("roles", "Roles & Permissions", "roles:read")}
          ${navLink("timings", "Timings / Shifts", "timings:read")}
          ${navLink("payroll", "Payroll", "settings:write")}
          ${navLink("settings", "Settings", "settings:read")}
        </nav>
        <div style="flex:1"></div>
        <button class="btn secondary" type="button" id="logoutBtn" style="width:100%">Sign out</button>
      </aside>
      <main>
        <div class="topbar">
          <div>
            <h1>${title}</h1>
            <div class="muted">${me ? `${me.full_name} · ${me.role}${me.login_id ? " · @" + me.login_id : ""}` : ""}</div>
          </div>
        </div>
        ${inner}
      </main>
    </div>`;
}

async function loadMe() {
  try {
    me = await api("/auth/me");
  } catch {
    me = null;
  }
}

async function render() {
  await loadMe();
  const route = currentRoute();

  if (!me && route !== "login") {
    location.hash = "#/login";
    return renderLogin();
  }
  if (me && route === "login") {
    location.hash = "#/dashboard";
    return render();
  }

  try {
    if (route === "login") return renderLogin();
    if (route === "dashboard") return await renderDashboard();
    if (route === "attendance/punch") return await renderPunch();
    if (route === "attendance/manual") return await renderManual();
    if (route === "attendance/kiosk") return await renderKiosk();
    if (route === "users") return await renderUsers();
    if (route === "branches") return await renderBranches();
    if (route === "history") return await renderHistory();
    if (route === "leave") return await renderLeave();
    if (route === "notices") return await renderNotices();
    if (route === "roles") return await renderRoles();
    if (route === "timings") return await renderTimings();
    if (route === "settings") return await renderSettings();
    if (route === "payroll") return await renderPayroll();
    appEl.innerHTML = layoutShell("Not found", `<p class="muted">Unknown route.</p>`);
  } catch (e) {
    appEl.innerHTML = layoutShell(
      "Error",
      `<p class="error">${e.message || "Unexpected error"}</p>`
    );
  }
  wireLogout();
}

function wireLogout() {
  const b = document.getElementById("logoutBtn");
  if (!b) return;
  b.onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    me = null;
    location.hash = "#/login";
    render();
  };
}

function renderLogin() {
  appEl.innerHTML = `
    <div class="login-wrap">
      <h1>HRMS Sign in</h1>
      <p class="muted">Multi-device sessions supported.</p>
      <form id="loginForm">
        <label class="muted">Email or user ID</label>
        <input name="email" type="text" required autocomplete="username" placeholder="e.g. prakritiherbs" />
        <label class="muted">Password</label>
        <input name="password" type="password" required autocomplete="current-password" />
        <p class="error" id="loginErr" style="min-height:1rem"></p>
        <button class="btn" type="submit">Continue</button>
      </form>
      <p class="muted" style="margin-top:1rem;font-size:0.82rem">
        Super Admin seed: <code>prakritiherbs</code> / <code>Prakriti@123</code> (override with
        <code>SEED_ADMIN_PASSWORD</code>)
      </p>
    </div>`;
  document.getElementById("loginForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = { email: fd.get("email"), password: fd.get("password") };
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify(body) });
      location.hash = "#/dashboard";
      render();
    } catch (err) {
      document.getElementById("loginErr").textContent = err.message;
    }
  };
}

async function renderDashboard() {
  if (!can("dashboard:read") && !can("dashboard:read_self")) {
    appEl.innerHTML = layoutShell("Dashboard", `<p class="error">No dashboard access.</p>`);
    return wireLogout();
  }
  const params = new URLSearchParams();
  const from = document.getElementById("dashFrom")?.value;
  const to = document.getElementById("dashTo")?.value;
  const branch = document.getElementById("dashBranch")?.value;
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (branch) params.set("branchId", branch);
  const q = params.toString() ? `?${params}` : "";
  const data = await api("/dashboard/summary" + q);

  let cards = "";
  if (data.scope === "self") {
    const map = Object.fromEntries((data.counts || []).map((c) => [c.status, c.c]));
    cards = ["present", "absent", "late", "half", "leave"]
      .map(
        (s) => `
      <div class="card">
        <h3>${s}</h3>
        <div class="stat">${map[s] || 0}</div>
      </div>`
      )
      .join("");
  } else {
    const rows = data.rows || [];
    const grouped = {};
    rows.forEach((r) => {
      const key = r.branch_name || "Unassigned";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    });
    cards = Object.entries(grouped)
      .map(([branchName, items]) => {
        const inner = items
          .map(
            (r) => `<div class="row"><span class="badge">${r.status}</span> ${r.c}</div>`
          )
          .join("");
        return `<div class="card"><h3>${branchName}</h3>${inner}</div>`;
      })
      .join("");
  }

  const branchFilter =
    can("branches:read") && can("dashboard:read")
      ? `<label class="muted">Branch</label>
         <select id="dashBranch"><option value="">All</option></select>`
      : "";

  appEl.innerHTML = layoutShell(
    "Dashboard",
    `
    <div class="row" style="margin-bottom:1rem;gap:0.75rem">
      <div>
        <label class="muted">From</label><br/>
        <input type="date" id="dashFrom" value="${from || ""}" />
      </div>
      <div>
        <label class="muted">To</label><br/>
        <input type="date" id="dashTo" value="${to || ""}" />
      </div>
      <div>${branchFilter}</div>
      <button class="btn secondary" type="button" id="dashApply">Apply</button>
    </div>
    <div class="grid cols-3">${cards}</div>`
  );
  document.getElementById("dashApply").onclick = () => render();
  if (can("branches:read") && can("dashboard:read")) {
    const sel = document.getElementById("dashBranch");
    if (sel) {
      const { branches } = await api("/branches");
      branches.forEach((b) => {
        const o = document.createElement("option");
        o.value = b.id;
        o.textContent = b.name;
        if (String(b.id) === String(branch)) o.selected = true;
        sel.appendChild(o);
      });
    }
  }
  wireLogout();
}

async function renderPunch() {
  if (!can("attendance:punch")) {
    appEl.innerHTML = layoutShell("Punch", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  appEl.innerHTML = layoutShell(
    "Punch In / Out",
    `
    <div class="card">
      <p class="muted">GPS (lat/lng) is validated against your branch fence. Optional live selfie is stored with the punch.</p>
      <div class="grid" style="gap:0.65rem;margin-top:0.75rem">
        <label class="muted">Live photo (optional)</label>
        <input type="file" id="punchPhoto" accept="image/*" capture="user" />
      </div>
      <div class="row" style="margin-top:0.75rem">
        <button class="btn" type="button" id="punchIn">Punch In</button>
        <button class="btn secondary" type="button" id="punchOut">Punch Out</button>
        <button class="btn ghost" type="button" id="faceBtn">Face API (placeholder)</button>
      </div>
      <p class="muted" id="punchMsg" style="margin-top:0.75rem"></p>
    </div>`
  );
  const msg = (t) => (document.getElementById("punchMsg").textContent = t);
  const geo = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({ lat: null, lng: null }),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  async function punch(type) {
    const g = await geo();
    const fd = new FormData();
    fd.append("type", type);
    if (g.lat != null) fd.append("lat", String(g.lat));
    if (g.lng != null) fd.append("lng", String(g.lng));
    fd.append("source", "device");
    const ph = document.getElementById("punchPhoto").files[0];
    if (ph) fd.append("photo", ph);
    const res = await api("/attendance/punch", { method: "POST", body: fd });
    const addr = res.record && res.record.punch_in_address;
    const addrOut = res.record && res.record.punch_out_address;
    msg(
      type === "in"
        ? `Punched in. ${addr ? "Address: " + addr : ""}`
        : `Punched out. ${addrOut ? "Address: " + addrOut : ""}`
    );
  }
  document.getElementById("punchIn").onclick = async () => {
    try {
      await punch("in");
    } catch (e) {
      msg(e.message);
    }
  };
  document.getElementById("punchOut").onclick = async () => {
    try {
      await punch("out");
    } catch (e) {
      msg(e.message);
    }
  };
  document.getElementById("faceBtn").onclick = async () => {
    try {
      await api("/attendance/face-placeholder", { method: "POST", body: "{}" });
    } catch (e) {
      msg(e.body?.message || e.message);
    }
  };
  wireLogout();
}

async function renderManual() {
  if (!can("attendance:manual")) {
    appEl.innerHTML = layoutShell("Manual entry", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const { users } = await api("/users");
  appEl.innerHTML = layoutShell(
    "Manual attendance",
    `
    <div class="card">
      <form id="manualForm" class="grid" style="gap:0.65rem">
        <div>
          <label class="muted">User</label><br/>
          <select name="userId" required>${users
            .map((u) => `<option value="${u.id}">${u.full_name} (${u.email})</option>`)
            .join("")}</select>
        </div>
        <div>
          <label class="muted">Work date</label><br/>
          <input name="workDate" type="date" required />
        </div>
        <div>
          <label class="muted">Status</label><br/>
          <select name="status">
            <option>present</option>
            <option>absent</option>
            <option>late</option>
            <option>half</option>
            <option>leave</option>
          </select>
        </div>
        <div>
          <label class="muted">Half period (optional)</label><br/>
          <select name="halfPeriod">
            <option value="">—</option>
            <option value="am">AM</option>
            <option value="pm">PM</option>
          </select>
        </div>
        <div>
          <label class="muted">Punch in (ISO, optional)</label><br/>
          <input name="punchInAt" placeholder="2026-04-11T09:05:00.000Z" />
        </div>
        <div>
          <label class="muted">Punch out (ISO, optional)</label><br/>
          <input name="punchOutAt" />
        </div>
        <div>
          <label class="muted">Notes</label><br/>
          <textarea name="notes" rows="2"></textarea>
        </div>
        <button class="btn" type="submit">Save</button>
        <p class="muted" id="manualMsg"></p>
      </form>
    </div>`
  );
  document.getElementById("manualForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = {
      userId: Number(fd.get("userId")),
      workDate: fd.get("workDate"),
      status: fd.get("status"),
      halfPeriod: fd.get("halfPeriod") || null,
      punchInAt: fd.get("punchInAt") || null,
      punchOutAt: fd.get("punchOutAt") || null,
      notes: fd.get("notes") || null,
    };
    try {
      await api("/attendance/manual", { method: "POST", body: JSON.stringify(body) });
      document.getElementById("manualMsg").textContent = "Saved.";
    } catch (e) {
      document.getElementById("manualMsg").textContent = e.message;
    }
  };
  wireLogout();
}

async function renderKiosk() {
  if (!can("attendance:kiosk")) {
    appEl.innerHTML = layoutShell("Kiosk", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const { users } = can("users:read")
    ? await api("/users")
    : { users: [me].filter(Boolean) };
  const chips = users
    .map(
      (u) => `
    <div class="user-chip" data-id="${u.id}">
      <strong>${u.full_name}</strong><br/>
      <span class="muted" style="font-size:0.8rem">${u.email}</span>
    </div>`
    )
    .join("");
  appEl.innerHTML = layoutShell(
    "Kiosk",
    `
    <a href="#/attendance/punch" class="muted" style="display:block;text-align:center;margin-bottom:0.5rem">Exit kiosk</a>
    <h1>Kiosk attendance</h1>
    <p class="muted" style="text-align:center">Quick selection · GPS + optional selfie (backup path)</p>
    <div class="kiosk-grid" id="kioskUsers">${chips}</div>
    <div class="grid" style="max-width:420px;margin:1rem auto 0;gap:0.5rem">
      <label class="muted">Kiosk selfie (optional)</label>
      <input type="file" id="kPhoto" accept="image/*" capture="user" />
    </div>
    <div class="row" style="justify-content:center;margin-top:1rem;gap:0.75rem;flex-wrap:wrap">
      <button class="btn" type="button" id="kIn">Punch in (selected)</button>
      <button class="btn secondary" type="button" id="kOut">Punch out (selected)</button>
      <button class="btn ghost" type="button" id="kFace">Save face photo (audit)</button>
    </div>
    <p class="muted" id="kMsg" style="text-align:center;margin-top:0.75rem"></p>`
  );
  let selected = users[0]?.id || null;
  const highlight = () => {
    document.querySelectorAll(".user-chip").forEach((el) => {
      el.style.outline = el.dataset.id === String(selected) ? "2px solid #22c55e" : "none";
    });
  };
  highlight();
  document.getElementById("kioskUsers").onclick = (ev) => {
    const chip = ev.target.closest(".user-chip");
    if (!chip) return;
    selected = Number(chip.dataset.id);
    highlight();
  };
  const geo = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve({ lat: null, lng: null })
      );
    });
  const msg = (t) => (document.getElementById("kMsg").textContent = t);
  async function kioskPunch(type) {
    const g = await geo();
    const fd = new FormData();
    fd.append("type", type);
    if (g.lat != null) fd.append("lat", String(g.lat));
    if (g.lng != null) fd.append("lng", String(g.lng));
    fd.append("source", "kiosk");
    fd.append("targetUserId", String(selected));
    const ph = document.getElementById("kPhoto").files[0];
    if (ph) fd.append("photo", ph);
    await api("/attendance/punch", { method: "POST", body: fd });
  }
  document.getElementById("kIn").onclick = async () => {
    try {
      await kioskPunch("in");
      msg("Punched in.");
    } catch (e) {
      msg(e.message);
    }
  };
  document.getElementById("kOut").onclick = async () => {
    try {
      await kioskPunch("out");
      msg("Punched out.");
    } catch (e) {
      msg(e.message);
    }
  };
  document.getElementById("kFace").onclick = async () => {
    const ph = document.getElementById("kPhoto").files[0];
    if (!ph) {
      msg("Choose a photo first.");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("photo", ph);
      const r = await api("/attendance/kiosk-face", { method: "POST", body: fd });
      msg(r.message || "Saved.");
    } catch (e) {
      msg(e.body?.message || e.message);
    }
  };
  wireLogout();
}

async function renderUsers() {
  if (!can("users:read")) {
    appEl.innerHTML = layoutShell("Users", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const { users } = await api("/users");
  const rows = users
    .map(
      (u) => `<tr>
      <td>${u.full_name}</td><td>${u.email}</td><td>${u.role}</td>
      <td>${u.branch_id || "—"}</td><td>${u.shift_start}–${u.shift_end}</td>
    </tr>`
    )
    .join("");
  const roleOptions = ["USER", "ATTENDANCE_MANAGER", "LOCATION_MANAGER"];
  if (me.role === "SUPER_ADMIN") roleOptions.push("SUPER_ADMIN");
  const createForm = can("users:create")
    ? `<div class="card" style="margin-bottom:1rem">
             <h3>Create user</h3>
             <form id="userCreate" class="grid" style="gap:0.5rem;margin-top:0.5rem">
               <input name="email" placeholder="email" required />
               <input name="login_id" placeholder="user id (optional)" />
               <input name="password" type="password" placeholder="password" required />
               <input name="full_name" placeholder="Full name" required />
               <select name="role">${roleOptions
                 .map((r) => `<option>${r}</option>`)
                 .join("")}</select>
               <input name="branch_id" placeholder="branch id (optional)" />
               <button class="btn" type="submit">Create</button>
               <p class="muted" id="ucMsg"></p>
             </form>
           </div>`
    : "";

  appEl.innerHTML = layoutShell(
    "Users / Staff",
    `${createForm}
     <div class="card"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Shift</th></tr></thead>
     <tbody>${rows}</tbody></table></div>`
  );
  const form = document.getElementById("userCreate");
  if (form) {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = {
        email: fd.get("email"),
        login_id: fd.get("login_id") || undefined,
        password: fd.get("password"),
        full_name: fd.get("full_name"),
        role: fd.get("role"),
        branch_id: fd.get("branch_id") || null,
      };
      try {
        await api("/users", { method: "POST", body: JSON.stringify(body) });
        document.getElementById("ucMsg").textContent = "Created.";
        render();
      } catch (e) {
        document.getElementById("ucMsg").textContent = e.message;
      }
    };
  }
  wireLogout();
}

async function renderBranches() {
  if (!can("branches:read")) {
    appEl.innerHTML = layoutShell("Branches", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const { branches } = await api("/branches");
  const rows = branches
    .map(
      (b) => `<tr><td>${b.name}</td><td>${b.lat ?? "—"}</td><td>${b.lng ?? "—"}</td><td>${b.radius_meters}m</td></tr>`
    )
    .join("");
  const form = can("branches:write")
    ? `<div class="card" style="margin-bottom:1rem">
         <h3>New branch / geo fence</h3>
         <form id="branchForm" class="grid" style="gap:0.5rem;margin-top:0.5rem">
           <input name="name" placeholder="Branch name" required />
           <input name="lat" placeholder="latitude" />
           <input name="lng" placeholder="longitude" />
           <input name="radius_meters" placeholder="radius meters (default 300)" />
           <button class="btn" type="submit">Save branch</button>
           <p class="muted" id="brMsg"></p>
         </form>
       </div>`
    : "";
  appEl.innerHTML = layoutShell(
    "Branches & GPS",
    `${form}<div class="card"><table><thead><tr><th>Name</th><th>Lat</th><th>Lng</th><th>Radius</th></tr></thead><tbody>${rows}</tbody></table></div>`
  );
  const bf = document.getElementById("branchForm");
  if (bf) {
    bf.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = {
        name: fd.get("name"),
        lat: fd.get("lat") ? Number(fd.get("lat")) : null,
        lng: fd.get("lng") ? Number(fd.get("lng")) : null,
        radius_meters: fd.get("radius_meters") ? Number(fd.get("radius_meters")) : 300,
      };
      try {
        await api("/branches", { method: "POST", body: JSON.stringify(body) });
        document.getElementById("brMsg").textContent = "Saved.";
        render();
      } catch (e) {
        document.getElementById("brMsg").textContent = e.message;
      }
    };
  }
  wireLogout();
}

async function renderHistory() {
  if (!can("history:read") && !can("history:read_self")) {
    appEl.innerHTML = layoutShell("History", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const params = new URLSearchParams();
  const uid = document.getElementById("hUser")?.value;
  const st = document.getElementById("hStatus")?.value;
  if (uid) params.set("userId", uid);
  if (st) params.set("status", st);
  const data = await api("/attendance/history?" + params.toString());
  const editor = can("history:edit")
    ? `<div class="card" style="margin-top:1rem">
         <h3>Full edit (record id)</h3>
         <p class="muted" style="font-size:0.85rem">Use for half ↔ full day, past/future corrections, and notes.</p>
         <div class="grid" style="gap:0.45rem;margin-top:0.5rem">
           <input id="eId" placeholder="attendance record id" />
           <input id="eStatus" placeholder="status (present|absent|late|half|leave)" />
           <input id="eIn" placeholder="punch in ISO (optional)" />
           <input id="eOut" placeholder="punch out ISO (optional)" />
           <input id="eHalf" placeholder="half period am|pm (optional)" />
           <input id="eDate" placeholder="work date YYYY-MM-DD (optional)" />
           <textarea id="eNotes" rows="2" placeholder="notes"></textarea>
           <button class="btn secondary" type="button" id="eSave">Save changes</button>
           <p class="muted" id="eMsg"></p>
         </div>
       </div>`
    : "";

  appEl.innerHTML = layoutShell(
    "Attendance history",
    `<div class="row" style="margin-bottom:0.75rem;gap:0.5rem">
       ${
         can("history:read")
           ? '<input id="hUser" placeholder="filter user id" />'
           : ""
       }
       <select id="hStatus">
         <option value="">All status</option>
         <option>present</option><option>absent</option><option>late</option><option>half</option><option>leave</option>
       </select>
       <button class="btn secondary" type="button" id="hApply">Apply</button>
       ${
         can("export:read")
           ? '<button class="btn ghost" type="button" id="exportCsv">Export CSV</button><button class="btn ghost" type="button" id="exportXlsx">Export Excel (.xlsx)</button>'
           : ""
       }
     </div>
     <div class="card"><table><thead><tr><th>Id</th><th>Date</th><th>User</th><th>Status</th><th>In</th><th>Out</th><th>Source</th></tr></thead>
     <tbody>${(data.records || [])
       .map(
         (r) => `<tr>
      <td>${r.id}</td><td>${r.work_date}</td><td>${r.full_name || ""}</td><td>${r.status}</td>
      <td>${r.punch_in_at || "—"}</td><td>${r.punch_out_at || "—"}</td><td>${r.source}</td>
    </tr>`
       )
       .join("")}</tbody></table></div>${editor}`
  );
  document.getElementById("hApply").onclick = () => render();
  const ex = document.getElementById("exportCsv");
  if (ex) {
    ex.onclick = () => {
      const p = new URLSearchParams();
      const u = document.getElementById("hUser");
      const st = document.getElementById("hStatus");
      if (u && u.value) p.set("userId", u.value);
      if (st && st.value) p.set("status", st.value);
      const q = p.toString();
      window.open("/api/attendance/export.csv" + (q ? "?" + q : ""), "_blank");
    };
  }
  const exx = document.getElementById("exportXlsx");
  if (exx) {
    exx.onclick = () => {
      const p = new URLSearchParams();
      const u = document.getElementById("hUser");
      const st = document.getElementById("hStatus");
      if (u && u.value) p.set("userId", u.value);
      if (st && st.value) p.set("status", st.value);
      const q = p.toString();
      window.open("/api/attendance/export.xlsx" + (q ? "?" + q : ""), "_blank");
    };
  }
  const es = document.getElementById("eSave");
  if (es) {
    es.onclick = async () => {
      const id = document.getElementById("eId").value.trim();
      if (!id) return;
      const body = {
        status: document.getElementById("eStatus").value || undefined,
        punchInAt: document.getElementById("eIn").value || undefined,
        punchOutAt: document.getElementById("eOut").value || undefined,
        halfPeriod: document.getElementById("eHalf").value || undefined,
        workDate: document.getElementById("eDate").value || undefined,
        notes: document.getElementById("eNotes").value || undefined,
      };
      try {
        await api("/attendance/" + id, { method: "PATCH", body: JSON.stringify(body) });
        document.getElementById("eMsg").textContent = "Updated.";
        render();
      } catch (e) {
        document.getElementById("eMsg").textContent = e.message;
      }
    };
  }
  wireLogout();
}

async function renderLeave() {
  if (!can("leave:read_all") && !can("leave:read_self")) {
    appEl.innerHTML = layoutShell("Leave", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const { leaves } = await api("/leave");
  const applyForm = can("leave:apply")
    ? `<div class="card" style="margin-bottom:1rem">
         <h3>Apply for leave</h3>
         <form id="leaveApply" class="grid" style="gap:0.5rem;margin-top:0.5rem">
           <input name="start_date" type="date" required />
           <input name="end_date" type="date" required />
           <textarea name="reason" rows="2" placeholder="Reason" required></textarea>
           <button class="btn" type="submit">Submit</button>
           <p class="muted" id="laMsg"></p>
         </form>
       </div>`
    : "";
  const rows = (leaves || [])
    .map((r) => {
      let actions = "";
      if (can("leave:approve_manager") && r.final_status === "PENDING" && r.manager_review == null) {
        actions += `<button class="btn secondary btn-ma" data-id="${r.id}" type="button">Manager OK</button>
          <button class="btn ghost btn-mr" data-id="${r.id}" type="button">Manager reject</button>`;
      }
      if (
        me.role === "SUPER_ADMIN" &&
        r.manager_review === "APPROVED" &&
        r.final_status === "PENDING" &&
        r.admin_review == null
      ) {
        actions += `<button class="btn secondary btn-aa" data-id="${r.id}" type="button">Admin approve</button>
          <button class="btn ghost btn-ar" data-id="${r.id}" type="button">Admin reject</button>`;
      }
      return `<tr>
        <td>${r.id}</td><td>${r.full_name || ""}</td><td>${r.start_date}</td><td>${r.end_date}</td>
        <td>${r.final_status}</td><td>${r.manager_review || "—"}</td><td>${r.admin_review || "—"}</td>
        <td>${actions}</td>
      </tr>`;
    })
    .join("");
  appEl.innerHTML = layoutShell(
    "Leave requests",
    `${applyForm}
     <div class="card"><table><thead><tr><th>Id</th><th>User</th><th>From</th><th>To</th><th>Status</th><th>Mgr</th><th>Admin</th><th></th></tr></thead>
     <tbody>${rows}</tbody></table></div>`
  );
  const lf = document.getElementById("leaveApply");
  if (lf) {
    lf.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await api("/leave/apply", {
          method: "POST",
          body: JSON.stringify({
            start_date: fd.get("start_date"),
            end_date: fd.get("end_date"),
            reason: fd.get("reason"),
          }),
        });
        document.getElementById("laMsg").textContent = "Submitted.";
        render();
      } catch (e) {
        document.getElementById("laMsg").textContent = e.message;
      }
    };
  }
  document.querySelectorAll(".btn-ma").forEach((b) => {
    b.onclick = () => apiPostLeave(`/leave/${b.dataset.id}/manager-approve`, {});
  });
  document.querySelectorAll(".btn-mr").forEach((b) => {
    b.onclick = () => {
      const c = prompt("Reject comment?");
      if (c == null) return;
      apiPostLeave(`/leave/${b.dataset.id}/manager-reject`, { comment: c });
    };
  });
  document.querySelectorAll(".btn-aa").forEach((b) => {
    b.onclick = () => apiPostLeave(`/leave/${b.dataset.id}/admin-approve`, {});
  });
  document.querySelectorAll(".btn-ar").forEach((b) => {
    b.onclick = () => {
      const c = prompt("Reject comment?");
      if (c == null) return;
      apiPostLeave(`/leave/${b.dataset.id}/admin-reject`, { comment: c });
    };
  });
  async function apiPostLeave(path, body) {
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      render();
    } catch (e) {
      alert(e.message);
    }
  }
  wireLogout();
}

async function renderNotices() {
  if (!can("notices:read")) {
    appEl.innerHTML = layoutShell("Notices", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const { notices } = await api("/notices");
  const list = notices
    .map(
      (n) => `<div class="card" style="margin-bottom:0.65rem">
      <h3>${n.title}</h3>
      <p class="muted" style="font-size:0.8rem">${n.author_name} · ${n.created_at}</p>
      <p>${n.body}</p>
    </div>`
    )
    .join("");
  const form = can("notices:write")
    ? `<div class="card" style="margin-bottom:1rem">
         <h3>New announcement</h3>
         <form id="noticeForm" class="grid" style="gap:0.5rem;margin-top:0.5rem">
           <input name="title" placeholder="Title" required />
           <textarea name="body" rows="3" placeholder="Body" required></textarea>
           <button class="btn" type="submit">Publish</button>
         </form>
       </div>`
    : "";
  appEl.innerHTML = layoutShell("Notice board", form + list);
  const nf = document.getElementById("noticeForm");
  if (nf) {
    nf.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      await api("/notices", {
        method: "POST",
        body: JSON.stringify({ title: fd.get("title"), body: fd.get("body") }),
      });
      render();
    };
  }
  wireLogout();
}

async function renderRoles() {
  if (!can("roles:read")) {
    appEl.innerHTML = layoutShell("Roles", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const { roles } = await api("/roles");
  const cards = roles
    .map(
      (r) => `<div class="card"><h3>${r.label}</h3><p class="muted">${r.description}</p><div class="badge">${r.id}</div></div>`
    )
    .join("");
  appEl.innerHTML = layoutShell("Roles & permissions", `<div class="grid cols-3">${cards}</div>`);
  wireLogout();
}

async function renderTimings() {
  if (!can("timings:read") && !can("timings:read_self")) {
    appEl.innerHTML = layoutShell("Timings", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  if (can("timings:read_self") && !can("timings:read")) {
    const t = await api("/timings/me");
    appEl.innerHTML = layoutShell(
      "My shift",
      `<div class="card"><p>Start: <strong>${t.shift_start}</strong></p><p>End: <strong>${t.shift_end}</strong></p><p>Grace: <strong>${t.grace_minutes} min</strong></p></div>`
    );
    return wireLogout();
  }
  const { users } = await api("/users");
  const rows = users
    .map(
      (u) => `<tr data-id="${u.id}">
      <td>${u.full_name}</td><td>${u.shift_start}</td><td>${u.shift_end}</td><td>${u.grace_minutes}</td>
      <td>${
        can("timings:write")
          ? `<button class="btn secondary btn-edit" type="button">Edit</button>`
          : ""
      }</td>
    </tr>`
    )
    .join("");
  appEl.innerHTML = layoutShell(
    "Timings / shift management",
    `<div class="card"><table><thead><tr><th>User</th><th>Start</th><th>End</th><th>Grace</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  );
  document.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.onclick = async () => {
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const shift_start = prompt("Shift start (HH:MM)", "09:00");
      if (!shift_start) return;
      const shift_end = prompt("Shift end (HH:MM)", "18:00");
      const grace_minutes = Number(prompt("Grace minutes", "15"));
      await api("/timings/" + id, {
        method: "PATCH",
        body: JSON.stringify({ shift_start, shift_end, grace_minutes }),
      });
      render();
    };
  });
  wireLogout();
}

async function renderPayroll() {
  if (!can("settings:write")) {
    appEl.innerHTML = layoutShell("Payroll", `<p class="error">Restricted to Super Admin.</p>`);
    return wireLogout();
  }
  appEl.innerHTML = layoutShell(
    "Payroll",
    `<div class="card"><p class="muted">
      Payroll integration is not enabled in this build. Hook this view to your payroll provider
      (exports, statutory deductions, payslips) behind the same RBAC layer.
    </p></div>`
  );
  wireLogout();
}

async function renderSettings() {
  if (!can("settings:read")) {
    appEl.innerHTML = layoutShell("Settings", `<p class="error">No access.</p>`);
    return wireLogout();
  }
  const s = await api("/settings");
  let gStatus = null;
  let appsScriptStatus = null;
  if (can("integrations:sync")) {
    try {
      gStatus = await api("/integrations/google/status");
    } catch {
      gStatus = null;
    }
    try {
      appsScriptStatus = await api("/integrations/apps-script/status");
    } catch {
      appsScriptStatus = null;
    }
  }
  const appsScriptCard = can("integrations:sync")
    ? `<div class="card" style="margin-top:1rem">
         <h3>Google Apps Script (dynamic push)</h3>
         <p class="muted" style="font-size:0.88rem">
           Server pushes raw rows to your deployed Web App. New DB columns appear as new fields automatically.
           Disable: <code>APPS_SCRIPT_SYNC_ENABLED=0</code>. Override URL: <code>GOOGLE_APPS_SCRIPT_WEBAPP_URL</code>.
         </p>
         ${
           appsScriptStatus
             ? `<p style="font-size:0.92rem">Enabled: <strong>${appsScriptStatus.enabled ? "yes" : "no"}</strong> · Host: <code>${appsScriptStatus.webapp_host || "—"}</code> · Startup test done: <strong>${appsScriptStatus.startup_test_completed ? "yes" : "no"}</strong></p>`
             : `<p class="muted">Could not load Apps Script status.</p>`
         }
         <button class="btn secondary" type="button" id="appsBulk" style="margin-top:0.5rem">Bulk push all tables to Apps Script</button>
         ${
           appsScriptStatus
             ? `<pre style="margin-top:0.75rem;font-size:0.78rem;white-space:pre-wrap;max-height:180px;overflow:auto">${JSON.stringify(
                 appsScriptStatus.recent_logs || [],
                 null,
                 2
               )}</pre>`
             : ""
         }
       </div>`
    : "";
  const sheets = can("integrations:sync")
    ? `<div class="card" style="margin-top:1rem">
         <h3>Google Sheets — full auto sync</h3>
         <p class="muted" style="font-size:0.88rem">
           After you click <strong>Connect Google</strong> and approve access, the server creates <strong>HRMS Master Data</strong>
           with sheets: Attendance Logs, Leave Requests, Users, Branches, Audit Logs. Row headers grow when new fields appear—no manual sheet setup.
           Tokens are encrypted (INTEGRATION_SECRET / SESSION_SECRET). Optional: <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> for non-browser access.
         </p>
         <div class="sheet-status" style="margin:0.75rem 0;font-size:0.95rem">
           ${
             gStatus
               ? `<div style="margin-bottom:0.5rem;padding:0.5rem 0.65rem;border-radius:8px;background:var(--card2, rgba(0,0,0,0.04));border:1px solid var(--border, #e5e5e5)">
                    <strong>Status:</strong>
                    <span style="color:${gStatus.connected ? "var(--ok, #0a7)" : "var(--muted, #666)"};font-weight:600">
                      ${gStatus.connectionStatus || (gStatus.connected ? "Connected" : "Not Connected")}
                    </span>
                  </div>
                  <div>OAuth client in env: <strong>${gStatus.oauthConfigured ? "yes" : "no"}</strong></div>
                  <div>Google account linked: <strong>${gStatus.oauthLinked ? "yes" : "no"}</strong> · Service account env: <strong>${gStatus.serviceAccountConfigured ? "yes" : "no"}</strong></div>
                  <div>Spreadsheet ID: <code style="word-break:break-all">${gStatus.spreadsheetId || "—"}</code></div>
                  <div>Auto sync: <strong>${gStatus.syncEnabled ? "ON" : "OFF"}</strong> · Last sync: ${gStatus.lastSyncAt || "—"}</div>
                  <div class="muted" style="margin-top:0.35rem;font-size:0.85rem">Last error: ${gStatus.lastError ? JSON.stringify(gStatus.lastError) : "—"}</div>`
               : ""
           }
         </div>
         <div class="row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.5rem">
           <button class="btn" type="button" id="gConnect">Connect Google</button>
           <button class="btn secondary" type="button" id="gDisconnect">Disconnect</button>
           <label class="row" style="gap:0.35rem;align-items:center"><input type="checkbox" id="gSyncToggle" ${gStatus && gStatus.syncEnabled ? "checked" : ""} /> Sync enabled</label>
         </div>
         <p class="muted" style="margin-top:0.75rem;font-size:0.85rem">
           Configure in Google Cloud Console: OAuth client (Web), redirect URI
           <code>http://localhost:3000/api/integrations/google/oauth/callback</code> (adjust host/port for production).
           Set env: <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_OAUTH_REDIRECT_URI</code> (optional),
           <code>INTEGRATION_SECRET</code> or <code>SESSION_SECRET</code> for token encryption.
         </p>
         <div class="row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.5rem">
           <input id="shFrom" type="date" title="from" />
           <input id="shTo" type="date" title="to" />
           <button class="btn secondary" type="button" id="shSync">Sync attendance (range)</button>
           <button class="btn secondary" type="button" id="shFull">Full sync (all modules)</button>
         </div>
         <p class="muted" id="shMsg" style="margin-top:0.5rem;word-break:break-word"></p>
       </div>`
    : "";

  appEl.innerHTML = layoutShell(
    "Settings",
    `<div class="card"><pre style="white-space:pre-wrap;margin:0">${JSON.stringify(
      s,
      null,
      2
    )}</pre>
    ${
      can("settings:write")
        ? '<button class="btn secondary" type="button" id="setSave">Save (placeholder)</button>'
        : ""
    }
    </div>${sheets}${appsScriptCard}`
  );
  const b = document.getElementById("setSave");
  if (b) {
    b.onclick = async () => {
      await api("/settings", { method: "PATCH", body: "{}" });
      render();
    };
  }
  const gConn = document.getElementById("gConnect");
  if (gConn) {
    gConn.onclick = async () => {
      const msg = document.getElementById("shMsg");
      try {
        const r = await api("/integrations/google/auth-url");
        if (r.url) window.location.href = r.url;
        else msg.textContent = "No auth URL returned.";
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }
  const gDisc = document.getElementById("gDisconnect");
  if (gDisc) {
    gDisc.onclick = async () => {
      const msg = document.getElementById("shMsg");
      try {
        await api("/integrations/google/disconnect", { method: "POST", body: "{}" });
        msg.textContent = "Disconnected.";
        render();
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }
  const gTog = document.getElementById("gSyncToggle");
  if (gTog) {
    gTog.onchange = async () => {
      const msg = document.getElementById("shMsg");
      try {
        await api("/integrations/google/sync-enabled", {
          method: "POST",
          body: JSON.stringify({ enabled: gTog.checked }),
        });
        msg.textContent = gTog.checked ? "Sync ON." : "Sync OFF.";
        render();
      } catch (e) {
        msg.textContent = e.message;
        gTog.checked = !gTog.checked;
      }
    };
  }
  const sh = document.getElementById("shSync");
  if (sh) {
    sh.onclick = async () => {
      const from = document.getElementById("shFrom").value;
      const to = document.getElementById("shTo").value;
      const msg = document.getElementById("shMsg");
      try {
        const r = await api("/integrations/google-sheets/sync", {
          method: "POST",
          body: JSON.stringify({ from: from || undefined, to: to || undefined }),
        });
        msg.textContent = JSON.stringify(r);
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }
  const shFull = document.getElementById("shFull");
  if (shFull) {
    shFull.onclick = async () => {
      const msg = document.getElementById("shMsg");
      try {
        const r = await api("/integrations/google-sheets/full-sync", { method: "POST", body: "{}" });
        msg.textContent = JSON.stringify(r);
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }
  const appsBulk = document.getElementById("appsBulk");
  if (appsBulk) {
    appsBulk.onclick = async () => {
      try {
        const r = await api("/integrations/apps-script/bulk-push", { method: "POST", body: "{}" });
        alert(JSON.stringify(r));
        render();
      } catch (e) {
        alert(e.message);
      }
    };
  }
  wireLogout();
}

window.addEventListener("hashchange", render);
render();
