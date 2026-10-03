/* ═══════════════════════════════════════════════════════════════════
 *  FK Minutes — Picker Training Dashboard (Backend)  ·  v6 (audited)
 *  Google Apps Script — V8 Runtime
 *
 *  Sheets: Raw - Picker (Induction), Raw - Picker (BBD), Mix up Report,
 *          Exits, Completion Daily, Log Error, Mapping
 *
 *  Deploy as Web App:  Execute as = Me · Who has access = Anyone
 *  (re-deploy as a NEW VERSION after pasting this file)
 * ═══════════════════════════════════════════════════════════════════ */

var CONFIG = {
  SHEET_ID: "1iKahNXSOsdzDHf0M8QGez2HQOO2vJuRff8KV439koPM",
  SHEET_RAW_INDUCTION: "Raw - Picker (Induction)",
  SHEET_RAW_BBD: "Raw - Picker (BBD)",
  SHEET_MIXUP: "Mix up Report",
  SHEET_EXITS: "Exits",
  SHEET_LOG_ERROR: "Log Error",
  SHEET_MAPPING: "Mapping",
  SHEET_COMPLETION: "Completion Daily",

  MAX_EXPORT_ROWS: 5000,
  MAX_BATCH_IDS: 500,
  COMPLETION_RETENTION_DAYS: 60,
  LOG_MAX_ROWS: 1000,

  CACHE_PREFIX: "FK_Minutes_v6_",
  CACHE_TTL: 21600,          // 6 h
  CACHE_CHUNK: 30000,        // chars per cache entry (limit is 100 KB / entry)

  // Writes a "Type" column (K) into the raw sheets. It is not used by anything
  // in this script, so it is OFF by default (saves 2 sheet writes every run).
  WRITE_TYPE_COLUMN: false,

  // true = move exported G-Sheets next to the master sheet (adds ~1-2 s per export)
  EXPORT_MOVE_TO_SHEET_FOLDER: false,

  EXIT_REASONS: ["Absconding", "Resigned", "Terminated", "Others"],

  TRAINER_ALIAS: {
    "adarsh thapa": "alu",
    "sarvoday": "bel",
    "soumya ranjan aich": "cel",
    "neha deka": "tel"
  }
};

/* Accepted header names per field (matched ignoring case/spaces/punctuation). */
var HEADER_ALIASES = {
  id:        ["Casper ID", "Employee Code", "Emp Code", "Employee ID"],
  name:      ["Picker Name", "Trained Employee Name", "Employee Name"],
  status:    ["Training Status"],
  wh:        ["Warehouse ID", "WH ID", "Facility ID"],
  assigned:  ["Training Assigned"],
  completed: ["Training Completed"],
  sm:        ["Store Manager"],
  cm:        ["Cluster Manager"],
  trainer:   ["Trainer", "Trainer Name"],
  city:      ["City"],
  ds:        ["Dark Store Name", "Dark Store", "Darkstore", "DS Name", "Store Name", "Store",
              "Warehouse Name", "Facility Name"]
};

var _ssCache = null;

/* ═══════════════════════════════════════════════════════════════════
 *  1. PUBLIC FUNCTIONS (run from editor / triggers / web app)
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Main controller: parses raw sheets, rebuilds "Mix up Report" and appends to
 * "Completion Daily".
 */
function runDataController() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    logError_("runDataController", "Could not acquire script lock", "", "");
    return;
  }

  try {
    var ss = getSpreadsheet_();

    if (CONFIG.WRITE_TYPE_COLUMN) writeTypeColumn_(ss);

    var indMap = buildMapByCasperId_(getSheetData_(CONFIG.SHEET_RAW_INDUCTION));
    var bbdMap = buildMapByCasperId_(getSheetData_(CONFIG.SHEET_RAW_BBD));
    var exitsMap = buildExitsMap_();
    var mapping = loadMapping_();

    /* ── Build Mix up Report ── */
    var allKeys = {};
    Object.keys(indMap).forEach(function (k) { allKeys[k] = true; });
    Object.keys(bbdMap).forEach(function (k) { allKeys[k] = true; });

    var mixHeaders = [
      "Casper ID", "Picker Name", "404 Error", "Induction", "Refresher",
      "Warehouse ID", "Store Manager", "Cluster Manager", "City", "Trainer", "Dark Store Name"
    ];
    var mixRows = [];
    var completionUpdates = [];

    Object.keys(allKeys).forEach(function (key) {
      if (exitsMap[key]) return;                       // exited pickers are skipped

      var indRec = indMap[key], bbdRec = bbdMap[key];
      var base = enrichFromMapping_(mergeRecords_(indRec, bbdRec), mapping);

      var err404 = "All Match";
      if (!indRec && bbdRec) err404 = "Missing in Induction";
      if (indRec && !bbdRec) err404 = "Missing in Refresher";

      var indDone = indRec ? isTrainingCompleted_(indRec.status) : false;
      var bbdDone = bbdRec ? isTrainingCompleted_(bbdRec.status) : false;

      if (!(indDone && bbdDone)) {
        mixRows.push([
          base.cid, base.name, err404,
          indDone ? "Completed" : "Pending",
          bbdDone ? "Completed" : "Pending",
          base.wh, base.sm, base.cm, base.city, base.trainer, base.ds
        ]);
      }

      if (indRec && indDone) completionUpdates.push({ type: "Induction", record: fillBlanks_(indRec, base) });
      if (bbdRec && bbdDone) completionUpdates.push({ type: "Refresher", record: fillBlanks_(bbdRec, base) });
    });

    mixRows.sort(function (a, b) {                     // city → store → name (stable, readable sheet)
      return String(a[8]).localeCompare(String(b[8])) ||
             String(a[10]).localeCompare(String(b[10])) ||
             String(a[1]).localeCompare(String(b[1]));
    });

    /* ── Write Mix up Report ── */
    var sheetMix = getOrCreateSheet_(ss, CONFIG.SHEET_MIXUP);
    sheetMix.clear();
    var out = [mixHeaders].concat(mixRows);
    sheetMix.getRange(1, 1, out.length, mixHeaders.length).setValues(out);
    styleMixupSheet_(sheetMix, out.length, mixHeaders.length);

    /* ── Completion Daily ── */
    updateCompletionDaily_(ss, completionUpdates, exitsMap);

    /* ── Housekeeping ── */
    [CONFIG.SHEET_RAW_INDUCTION, CONFIG.SHEET_RAW_BBD, CONFIG.SHEET_MIXUP, CONFIG.SHEET_COMPLETION]
      .forEach(function (n) { cleanBlankRows_(ss.getSheetByName(n)); });

    invalidateCache_();
  } catch (e) {
    logError_("runDataController", e.message, e.stack, "");
  } finally {
    lock.releaseLock();
  }
}

/** Manually refresh cache and force a sync. */
function manualRefreshCache() {
  invalidateCache_();
  runDataController();
}

/** 4-hourly data sync + daily cleanup. Only touches this project's own triggers. */
function setupTriggers() {
  var mine = { runDataController: true, runDailyCleanup: true };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (mine[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("runDataController").timeBased().everyHours(4).create();
  ScriptApp.newTrigger("runDailyCleanup").timeBased().atHour(3).everyDays(1).create();
}

function manualCleanup() { runDailyCleanup(); }

/** GET — dashboard data. */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action !== "getData") return json_({ error: "Invalid action" });

    var typeFilter = ({ Pending: 1, Completed: 1, All: 1 })[p.type] ? p.type : "Pending";
    var cacheKey = CONFIG.CACHE_PREFIX + typeFilter;

    if (!p.nocache) {
      var cached = getChunkedCache_(cacheKey);
      if (cached) return text_(cached);
    }

    var data = getSheetData_(CONFIG.SHEET_MIXUP);
    var result = [];
    if (data.length > 1) {
      var h = data[0];
      var ix = {
        id: getColumnIndex_(h, ["Casper ID"]),   nm: getColumnIndex_(h, ["Picker Name"]),
        e404: getColumnIndex_(h, ["404 Error"]), ind: getColumnIndex_(h, ["Induction"]),
        ref: getColumnIndex_(h, ["Refresher"]),  wh: getColumnIndex_(h, ["Warehouse ID"]),
        sm: getColumnIndex_(h, ["Store Manager"]), cm: getColumnIndex_(h, ["Cluster Manager"]),
        ct: getColumnIndex_(h, ["City"]),        tn: getColumnIndex_(h, ["Trainer"]),
        ds: getColumnIndex_(h, ["Dark Store Name"])
      };
      var cell = function (row, i) { return i === -1 || row[i] == null ? "" : row[i]; };

      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (!cell(row, ix.id)) continue;
        var indVal = String(cell(row, ix.ind)), refVal = String(cell(row, ix.ref));
        var isPending = indVal === "Pending" || refVal === "Pending";
        var isCompleted = indVal === "Completed" && refVal === "Completed";
        if (typeFilter === "Pending" && !isPending) continue;
        if (typeFilter === "Completed" && !isCompleted) continue;

        result.push({
          id: cell(row, ix.id), nm: cell(row, ix.nm), ind: indVal, ref: refVal,
          e404: cell(row, ix.e404), ds: cell(row, ix.ds), ct: cell(row, ix.ct),
          sm: cell(row, ix.sm), cm: cell(row, ix.cm), tn: cell(row, ix.tn), wh: cell(row, ix.wh)
        });
      }
    }

    var jsonOut = JSON.stringify(result);
    putChunkedCache_(cacheKey, jsonOut, CONFIG.CACHE_TTL);
    return text_(jsonOut);
  } catch (err) {
    logError_("doGet", err.message, err.stack, JSON.stringify(e || {}));
    return json_({ error: String(err) });
  }
}

/** POST — exits & exports. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json_({ error: "Empty request body" });

    var payload;
    try { payload = JSON.parse(e.postData.contents.trim()); }
    catch (parseErr) { return json_({ error: "Invalid JSON" }); }

    var action = payload.action;

    // Export is slow (Drive + Sheets). It must NOT hold the script lock, otherwise
    // every exit / data-sync would queue behind it and time out.
    if (action === "export") return json_(handleExport_(payload));

    if (action !== "report" && action !== "batch_report") return json_({ error: "Unknown action" });

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ error: "Server busy, try again" });
    var result;
    try {
      result = action === "report" ? handleReport_(payload) : handleBatchReport_(payload);
      if (result.status === "Success") invalidateCache_();
    } finally {
      lock.releaseLock();
    }
    return json_(result);
  } catch (err) {
    logError_("doPost", err.message, err.stack, "");
    return json_({ error: String(err) });
  }
}

/** Daily: trash temporary export files older than 24 h. */
function runDailyCleanup() {
  var props = PropertiesService.getScriptProperties();
  var files = readTrackedFiles_(props);
  if (!files.length) return;
  var now = Date.now(), DAY = 24 * 60 * 60 * 1000, keep = [];
  files.forEach(function (f) {
    if (now - f.t > DAY) { try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e) { /* already gone */ } }
    else keep.push(f);
  });
  props.setProperty("FILES_TO_DELETE", JSON.stringify(keep));
}

/* ═══════════════════════════════════════════════════════════════════
 *  2. RESPONSE / SHEET HELPERS
 * ═══════════════════════════════════════════════════════════════════ */

function json_(obj) { return text_(JSON.stringify(obj)); }
function text_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON); }

function getSpreadsheet_() {
  if (_ssCache) return _ssCache;
  try { var a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return (_ssCache = a); } catch (e) { /* standalone */ }
  return (_ssCache = SpreadsheetApp.openById(CONFIG.SHEET_ID));
}

/** Plain SpreadsheetApp read — consistent types (Date objects) and no A1-quoting pitfalls. */
function getSheetData_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) return [];
  var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  return sheet.getRange(1, 1, lr, lc).getValues();
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function norm_(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function getColumnIndex_(headers, names) {
  if (!headers || !Array.isArray(names)) return -1;
  for (var n = 0; n < names.length; n++) {
    var t = norm_(names[n]);
    for (var i = 0; i < headers.length; i++) if (norm_(headers[i]) === t) return i;
  }
  return -1;
}

/** Exact aliases first, then a loose "header contains X but not Y" fallback. */
function getColumnLoose_(headers, names, mustContain, mustNotContain) {
  var idx = getColumnIndex_(headers, names);
  if (idx !== -1) return idx;
  for (var i = 0; i < headers.length; i++) {
    var h = norm_(headers[i]);
    if (!h) continue;
    var ok = mustContain.some(function (c) { return h.indexOf(c) !== -1; });
    var bad = mustNotContain.some(function (c) { return h.indexOf(c) !== -1; });
    if (ok && !bad) return i;
  }
  return -1;
}

/** Key used for matching a picker across sheets ("CA42534" ≡ "42534"). Display value is untouched. */
function normalizeId_(v) {
  var s = String(v == null ? "" : v).trim().replace(/\.0+$/, "");
  var m = s.match(/^ca[\s\-]*(\d+)$/i);
  return m ? m[1] : s;
}

/** Stops sheet-formula injection from user-supplied text. */
function safeCell_(v) {
  var s = v == null ? "" : String(v);
  return /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
}

function parseDate_(v) {
  if (v === "" || v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);          // dd/mm/yyyy (India)
  if (m) {
    var y = parseInt(m[3], 10); if (y < 100) y += 2000;
    var d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  var d2 = new Date(s);
  return isNaN(d2.getTime()) ? null : d2;
}

function logError_(source, message, stack, details) {
  try {
    var sheet = getOrCreateSheet_(getSpreadsheet_(), CONFIG.SHEET_LOG_ERROR);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Source", "Error Message", "Stack Trace", "Details"]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f3f3f3");
    }
    sheet.appendRow([new Date(), source || "", message || "", stack || "", details || ""]);
    var lr = sheet.getLastRow();
    if (lr > CONFIG.LOG_MAX_ROWS) sheet.deleteRows(2, lr - CONFIG.LOG_MAX_ROWS + Math.floor(CONFIG.LOG_MAX_ROWS / 2));
  } catch (e) { console.error("logError_ failed: " + e.message); }
}

function cleanBlankRows_(sheet) {
  if (!sheet) return;
  var maxRows = sheet.getMaxRows(), lastRow = sheet.getLastRow();
  if (lastRow > 0 && maxRows > lastRow) sheet.deleteRows(lastRow + 1, maxRows - lastRow);
}

function styleMixupSheet_(sheet, rowCount, colCount) {
  sheet.getRange(1, 1, rowCount, colCount)
    .setBorder(true, true, true, true, true, true, null, SpreadsheetApp.BorderStyle.DOUBLE)
    .setHorizontalAlignment("center");
  sheet.getRange(1, 1, 1, colCount).setBackground("yellow").setFontWeight("bold");
  sheet.setColumnWidths(1, colCount, 150);
}

function writeTypeColumn_(ss) {
  [[CONFIG.SHEET_RAW_INDUCTION, "Induction"], [CONFIG.SHEET_RAW_BBD, "Refresher"]].forEach(function (p) {
    var sh = ss.getSheetByName(p[0]);
    if (!sh) return;
    var lr = sh.getLastRow();
    if (lr < 1) return;
    var vals = [["Type"]];
    for (var i = 1; i < lr; i++) vals.push([p[1]]);
    sh.getRange(1, 11, lr, 1).setValues(vals);
  });
}

/* ═══════════════════════════════════════════════════════════════════
 *  3. CACHE (chunked)
 * ═══════════════════════════════════════════════════════════════════ */

function getChunkedCache_(key) {
  try {
    var cache = CacheService.getScriptCache(), meta = cache.get(key);
    if (!meta) return null;
    if (meta.indexOf("CHUNKED:") !== 0) return meta;
    var n = parseInt(meta.substring(8), 10), keys = [];
    for (var i = 0; i < n; i++) keys.push(key + "_" + i);
    var parts = cache.getAll(keys), out = "";
    for (var j = 0; j < n; j++) {
      var c = parts[key + "_" + j];
      if (c == null) return null;                    // one chunk expired → treat as miss
      out += c;
    }
    return out;
  } catch (e) { return null; }
}

function putChunkedCache_(key, value, ttl) {
  var cache = CacheService.getScriptCache(), size = CONFIG.CACHE_CHUNK;
  try {
    if (value.length <= size) { cache.put(key, value, ttl); return; }
    var n = Math.ceil(value.length / size), obj = {};
    for (var i = 0; i < n; i++) obj[key + "_" + i] = value.substring(i * size, (i + 1) * size);
    obj[key] = "CHUNKED:" + n;
    cache.putAll(obj, ttl);
  } catch (e) { /* cache is best-effort */ }
}

function invalidateCache_() {
  var cache = CacheService.getScriptCache();
  ["Pending", "Completed", "All"].forEach(function (t) {
    var key = CONFIG.CACHE_PREFIX + t, keys = [key];
    try {
      var meta = cache.get(key);
      if (meta && meta.indexOf("CHUNKED:") === 0) {
        for (var i = 0; i < parseInt(meta.substring(8), 10); i++) keys.push(key + "_" + i);
      }
    } catch (e) { /* ignore */ }
    try { cache.removeAll(keys); } catch (e2) { /* ignore */ }
  });
}

/* ═══════════════════════════════════════════════════════════════════
 *  4. DATA PARSING
 * ═══════════════════════════════════════════════════════════════════ */

function isTrainingCompleted_(status) {
  if (!status) return false;
  var s = String(status).toLowerCase().trim();
  return s === "completed" || s === "certified" || s === "trained" || s === "done" || s === "pass" || s === "passed";
}

function getTrainerAlias_(name) {
  if (!name) return "";
  return CONFIG.TRAINER_ALIAS[String(name).toLowerCase().trim()] || String(name).trim();
}

function resolveColumns_(h) {
  return {
    id:        getColumnIndex_(h, HEADER_ALIASES.id),
    name:      getColumnIndex_(h, HEADER_ALIASES.name),
    status:    getColumnIndex_(h, HEADER_ALIASES.status),
    wh:        getColumnIndex_(h, HEADER_ALIASES.wh),
    assigned:  getColumnIndex_(h, HEADER_ALIASES.assigned),
    completed: getColumnIndex_(h, HEADER_ALIASES.completed),
    sm:        getColumnIndex_(h, HEADER_ALIASES.sm),
    cm:        getColumnIndex_(h, HEADER_ALIASES.cm),
    trainer:   getColumnIndex_(h, HEADER_ALIASES.trainer),
    city:      getColumnIndex_(h, HEADER_ALIASES.city),
    ds:        getColumnLoose_(h, HEADER_ALIASES.ds, ["darkstore", "store", "warehousename", "facilityname"],
                               ["manager", "id", "code"]),
    rawStatus: getColumnIndex_(h, ["Status", "Employee Status", "Exit Status"])
  };
}

function buildMapByCasperId_(data) {
  var map = {};
  if (!data || data.length < 2) return map;
  var c = resolveColumns_(data[0]);
  if (c.id === -1) return map;

  var str = function (row, i) { return i > -1 && row[i] != null ? String(row[i]).trim() : ""; };

  for (var i = 1; i < data.length; i++) {
    var row = data[i], rawId = str(row, c.id), key = normalizeId_(rawId);
    if (!key) continue;
    if (c.rawStatus !== -1) {
      var rs = str(row, c.rawStatus).toLowerCase();
      if (rs === "exit" || rs === "exited") continue;
    }
    var rec = {
      cid: rawId, name: str(row, c.name), status: str(row, c.status), wh: str(row, c.wh),
      assigned: c.assigned > -1 ? row[c.assigned] : "", completed: c.completed > -1 ? row[c.completed] : "",
      sm: str(row, c.sm), cm: str(row, c.cm), trainer: str(row, c.trainer),
      city: str(row, c.city), ds: str(row, c.ds)
    };
    // duplicate rows: never let a "pending" row overwrite a "completed" one
    var prev = map[key];
    if (prev && isTrainingCompleted_(prev.status) && !isTrainingCompleted_(rec.status)) continue;
    map[key] = rec;
  }
  return map;
}

function buildExitsMap_() {
  var map = {}, data = getSheetData_(CONFIG.SHEET_EXITS);
  if (data.length < 2) return map;
  var idx = getColumnIndex_(data[0], ["Casper ID", "Employee Code"]);
  if (idx === -1) return map;
  for (var i = 1; i < data.length; i++) {
    var k = normalizeId_(data[i][idx]);
    if (k) map[k] = true;
  }
  return map;
}

/** Optional lookup sheet: Warehouse ID → Dark Store / City / SM / CM / Trainer. */
function loadMapping_() {
  var out = {}, data = getSheetData_(CONFIG.SHEET_MAPPING);
  if (data.length < 2) return out;
  var h = data[0], c = resolveColumns_(h);
  if (c.wh === -1) return out;
  var str = function (row, i) { return i > -1 && row[i] != null ? String(row[i]).trim() : ""; };
  for (var i = 1; i < data.length; i++) {
    var key = norm_(data[i][c.wh]);
    if (!key) continue;
    out[key] = { ds: str(data[i], c.ds), city: str(data[i], c.city), sm: str(data[i], c.sm),
                 cm: str(data[i], c.cm), trainer: str(data[i], c.trainer) };
  }
  return out;
}

var FILL_FIELDS_ = ["name", "wh", "sm", "cm", "trainer", "city", "ds"];

function mergeRecords_(a, b) {
  var out = { cid: "", name: "", wh: "", sm: "", cm: "", trainer: "", city: "", ds: "" };
  [a, b].forEach(function (r) {
    if (!r) return;
    if (!out.cid) out.cid = r.cid;
    FILL_FIELDS_.forEach(function (f) { if (!out[f] && r[f]) out[f] = r[f]; });
  });
  return out;
}

function enrichFromMapping_(rec, mapping) {
  var m = rec.wh ? mapping[norm_(rec.wh)] : null;
  if (m) ["ds", "city", "sm", "cm", "trainer"].forEach(function (f) { if (!rec[f] && m[f]) rec[f] = m[f]; });
  return rec;
}

function fillBlanks_(rec, base) {
  var out = {};
  Object.keys(rec).forEach(function (k) { out[k] = rec[k]; });
  FILL_FIELDS_.forEach(function (f) { if (!out[f] && base[f]) out[f] = base[f]; });
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
 *  5. COMPLETION DAILY
 * ═══════════════════════════════════════════════════════════════════ */

function updateCompletionDaily_(ss, updates, exitsMap) {
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEET_COMPLETION);
  var headers = ["Employee Code", "Trained Employee Name", "Training Status", "Warehouse ID",
                 "Training Assigned", "Training Completed", "Store Manager", "Cluster Manager",
                 "Trainer", "City", "Type", "Dark Store Name", "Is the picker active?"];

  var data = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
  if (!data.length || String(data[0][0]).trim() === "") data = [headers];

  var head = data[0];
  var idxCode = getColumnIndex_(head, ["Employee Code", "Casper ID"]);
  var idxType = getColumnIndex_(head, ["Type"]);
  var idxTc = getColumnIndex_(head, ["Training Completed"]);
  var idxAct = getColumnIndex_(head, ["Is the picker active?"]);
  if (idxCode === -1 || idxType === -1) {
    logError_("updateCompletionDaily_", "Completion Daily header missing 'Employee Code' or 'Type' – skipped", "", "");
    return;
  }

  var width = Math.max(head.length, headers.length);
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.COMPLETION_RETENTION_DAYS);

  var rows = [], existing = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i].slice();
    while (row.length < width) row.push("");
    if (idxTc !== -1) {
      var d = parseDate_(row[idxTc]);
      if (d && d.getTime() < cutoff.getTime()) continue;            // retention
    }
    var key = normalizeId_(row[idxCode]);
    if (!key) continue;
    if (idxAct !== -1 && exitsMap[key]) row[idxAct] = "No";
    rows.push(row);
    existing[key + "_" + String(row[idxType]).trim()] = true;
  }

  var hdrNorm = head.map(norm_);
  updates.forEach(function (u) {
    var rec = u.record, key = normalizeId_(rec.cid) + "_" + u.type;
    if (existing[key]) return;
    var done = parseDate_(rec.completed);
    if (done && done.getTime() < cutoff.getTime()) return;          // don't resurrect expired rows

    var vals = {};
    vals[norm_("Employee Code")] = rec.cid;
    vals[norm_("Trained Employee Name")] = rec.name;
    vals[norm_("Training Status")] = rec.status;
    vals[norm_("Warehouse ID")] = rec.wh;
    vals[norm_("Training Assigned")] = parseDate_(rec.assigned) || rec.assigned || "";
    vals[norm_("Training Completed")] = done || rec.completed || "";
    vals[norm_("Store Manager")] = rec.sm;
    vals[norm_("Cluster Manager")] = rec.cm;
    vals[norm_("Trainer")] = getTrainerAlias_(rec.trainer);
    vals[norm_("City")] = rec.city;
    vals[norm_("Type")] = u.type;
    vals[norm_("Dark Store Name")] = rec.ds;
    vals[norm_("Is the picker active?")] = exitsMap[normalizeId_(rec.cid)] ? "No" : "Yes";

    var row = [];
    for (var c = 0; c < width; c++) row.push(hdrNorm[c] && vals.hasOwnProperty(hdrNorm[c]) ? vals[hdrNorm[c]] : "");
    rows.push(row);
    existing[key] = true;
  });

  var headRow = head.slice();
  while (headRow.length < width) headRow.push("");
  var all = [headRow].concat(rows);
  sheet.clear();
  sheet.getRange(1, 1, all.length, width).setValues(all);
  sheet.getRange(1, 1, 1, width).setFontWeight("bold").setBackground("#f3f3f3").setHorizontalAlignment("center");
  if (idxTc !== -1 && all.length > 1) sheet.getRange(2, idxTc + 1, all.length - 1, 1).setNumberFormat("dd/mm/yyyy");
}

/* ═══════════════════════════════════════════════════════════════════
 *  6. EXITS (single + batch share one idempotent implementation)
 * ═══════════════════════════════════════════════════════════════════ */

function cleanReason_(r) {
  r = String(r || "").trim();
  return CONFIG.EXIT_REASONS.indexOf(r) !== -1 ? r : "Others";
}

function handleReport_(payload) {
  var id = String(payload.id || "").trim();
  if (!id) return { error: "ID missing" };
  var fb = {}; fb[normalizeId_(id)] = { city: payload.c, ds: payload.ds, name: payload.n };
  processExits_([id], {}, cleanReason_(payload.reason), fb);
  return { status: "Success", message: "Record updated" };
}

function handleBatchReport_(payload) {
  var ids = payload.ids;
  if (!Array.isArray(ids) || !ids.length) return { error: "No IDs provided" };
  if (ids.length > CONFIG.MAX_BATCH_IDS) return { error: "Too many IDs (max " + CONFIG.MAX_BATCH_IDS + ")" };
  processExits_(ids, payload.reasons || {}, cleanReason_(payload.reason), {});
  return { status: "Success", message: "Batch exited successfully" };
}

function processExits_(ids, reasons, defaultReason, fallback) {
  var ss = getSpreadsheet_();
  var sheetMix = getOrCreateSheet_(ss, CONFIG.SHEET_MIXUP);
  var sheetExits = getOrCreateSheet_(ss, CONFIG.SHEET_EXITS);

  var wanted = {};
  ids.forEach(function (id) { var k = normalizeId_(id); if (k) wanted[k] = String(id).trim(); });

  if (sheetExits.getLastRow() === 0) {
    sheetExits.appendRow(["City", "Dark Store Name", "Picker Name", "Casper ID", "Reason"]);
    sheetExits.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f3f3f3");
  }

  var already = buildExitsMap_();                 // idempotent: a retried request never duplicates a row
  var info = {}, toDelete = [];

  var lr = sheetMix.getLastRow();
  if (lr > 1) {
    var vals = sheetMix.getRange(1, 1, lr, sheetMix.getLastColumn()).getValues();
    var h = vals[0];
    var iId = getColumnIndex_(h, ["Casper ID"]), iNm = getColumnIndex_(h, ["Picker Name"]);
    var iDs = getColumnIndex_(h, ["Dark Store Name"]), iCt = getColumnIndex_(h, ["City"]);
    if (iId !== -1) {
      for (var i = 1; i < vals.length; i++) {
        var k = normalizeId_(vals[i][iId]);
        if (wanted[k]) {
          info[k] = { city: vals[i][iCt], ds: vals[i][iDs], name: vals[i][iNm] };
          toDelete.push(i + 1);
        }
      }
    }
  }
  deleteRowsDescending_(sheetMix, toDelete);

  var newRows = [];
  Object.keys(wanted).forEach(function (k) {
    if (already[k]) return;
    var src = info[k] || fallback[k] || {};
    newRows.push([safeCell_(src.city), safeCell_(src.ds), safeCell_(src.name), wanted[k],
                  cleanReason_(reasons[wanted[k]] || defaultReason)]);
  });
  if (newRows.length) {
    sheetExits.getRange(sheetExits.getLastRow() + 1, 1, newRows.length, 5).setValues(newRows);
  }
  markPickerInactive_(ss, Object.keys(wanted));
}

function deleteRowsDescending_(sheet, rows) {
  if (!rows.length) return;
  rows.sort(function (a, b) { return b - a; });
  var start = rows[0], count = 1;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i] === start - 1) { start = rows[i]; count++; }
    else { sheet.deleteRows(start, count); start = rows[i]; count = 1; }
  }
  sheet.deleteRows(start, count);
}

function markPickerInactive_(ss, keys) {
  var sheet = ss.getSheetByName(CONFIG.SHEET_COMPLETION);
  if (!sheet || sheet.getLastRow() < 2) return;
  var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  var head = sheet.getRange(1, 1, 1, lc).getValues()[0];
  var iId = getColumnIndex_(head, ["Employee Code", "Casper ID"]);
  var iAct = getColumnIndex_(head, ["Is the picker active?"]);
  if (iId === -1 || iAct === -1) return;

  var set = {}; keys.forEach(function (k) { set[k] = true; });
  var ids = sheet.getRange(2, iId + 1, lr - 1, 1).getValues();
  var act = sheet.getRange(2, iAct + 1, lr - 1, 1).getValues();
  var changed = false;
  for (var i = 0; i < ids.length; i++) {
    if (set[normalizeId_(ids[i][0])] && String(act[i][0]).trim() !== "No") { act[i][0] = "No"; changed = true; }
  }
  if (changed) sheet.getRange(2, iAct + 1, act.length, 1).setValues(act);   // only the one column
}

/* ═══════════════════════════════════════════════════════════════════
 *  7. G-SHEET EXPORT
 * ═══════════════════════════════════════════════════════════════════ */

function handleExport_(payload) {
  var name = String(payload.f || "Exported_Data").replace(/[^\w\- ]/g, "_").substring(0, 80) || "Exported_Data";
  var newSs;
  try {
    newSs = SpreadsheetApp.create(name);
    var id = newSs.getId();
    trackFileForDeletion_(id);                    // tracked first, so even a half-finished export is cleaned up

    var summary = newSs.getSheets()[0];
    summary.setName("CMSM Summary");
    formatAndPopulateSheet_(summary, payload.summaryData);
    formatAndPopulateSheet_(newSs.insertSheet("Detailed"), payload.detailData, CONFIG.MAX_EXPORT_ROWS + 1);
    createLoginGuideSheet_(newSs);
    newSs.setActiveSheet(newSs.getSheetByName("Detailed") || summary);
    SpreadsheetApp.flush();

    var file = DriveApp.getFileById(id);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e1) { logError_("handleExport_.share", e1.message, "", name); }

    if (CONFIG.EXPORT_MOVE_TO_SHEET_FOLDER) {
      try {
        var parents = DriveApp.getFileById(getSpreadsheet_().getId()).getParents();
        if (parents.hasNext()) file.moveTo(parents.next());
      } catch (e2) { logError_("handleExport_.move", e2.message, "", name); }
    }
    return { url: newSs.getUrl() };
  } catch (err) {
    logError_("handleExport_", err.message, err.stack, name);
    return { error: String(err) };
  }
}

function formatAndPopulateSheet_(sheet, dataArray, maxRows) {
  if (!Array.isArray(dataArray) || !dataArray.length) return;
  var rows = dataArray.slice(0, maxRows || dataArray.length)
    .filter(function (r) { return Array.isArray(r); })
    .map(function (r) { return r.map(function (c) { return c == null ? "" : safeCell_(c); }); })
    .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
  if (!rows.length) return;

  var cols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  rows.forEach(function (r) { while (r.length < cols) r.push(""); });   // ragged rows would throw

  sheet.getRange(1, 1, rows.length, cols).setValues(rows).setHorizontalAlignment("center");
  sheet.getRange(1, 1, 1, cols).setFontWeight("bold").setBackground("#d9ead3");
  sheet.setColumnWidths(1, cols, 150);            // fixed widths: autoResizeColumns is very slow
  sheet.setFrozenRows(1);
}

function createLoginGuideSheet_(ss) {
  var sheet = ss.insertSheet("Login Guide");
  var g = [
    ["Login Guide for Picker", ""],
    ["Step", "Details"],
    ["1. Download App", "Download the Disprz App (Blue one)"],
    ["   Play Store", "https://play.google.com/store/apps/details?id=com.disprz"],
    ["   App Store", "https://apps.apple.com/in/app/disprz/id1458716803"],
    ["2. Org URL", "edl.disprz.com"],
    ["3. Username", "Your Casper ID (e.g. 42534) without ca."],
    ["4. Password", "Edl@123"],
    ["Flipkart Minutes \u2014 East L&D", ""]
  ];
  sheet.getRange(1, 1, g.length, 2).setValues(g).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.getRange(1, 1, 1, 2).merge().setFontSize(16).setFontWeight("bold").setFontColor("#2874F0");
  sheet.getRange(2, 1, 1, 2).setFontWeight("bold").setBackground("#d9ead3");
  sheet.getRange(6, 1, 3, 2).setBackground("#fce4ec").setFontWeight("bold").setFontColor("#000000");   // org url / username / password
  sheet.getRange(g.length, 1, 1, 2).merge().setFontSize(10).setFontColor("#64748b").setFontStyle("italic");
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 400);
}

function readTrackedFiles_(props) {
  try {
    var raw = props.getProperty("FILES_TO_DELETE");
    var arr = raw ? JSON.parse(raw) : [];
    return arr.map(function (f) { return { id: f.id, t: f.t || f.timestamp || 0 }; });
  } catch (e) { return []; }
}

function trackFileForDeletion_(fileId) {
  var lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
    var props = PropertiesService.getScriptProperties(), files = readTrackedFiles_(props);
    files.push({ id: fileId, t: Date.now() });
    // Script properties are capped at ~9 KB: trash the oldest immediately instead of failing
    while (JSON.stringify(files).length > 8500 && files.length > 1) {
      var old = files.shift();
      try { DriveApp.getFileById(old.id).setTrashed(true); } catch (e) { /* ignore */ }
    }
    props.setProperty("FILES_TO_DELETE", JSON.stringify(files));
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* lock not held */ }
  }
}
