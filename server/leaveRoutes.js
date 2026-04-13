const { ROLES } = require("./rbac");
const { notifyLeaveWhatsApp } = require("./whatsapp");

function registerLeaveRoutes(router, db, { attachUser, can, onLeaveChange, auditLeave }) {
  function afterLeaveChange(leaveId) {
    if (typeof onLeaveChange === "function") onLeaveChange(leaveId);
  }

  router.post("/leave/apply", attachUser, (req, res) => {
    if (!can(req.currentUser, "leave:apply")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { start_date, end_date, reason } = req.body || {};
    if (!start_date || !end_date || !reason) {
      return res.status(400).json({ error: "start_date, end_date, reason required" });
    }
    const info = db
      .prepare(
        `INSERT INTO leave_requests (user_id, start_date, end_date, reason, final_status, updated_at)
         VALUES (?,?,?,?, 'PENDING', datetime('now'))`
      )
      .run(req.currentUser.id, String(start_date), String(end_date), String(reason));
    const row = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(info.lastInsertRowid);
    if (typeof auditLeave === "function") {
      auditLeave(req.currentUser.id, "leave_apply", row.id, { start_date, end_date });
    }
    afterLeaveChange(row.id);
    res.json({ leave: row });
  });
  router.post("/leaves", attachUser, (req, res, next) => {
    req.url = "/leave/apply";
    return router.handle(req, res, next);
  });

  router.get("/leave", attachUser, (req, res) => {
    const u = req.currentUser;
    if (can(u, "leave:read_all")) {
      const rows = db
        .prepare(
          `SELECT lr.*, u.full_name, u.email, u.role
           FROM leave_requests lr
           JOIN users u ON u.id = lr.user_id
           ORDER BY lr.created_at DESC
           LIMIT 200`
        )
        .all();
      return res.json({ leaves: rows });
    }
    if (can(u, "leave:read_self")) {
      const rows = db
        .prepare(
          `SELECT lr.*, u.full_name, u.email
           FROM leave_requests lr
           JOIN users u ON u.id = lr.user_id
           WHERE lr.user_id = ?
           ORDER BY lr.created_at DESC`
        )
        .all(u.id);
      return res.json({ leaves: rows });
    }
    return res.status(403).json({ error: "Forbidden" });
  });
  router.get("/leaves", attachUser, (req, res, next) => {
    req.url = "/leave";
    return router.handle(req, res, next);
  });

  function getLeave(id) {
    return db
      .prepare(
        `SELECT lr.*, u.full_name, u.email
         FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.id = ?`
      )
      .get(Number(id));
  }

  router.post("/leave/:id/manager-approve", attachUser, (req, res) => {
    if (!can(req.currentUser, "leave:approve_manager")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const row = getLeave(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.final_status !== "PENDING" || row.manager_review != null) {
      return res.status(400).json({ error: "Invalid state for manager action" });
    }
    db.prepare(
      `UPDATE leave_requests SET
        manager_review = 'APPROVED',
        manager_comment = ?,
        manager_action_at = datetime('now'),
        manager_action_by = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run((req.body && req.body.comment) || null, req.currentUser.id, row.id);
    const updated = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(row.id);
    if (typeof auditLeave === "function") {
      auditLeave(req.currentUser.id, "leave_manager_approve", row.id, {});
    }
    afterLeaveChange(row.id);
    res.json({ leave: updated });
  });

  router.post("/leave/:id/manager-reject", attachUser, (req, res) => {
    if (!can(req.currentUser, "leave:approve_manager")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const row = getLeave(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.final_status !== "PENDING" || row.manager_review != null) {
      return res.status(400).json({ error: "Invalid state" });
    }
    db.prepare(
      `UPDATE leave_requests SET
        manager_review = 'REJECTED',
        manager_comment = ?,
        manager_action_at = datetime('now'),
        manager_action_by = ?,
        final_status = 'REJECTED',
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(String((req.body && req.body.comment) || ""), req.currentUser.id, row.id);
    const updated = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(row.id);
    if (typeof auditLeave === "function") {
      auditLeave(req.currentUser.id, "leave_manager_reject", row.id, {});
    }
    afterLeaveChange(row.id);
    setImmediate(() => notifyLeaveWhatsApp(db, row.id).catch(() => {}));
    res.json({ leave: updated });
  });

  router.post("/leave/:id/admin-approve", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin can final-approve" });
    }
    const row = getLeave(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.manager_review !== "APPROVED" || row.final_status !== "PENDING") {
      return res.status(400).json({ error: "Manager approval required first" });
    }
    if (row.admin_review != null) {
      return res.status(400).json({ error: "Already decided" });
    }
    db.prepare(
      `UPDATE leave_requests SET
        admin_review = 'APPROVED',
        admin_comment = ?,
        admin_action_at = datetime('now'),
        admin_action_by = ?,
        final_status = 'APPROVED',
        updated_at = datetime('now')
       WHERE id = ?`
    ).run((req.body && req.body.comment) || null, req.currentUser.id, row.id);
    const updated = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(row.id);
    if (typeof auditLeave === "function") {
      auditLeave(req.currentUser.id, "leave_admin_approve", row.id, {});
    }
    afterLeaveChange(row.id);
    setImmediate(() => notifyLeaveWhatsApp(db, row.id).catch(() => {}));
    res.json({ leave: updated });
  });

  router.post("/leave/:id/admin-reject", attachUser, (req, res) => {
    if (req.currentUser.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: "Only Super Admin" });
    }
    const row = getLeave(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.manager_review !== "APPROVED" || row.final_status !== "PENDING") {
      return res.status(400).json({ error: "Invalid state" });
    }
    db.prepare(
      `UPDATE leave_requests SET
        admin_review = 'REJECTED',
        admin_comment = ?,
        admin_action_at = datetime('now'),
        admin_action_by = ?,
        final_status = 'REJECTED',
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(String((req.body && req.body.comment) || ""), req.currentUser.id, row.id);
    const updated = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(row.id);
    if (typeof auditLeave === "function") {
      auditLeave(req.currentUser.id, "leave_admin_reject", row.id, {});
    }
    afterLeaveChange(row.id);
    setImmediate(() => notifyLeaveWhatsApp(db, row.id).catch(() => {}));
    res.json({ leave: updated });
  });

  router.put("/leaves/:id", attachUser, (req, res) => {
    const { final_status, comment } = req.body || {};
    const desired = String(final_status || "").toUpperCase();
    if (desired !== "APPROVED" && desired !== "REJECTED") {
      return res.status(400).json({ error: "final_status must be APPROVED or REJECTED" });
    }
    const id = Number(req.params.id);
    if (req.currentUser.role === ROLES.SUPER_ADMIN) {
      req.params.id = String(id);
      req.body = { comment: comment || null };
      if (desired === "APPROVED") req.url = `/leave/${id}/admin-approve`;
      else req.url = `/leave/${id}/admin-reject`;
      return router.handle(req, res, () => {});
    }
    if (!can(req.currentUser, "leave:approve_manager")) {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.params.id = String(id);
    req.body = { comment: comment || null };
    if (desired === "APPROVED") req.url = `/leave/${id}/manager-approve`;
    else req.url = `/leave/${id}/manager-reject`;
    return router.handle(req, res, () => {});
  });

  router.delete("/leaves/:id", attachUser, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const isOwner = Number(row.user_id) === Number(req.currentUser.id);
    const canDeleteAny = req.currentUser.role === ROLES.SUPER_ADMIN || can(req.currentUser, "leave:approve_manager");
    if (!isOwner && !canDeleteAny) {
      return res.status(403).json({ error: "Forbidden" });
    }
    db.prepare("DELETE FROM leave_requests WHERE id = ?").run(id);
    if (typeof auditLeave === "function") {
      auditLeave(req.currentUser.id, "leave_delete", id, {});
    }
    afterLeaveChange(id);
    res.json({ ok: true, id });
  });
}

module.exports = { registerLeaveRoutes };
