const { sendMail } = require("./emailService");

function readDailyReportConfig(db) {
  try {
    const row = db.prepare("SELECT v FROM integration_kv WHERE k = ?").get("app_runtime_settings");
    if (!row?.v) return null;
    const parsed = JSON.parse(row.v);
    return parsed?.daily_report || null;
  } catch {
    return null;
  }
}

async function sendDailyHrmsReport(db) {
  const cfg = readDailyReportConfig(db);
  const enabled = cfg?.enabled != null ? !!cfg.enabled : process.env.DAILY_EMAIL_REPORT === "1";
  if (!enabled) return { skipped: true };
  const defaultRecipients = ["contact@prakritiherbs.in", "mkhirnval@gmail.com"];
  const recipients = Array.isArray(cfg?.recipients) && cfg.recipients.length > 0
    ? cfg.recipients
    : (process.env.SUPER_ADMIN_EMAIL || process.env.ALERT_EMAIL_TO
        ? [process.env.SUPER_ADMIN_EMAIL || process.env.ALERT_EMAIL_TO]
        : defaultRecipients);
  if (!recipients.length) return { skipped: true };
  const today = new Date().toISOString().slice(0, 10);
  const totalStaff = Number(
    db.prepare("SELECT COUNT(*) AS c FROM users WHERE active = 1 AND deleted_at IS NULL").get().c
  );
  const present = Number(
    db.prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE work_date = ? AND status IN ('present','half')").get(today).c
  );
  const late = Number(
    db.prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE work_date = ? AND status = 'late'").get(today).c
  );
  const absent = Math.max(0, totalStaff - present - late);
  const missedPunchOut = Number(
    db.prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE work_date = ? AND punch_in_at IS NOT NULL AND punch_out_at IS NULL").get(today).c
  );
  const leavePending = Number(
    db.prepare("SELECT COUNT(*) AS c FROM leave_requests WHERE final_status = 'PENDING'").get().c
  );
  const leaveApproved = Number(
    db.prepare("SELECT COUNT(*) AS c FROM leave_requests WHERE final_status = 'APPROVED'").get().c
  );
  const lines = [
    "Prakriti HRMS — Daily summary",
    `Date: ${today}`,
    "",
    `Total staff: ${totalStaff}`,
    `Present: ${present}`,
    `Late: ${late}`,
    `Absent: ${absent}`,
    `Missed punch-out: ${missedPunchOut}`,
    `Leave pending: ${leavePending}`,
    `Leave approved: ${leaveApproved}`,
    "",
  ];
  await sendMail({
    to: recipients.join(","),
    subject: `HRMS daily report — ${today}`,
    text: lines.join("\n"),
  });
  return { ok: true };
}

module.exports = { sendDailyHrmsReport };
