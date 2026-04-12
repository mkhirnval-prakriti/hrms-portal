const { sendMail } = require("./emailService");

async function sendDailyHrmsReport(db) {
  if (process.env.DAILY_EMAIL_REPORT !== "1") return { skipped: true };
  const to = process.env.SUPER_ADMIN_EMAIL || process.env.ALERT_EMAIL_TO;
  if (!to) return { skipped: true };
  const today = new Date().toISOString().slice(0, 10);
  let totalStaff = 0;
  try {
    totalStaff = Number(
      db.prepare("SELECT COUNT(*) AS c FROM users WHERE active = 1 AND deleted_at IS NULL").get().c
    );
  } catch {
    totalStaff = Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE active = 1").get().c);
  }
  const lines = [`Prakriti HRMS — Daily summary`, `Date: ${today}`, `Active staff: ${totalStaff}`, ""];
  try {
    const alerts = db.prepare(`SELECT type, severity, message, created_at FROM hr_alerts ORDER BY id DESC LIMIT 20`).all();
    lines.push("Recent security / attendance alerts:");
    alerts.forEach((a) => lines.push(`- [${a.severity}] ${a.type}: ${a.message}`));
  } catch {
    lines.push("(alerts table unavailable)");
  }
  await sendMail({
    to,
    subject: `HRMS daily report — ${today}`,
    text: lines.join("\n"),
  });
  return { ok: true };
}

module.exports = { sendDailyHrmsReport };
