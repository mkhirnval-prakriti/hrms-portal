/**
 * Smoke test: service account → Google Sheet, ensure tab + headers, insert sample row (no duplicate).
 *
 * Required: enable "Google Sheets API" in GCP; create a service account; share the spreadsheet
 * with the service account email (Editor), OR let this script create a new spreadsheet (needs
 * Drive scope is NOT required for spreadsheets.create with Sheets API in SA's drive).
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT, or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY)
 *   GOOGLE_SHEETS_SPREADSHEET_ID — optional; if omitted, creates "HRMS Integration Test"
 *
 * Usage: node scripts/google-sheets-smoke-test.js
 */
const path = require("path");
const { google } = require("googleapis");
const { loadServiceAccountCredentials } = require(path.join(__dirname, "..", "src", "googleServiceAccount.js"));

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const TAB_NAME = "TestImport";
const HEADERS = ["DATE", "CUSTOMER NAME", "MOBILE", "SOURCE"];
const SAMPLE = {
  mobile: "9999999999",
  source: "store 2",
  customer: "TEST USER",
};

async function getSheetsClient() {
  const credentials = loadServiceAccountCredentials();
  if (!credentials) {
    console.error(
      "Missing service account. Set GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY)."
    );
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

function sheetUrl(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

async function ensureTabAndHeaders(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  if (!titles.includes(TAB_NAME)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: TAB_NAME, gridProperties: { rowCount: 500, columnCount: 10 } },
            },
          },
        ],
      },
    });
  }
  const esc = `'${TAB_NAME.replace(/'/g, "''")}'`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${esc}!A1:D1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [HEADERS] },
  });
}

async function findDuplicate(sheets, spreadsheetId) {
  const esc = `'${TAB_NAME.replace(/'/g, "''")}'`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${esc}!A2:D500`,
  });
  const rows = res.data.values || [];
  const mobileIdx = HEADERS.indexOf("MOBILE");
  const sourceIdx = HEADERS.indexOf("SOURCE");
  for (const row of rows) {
    const m = row[mobileIdx];
    const s = row[sourceIdx];
    if (String(m || "").trim() === SAMPLE.mobile && String(s || "").trim() === SAMPLE.source) {
      return true;
    }
  }
  return false;
}

async function appendRow(sheets, spreadsheetId, dateStr) {
  const esc = `'${TAB_NAME.replace(/'/g, "''")}'`;
  const row = [dateStr, SAMPLE.customer, SAMPLE.mobile, SAMPLE.source];
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${esc}!A:D`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return row;
}

async function createSpreadsheet(sheets) {
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "HRMS Integration Test" },
      sheets: [
        {
          properties: {
            title: TAB_NAME,
            gridProperties: { rowCount: 500, columnCount: 10 },
          },
        },
      ],
    },
  });
  return res.data.spreadsheetId;
}

async function main() {
  const sheets = await getSheetsClient();
  let spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "";
  let newlyCreated = false;

  if (!spreadsheetId) {
    spreadsheetId = await createSpreadsheet(sheets);
    newlyCreated = true;
    console.log("Created new spreadsheet:", spreadsheetId);
    console.log("Set GOOGLE_SHEETS_SPREADSHEET_ID=" + spreadsheetId + " to reuse this file.");
    console.log("Share this sheet with your human Google account if needed (File → Share).");
  }

  await ensureTabAndHeaders(sheets, spreadsheetId);

  const dup = await findDuplicate(sheets, spreadsheetId);
  const dateStr = new Date().toISOString();

  let insertedRow;
  let duplicateSkipped = false;
  if (dup) {
    duplicateSkipped = true;
    insertedRow = [dateStr, SAMPLE.customer, SAMPLE.mobile, SAMPLE.source];
    console.log("Duplicate row already present (MOBILE + SOURCE). Skipping append.");
  } else {
    insertedRow = await appendRow(sheets, spreadsheetId, dateStr);
  }

  const link = sheetUrl(spreadsheetId);
  console.log("\n--- RESULT ---");
  console.log("1. Google Sheet link:", link);
  console.log(
    "2. Connection:",
    newlyCreated ? "Newly Connected (spreadsheet created)" : "Connected (existing GOOGLE_SHEETS_SPREADSHEET_ID)"
  );
  console.log("3. Inserted row:", duplicateSkipped ? "(skipped duplicate)" : insertedRow.join(" | "));
  console.log("4. Spreadsheet title: HRMS Integration Test (or your existing file name)");
  console.log("   Tab name:", TAB_NAME);
  console.log("   Columns:", HEADERS.join(", "));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
