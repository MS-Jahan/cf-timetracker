/**
 * cf-timetracker → Google Sheets receiver (spec §3, tasks T-G1..T-G3).
 *
 * Deploy as a Web App: Execute as "Me", Who has access: "Anyone".
 * Setup: File → Project Properties → Script Properties → add
 *   SHARED_SECRET = (same value as the Worker's GAS_SECRET)
 *
 * Protocol (Worker → this Web App):
 *   POST with JSON body { entries: [...], secret: "..." }
 *   → { status: "success", count: <appended>, skipped: <duplicates> }
 *   → { status: "error", message: "..." }
 *
 * GAS Web Apps do not expose arbitrary request headers to doPost, so the secret is
 * accepted from the JSON body or a ?secret= query parameter; the X-Gas-Secret header
 * is also honored for runtimes that do expose headers. Fails closed when the script
 * property is unset or the provided secret does not match.
 */

var SHEET_NAME = "TimeEntries";
var HEADER = [
  "Entry ID", "Date", "Customer", "Project", "Activity",
  "Duration (Hours)", "Cost", "Description", "Tags",
];

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Reads the configured secret; empty means "not configured" → fail closed. */
function configuredSecret_() {
  return PropertiesService.getScriptProperties().getProperty("SHARED_SECRET") || "";
}

/** Secret as sent: header (if exposed), ?secret= query param, or body field. */
function providedSecret_(e, payload) {
  if (e && e.headers && e.headers["X-Gas-Secret"]) return String(e.headers["X-Gas-Secret"]);
  if (e && e.parameter && e.parameter.secret) return String(e.parameter.secret);
  if (payload && payload.secret !== undefined && payload.secret !== null) return String(payload.secret);
  return "";
}

/** Maps one Worker entry object onto the sheet's column order. */
function mapRow_(item) {
  return [
    item.id,
    item.log_date,
    item.customer,
    item.project,
    item.activity,
    (Number(item.duration_seconds || 0) / 3600).toFixed(2),
    Number(item.cost || 0),
    item.description || "",
    item.tags || "",
  ];
}

function doPost(e) {
  var secret = configuredSecret_();
  var payload = null;
  try {
    payload = JSON.parse(e && e.postData && e.postData.contents || "{}");
  } catch (err) {
    return jsonResponse_({ status: "error", message: "Invalid JSON body" });
  }

  // T-G3: shared secret - fail closed on unset property or mismatch.
  if (!secret || providedSecret_(e, payload) !== secret) {
    return jsonResponse_({ status: "error", message: "Unauthorized" });
  }

  // T-G1: entries payload from the Worker's /api/sync/google-sheets.
  var entries = payload.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return jsonResponse_({ status: "error", message: "No entries in payload" });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADER);

    // T-G2: dedupe on Entry ID (column A) - pre-read existing ids into a set.
    var existing = {};
    var last = sheet.getLastRow();
    if (last > 1) {
      var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i][0]) existing[String(ids[i][0])] = true;
      }
    }

    var rows = [];
    var skipped = 0;
    for (var j = 0; j < entries.length; j++) {
      var item = entries[j];
      if (!item || !item.id || existing[String(item.id)]) { skipped++; continue; }
      existing[String(item.id)] = true; // also dedupe within a single payload
      rows.push(mapRow_(item));
    }

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
    }

    return jsonResponse_({ status: "success", count: rows.length, skipped: skipped });
  } catch (error) {
    return jsonResponse_({ status: "error", message: String(error && error.message || error) });
  } finally {
    lock.releaseLock();
  }
}
