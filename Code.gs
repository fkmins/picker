/* ═══════════════════════════════════════════════════════════════════
 *  FK Minutes — Picker Training Dashboard (Backend)
 *  Google Apps Script — V8 Runtime
 *  
 *  Sheets: Raw-Picker(Induction), Raw-Picker(BBD), Mix up Report,
 *          Exits, Completion Daily, Log Error, Mapping
 *
 *  Manual-run functions:
 *    runDataController()   — sync data now
 *    setupTriggers()       — create / overwrite auto-triggers
 *    manualRefreshCache()  — invalidate cache + sync
 *    manualCleanup()       — trash old exported files
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
  COMPLETION_RETENTION_DAYS: 60,
  TRAINER_ALIAS: {
    "adarsh thapa": "alu",
    "sarvoday": "bel",
    "soumya ranjan aich": "cel",
    "neha deka": "tel"
  }
};

/* ══════════════════════════════════════
 *  1. SPREADSHEET ACCESS
 * ══════════════════════════════════════ */

function getSpreadsheet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) { /* not in bound context */ }
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function getSheetData_(sheetName) {
  try {
    if (typeof Sheets !== "undefined" && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
      var response = Sheets.Spreadsheets.Values.get(CONFIG.SHEET_ID, sheetName);
      return response.values || [];
    }
  } catch (e) { /* Sheets API not enabled — fall back */ }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) return [];
  return sheet.getDataRange().getValues();
}

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

/* ══════════════════════════════════════
 *  2. COLUMN FINDER
 * ══════════════════════════════════════ */

function getColumnIndex_(headers, possibleNames) {
  if (!headers || !Array.isArray(possibleNames)) return -1;
  var norm = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); };
  for (var n = 0; n < possibleNames.length; n++) {
    var t = norm(possibleNames[n]);
    for (var i = 0; i < headers.length; i++) {
      if (norm(headers[i]) === t) return i;
    }
  }
  return -1;
}

/* ══════════════════════════════════════
 *  3. ERROR LOGGING
 * ══════════════════════════════════════ */

function logError_(source, message, stack, details) {
  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet_(ss, CONFIG.SHEET_LOG_ERROR);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Source", "Error Message", "Stack Trace", "Details"]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f3f3f3");
    }
    sheet.appendRow([new Date(), source || "", message || "", stack || "", details || ""]);
  } catch (e) {
    console.error("logError_ failed: " + e.message);
  }
}

/* ══════════════════════════════════════
 *  4. CACHE HELPERS
 * ══════════════════════════════════════ */

function getChunkedCache_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = cache.get(key);
    if (!meta) return null;
    var parsed;
    try { parsed = JSON.parse(meta); } catch (e) { return meta; }
    if (parsed && parsed.chunked) {
      var fullStr = "";
      for (var i = 0; i < parsed.count; i++) {
        var chunk = cache.get(key + "_" + i);
        if (!chunk) return null;
        fullStr += chunk;
      }
      return fullStr;
    }
    return meta;
  } catch (e) { return null; }
}

function putChunkedCache_(key, value, ttl) {
  var cache = CacheService.getScriptCache();
  var chunkSize = 40000;
  if (value.length <= chunkSize) {
    try { cache.put(key, value, ttl); } catch (e) { }
    return;
  }
  var chunks = Math.ceil(value.length / chunkSize);
  var cacheObj = {};
  cacheObj[key] = JSON.stringify({ chunked: true, count: chunks });
  for (var i = 0; i < chunks; i++) {
    cacheObj[key + "_" + i] = value.substring(i * chunkSize, (i + 1) * chunkSize);
  }
  try { cache.putAll(cacheObj, ttl); } catch (e) { }
}

function invalidateCache_() {
  var cache = CacheService.getScriptCache();
  var keys = [
    "FK_Minutes_v5_Pending", "FK_Minutes_v5_Completed", "FK_Minutes_v5_All"
  ];
  try { cache.removeAll(keys); } catch (e) {
    keys.forEach(function (k) { try { cache.remove(k); } catch (e2) { } });
  }
  // Also remove chunked fragments
  for (var i = 0; i < 15; i++) {
    try {
      cache.remove("FK_Minutes_v5_Pending_" + i);
      cache.remove("FK_Minutes_v5_Completed_" + i);
      cache.remove("FK_Minutes_v5_All_" + i);
    } catch (e) { }
  }
}

/* ══════════════════════════════════════
 *  5. HELPER UTILITIES
 * ══════════════════════════════════════ */

function isTrainingCompleted_(status) {
  if (!status) return false;
  var s = String(status).toLowerCase().trim();
  return (s === "completed" || s === "certified" || s === "trained" ||
          s === "done" || s === "pass" || s === "passed");
}

function formatDateDDMMYYYY_(dateVal) {
  if (!dateVal) return "";
  var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  var dd = String(d.getDate()).padStart(2, "0");
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  return dd + "/" + mm + "/" + d.getFullYear();
}

function getTrainerAlias_(name) {
  if (!name) return "";
  var lower = String(name).toLowerCase().trim();
  return CONFIG.TRAINER_ALIAS[lower] || String(name).trim();
}

function cleanBlankRows_(sheet) {
  if (!sheet) return;
  var maxRows = sheet.getMaxRows();
  var lastRow = sheet.getLastRow();
  if (maxRows > lastRow && lastRow > 0) {
    sheet.deleteRows(lastRow + 1, maxRows - lastRow);
  }
}

/* ══════════════════════════════════════
 *  6. BUILD CASPER-ID MAP FROM RAW SHEET
 * ══════════════════════════════════════ */

function buildMapByCasperId_(data) {
  var map = {};
  if (!data || data.length < 2) return map;
  var h = data[0];

  var idxId = getColumnIndex_(h, ["Casper ID", "casperid", "Employee Code"]);
  if (idxId === -1) return map;

  var idxNm = getColumnIndex_(h, ["Picker Name", "pickername", "Trained Employee Name"]);
  var idxSt = getColumnIndex_(h, ["Training Status", "trainingstatus"]);
  var idxWh = getColumnIndex_(h, ["Warehouse ID", "warehouseid"]);
  var idxTa = getColumnIndex_(h, ["Training Assigned", "trainingassigned"]);
  var idxTc = getColumnIndex_(h, ["Training Completed", "trainingcompleted"]);
  var idxSm = getColumnIndex_(h, ["Store Manager", "storemanager"]);
  var idxCm = getColumnIndex_(h, ["Cluster Manager", "clustermanager"]);
  var idxTr = getColumnIndex_(h, ["Trainer", "trainer name", "trainername"]);
  var idxCt = getColumnIndex_(h, ["City"]);
  var idxTy = getColumnIndex_(h, ["Type"]);
  var idxDs = getColumnIndex_(h, ["Dark Store Name", "darkstorename", "Store Name", "storename"]);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = String(row[idxId] || "").trim();
    if (!id) continue;

    /* skip rows whose employee status is exit/exited */
    var rawStatIdx = getColumnIndex_(h, ["status", "employee status", "exit status"]);
    if (rawStatIdx !== -1) {
      var rs = String(row[rawStatIdx] || "").trim().toLowerCase();
      if (rs === "exit" || rs === "exited") continue;
    }

    map[id] = {
      cid:       id,
      name:      idxNm > -1 ? String(row[idxNm] || "").trim() : "",
      status:    idxSt > -1 ? String(row[idxSt] || "").trim() : "",
      wh:        idxWh > -1 ? String(row[idxWh] || "").trim() : "",
      assigned:  idxTa > -1 ? row[idxTa] : "",
      completed: idxTc > -1 ? row[idxTc] : "",
      sm:        idxSm > -1 ? String(row[idxSm] || "").trim() : "",
      cm:        idxCm > -1 ? String(row[idxCm] || "").trim() : "",
      trainer:   idxTr > -1 ? String(row[idxTr] || "").trim() : "",
      city:      idxCt > -1 ? String(row[idxCt] || "").trim() : "",
      type:      idxTy > -1 ? String(row[idxTy] || "").trim() : "",
      ds:        idxDs > -1 ? String(row[idxDs] || "").trim() : ""
    };
  }
  return map;
}

/* ══════════════════════════════════════
 *  7. ICC — MAIN DATA CONTROLLER
 *     (runs every 4 hours via trigger)
 * ══════════════════════════════════════ */

function runDataController() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    logError_("runDataController", "Could not acquire script lock", null, null);
    return;
  }

  try {
    var ss = getSpreadsheet();

    /* ── Step 1 : Insert Type column ── */
    var sheetInd = ss.getSheetByName(CONFIG.SHEET_RAW_INDUCTION);
    var sheetBbd = ss.getSheetByName(CONFIG.SHEET_RAW_BBD);

    if (sheetInd) {
      var lr = sheetInd.getLastRow();
      if (lr > 1) {
        var vals = [];
        for (var i = 0; i < lr - 1; i++) vals.push(["Induction"]);
        sheetInd.getRange(2, 11, lr - 1, 1).setValues(vals);   // col K = 11
      }
    }
    if (sheetBbd) {
      var lr2 = sheetBbd.getLastRow();
      if (lr2 > 1) {
        var vals2 = [];
        for (var j = 0; j < lr2 - 1; j++) vals2.push(["Refresher"]);
        sheetBbd.getRange(2, 11, lr2 - 1, 1).setValues(vals2);
      }
    }

    /* ── Step 2 : Parse both sheets ── */
    var indData = getSheetData_(CONFIG.SHEET_RAW_INDUCTION);
    var bbdData = getSheetData_(CONFIG.SHEET_RAW_BBD);
    var indMap  = buildMapByCasperId_(indData);
    var bbdMap  = buildMapByCasperId_(bbdData);

    /* ── Step 3 : Read exits ── */
    var exitsData = getSheetData_(CONFIG.SHEET_EXITS);
    var exitsMap  = {};
    if (exitsData && exitsData.length > 1) {
      var eHeaders = exitsData[0];
      var eIdIdx   = getColumnIndex_(eHeaders, ["Casper ID", "casper id"]);
      if (eIdIdx !== -1) {
        for (var ei = 1; ei < exitsData.length; ei++) {
          var eid = String(exitsData[ei][eIdIdx] || "").trim();
          if (eid) exitsMap[eid] = true;
        }
      }
    }

    /* ── Step 4 : Build Mix up Report ── */
    var allIds = {};
    Object.keys(indMap).forEach(function (k) { allIds[k] = true; });
    Object.keys(bbdMap).forEach(function (k) { allIds[k] = true; });

    var mixHeaders = [
      "Casper ID", "Picker Name", "404 Error", "Induction", "Refresher",
      "Warehouse ID", "Store Manager", "Cluster Manager", "City", "Trainer", "Dark Store Name"
    ];
    var mixRows = [mixHeaders];
    var completionUpdates = [];

    for (var cid in allIds) {
      if (exitsMap[cid]) continue;                 // skip exited

      var indRec  = indMap[cid];
      var bbdRec  = bbdMap[cid];
      var baseRec = indRec || bbdRec;               // prefer induction data

      var err404 = "All Match";
      if (!indRec && bbdRec) err404 = "Missing in Induction";
      if (indRec && !bbdRec) err404 = "Missing in Refresher";

      var indDone = indRec ? isTrainingCompleted_(indRec.status) : false;
      var bbdDone = bbdRec ? isTrainingCompleted_(bbdRec.status) : false;

      var indYN = indDone ? "Completed" : "Pending";
      var refYN = bbdDone ? "Completed" : "Pending";

      /* Both completed → not pending → skip mix up report */
      if (!(indDone && bbdDone)) {
        mixRows.push([
          cid, baseRec.name, err404, indYN, refYN,
          baseRec.wh, baseRec.sm, baseRec.cm,
          baseRec.city, baseRec.trainer, baseRec.ds
        ]);
      }

      /* Collect completed entries for Completion Daily */
      if (indRec && indDone) completionUpdates.push({ type: "Induction",  record: indRec });
      if (bbdRec && bbdDone) completionUpdates.push({ type: "Refresher",  record: bbdRec });
    }

    /* ── Write Mix up Report ── */
    var sheetMix = getOrCreateSheet_(ss, CONFIG.SHEET_MIXUP);
    sheetMix.clear();
      sheetMix.getRange(1, 1, mixRows.length, mixHeaders.length).setValues(mixRows)
        .setBorder(true, true, true, true, true, true)
        .setHorizontalAlignment("center");
      var hdr = sheetMix.getRange(1, 1, 1, mixHeaders.length);
      hdr.setBackground("yellow").setFontWeight("bold");
      for (var c = 1; c <= mixHeaders.length; c++) sheetMix.setColumnWidth(c, 150);

    /* ── Step 5 : Update Completion Daily ── */
    updateCompletionDaily_(ss, completionUpdates, exitsMap);

    /* ── Step 6 : Clean blank rows ── */
    cleanBlankRows_(sheetInd);
    cleanBlankRows_(sheetBbd);
    cleanBlankRows_(sheetMix);
    var sheetComp = ss.getSheetByName(CONFIG.SHEET_COMPLETION);
    if (sheetComp) cleanBlankRows_(sheetComp);

    /* ── Step 7 : Invalidate cache ── */
    invalidateCache_();

  } catch (e) {
    logError_("runDataController", e.message, e.stack, "");
  } finally {
    lock.releaseLock();
  }
}

/* ══════════════════════════════════════
 *  8. COMPLETION DAILY — UPDATE
 * ══════════════════════════════════════ */

function updateCompletionDaily_(ss, completionUpdates, exitsMap) {
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEET_COMPLETION);
  var data = sheet.getDataRange().getValues();
  var headers = [
    "Employee Code", "Trained Employee Name", "Training Status", "Warehouse ID",
    "Training Assigned", "Training Completed", "Store Manager", "Cluster Manager",
    "Trainer", "City", "Type", "Dark Store Name", "Is the picker active?"
  ];

  /* Ensure headers */
  if (data.length === 0 || String(data[0][0]).trim() === "") {
    data = [headers];
  }

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.COMPLETION_RETENTION_DAYS);

  var idxCode = getColumnIndex_(data[0], ["Employee Code", "Casper ID"]);
  var idxType = getColumnIndex_(data[0], ["Type"]);
  var tcIdx = getColumnIndex_(data[0], ["Training Completed"]);
  var activeIdx = getColumnIndex_(data[0], ["Is the picker active?"]);

  var existingMap = {};
  var rowsToKeep = [data[0]]; // keep headers

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    
    // Check cutoff
    if (tcIdx !== -1) {
      var dStr = String(row[tcIdx] || "");
      if (dStr) {
        var compDate;
        var parts = dStr.split("/");
        if (parts.length === 3) compDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        else compDate = new Date(dStr);
        if (!isNaN(compDate.getTime()) && compDate.getTime() < cutoff.getTime()) continue;
      }
    }

    // Sync exits
    if (idxCode !== -1 && activeIdx !== -1) {
      var rid = String(row[idxCode]).trim();
      if (exitsMap[rid]) row[activeIdx] = "No";
    }

    rowsToKeep.push(row);
    if (idxCode !== -1 && idxType !== -1) {
      var key = String(row[idxCode]).trim() + "_" + String(row[idxType]).trim();
      existingMap[key] = true;
    }
  }

  /* Append new completions */
  completionUpdates.forEach(function (upd) {
    var rec = upd.record;
    var cid = rec.cid || "";
    var key = cid + "_" + upd.type;
    if (!existingMap[key]) {
      rowsToKeep.push([
        cid, rec.name, rec.status, rec.wh,
        rec.assigned, formatDateDDMMYYYY_(rec.completed),
        rec.sm, rec.cm, getTrainerAlias_(rec.trainer),
        rec.city, upd.type, rec.ds,
        exitsMap[cid] ? "No" : "Yes"
      ]);
      existingMap[key] = true;
    }
  });

  /* Write back all at once */
  sheet.clear();
  if (rowsToKeep.length > 0) {
    sheet.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);
    sheet.getRange(1, 1, 1, rowsToKeep[0].length).setFontWeight("bold").setBackground("#f3f3f3").setHorizontalAlignment("center");
  }
}

/* ══════════════════════════════════════
 *  9. API — doGet
 * ══════════════════════════════════════ */

function doGet(e) {
  try {
    var action     = (e && e.parameter) ? e.parameter.action : "";
    var typeFilter = (e && e.parameter && e.parameter.type) ? e.parameter.type : "Pending";
    var nocache    = (e && e.parameter && e.parameter.nocache) ? true : false;

    if (action === "getData") {
      var cacheKey = "FK_Minutes_v5_" + typeFilter;

      if (!nocache) {
        var cached = getChunkedCache_(cacheKey);
        if (cached) {
          return ContentService.createTextOutput(cached)
            .setMimeType(ContentService.MimeType.JSON);
        }
      }

      var mixupData = getSheetData_(CONFIG.SHEET_MIXUP);
      var result = [];

      if (mixupData && mixupData.length > 1) {
        var headers  = mixupData[0];
        var idIdx    = getColumnIndex_(headers, ["Casper ID"]);
        var nmIdx    = getColumnIndex_(headers, ["Picker Name"]);
        var e404Idx  = getColumnIndex_(headers, ["404 Error"]);
        var indIdx   = getColumnIndex_(headers, ["Induction"]);
        var refIdx   = getColumnIndex_(headers, ["Refresher"]);
        var whIdx    = getColumnIndex_(headers, ["Warehouse ID"]);
        var smIdx    = getColumnIndex_(headers, ["Store Manager"]);
        var cmIdx    = getColumnIndex_(headers, ["Cluster Manager"]);
        var ctIdx    = getColumnIndex_(headers, ["City"]);
        var tnIdx    = getColumnIndex_(headers, ["Trainer"]);
        var dsIdx    = getColumnIndex_(headers, ["Dark Store Name"]);

        for (var i = 1; i < mixupData.length; i++) {
          var row = mixupData[i];
          if (!row[idIdx]) continue;

          var indVal = String(row[indIdx] || "");
          var refVal = String(row[refIdx] || "");
          var isPending   = (indVal === "Pending"  || refVal === "Pending");
          var isCompleted = (indVal === "Completed" && refVal === "Completed");

          var match = false;
          if (typeFilter === "Pending"   && isPending)   match = true;
          else if (typeFilter === "Completed" && isCompleted) match = true;
          else if (typeFilter === "All") match = true;

          if (match) {
            result.push({
              id:   row[idIdx],   nm:   row[nmIdx],
              ind:  row[indIdx],  ref:  row[refIdx],
              e404: row[e404Idx], ds:   row[dsIdx],
              ct:   row[ctIdx],   sm:   row[smIdx],
              cm:   row[cmIdx],   tn:   row[tnIdx],
              wh:   row[whIdx]
            });
          }
        }
      }

      var jsonOutput = JSON.stringify(result);
      putChunkedCache_(cacheKey, jsonOutput, 21600);   // 6 h
      return ContentService.createTextOutput(jsonOutput)
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logError_("doGet", err.message, err.stack, JSON.stringify(e || {}));
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ══════════════════════════════════════
 *  10. API — doPost
 * ══════════════════════════════════════ */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Empty request body" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var bodyText = e.postData.contents.trim();
    if (!bodyText) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Empty request body" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (parseErr) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Invalid JSON: " + parseErr.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var action = payload.action;
    var result = {};

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Server busy, try again" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    try {
      if (action === "report")           { result = handleReport_(payload);      invalidateCache_(); }
      else if (action === "batch_report") { result = handleBatchReport_(payload); invalidateCache_(); }
      else if (action === "export")       { result = handleExport_(payload); }
      else                                { result = { error: "Unknown action: " + String(action) }; }
    } finally {
      lock.releaseLock();
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logError_("doPost", err.message, err.stack, "");
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ══════════════════════════════════════
 *  11. HANDLE SINGLE EXIT REPORT
 * ══════════════════════════════════════ */

function handleReport_(payload) {
  var targetId = String(payload.id || "").trim();
  if (!targetId) return { error: "ID missing" };

  var ss         = getSpreadsheet();
  var sheetMixup = getOrCreateSheet_(ss, CONFIG.SHEET_MIXUP);
  var sheetExits = getOrCreateSheet_(ss, CONFIG.SHEET_EXITS);

  /* Remove from Mix up Report */
  var mixData = sheetMixup.getDataRange().getValues();
  if (mixData.length > 0) {
    var mIdIdx = getColumnIndex_(mixData[0], ["Casper ID"]);
    if (mIdIdx !== -1) {
      var rowsToKeep = [mixData[0]];
      for (var i = 1; i < mixData.length; i++) {
        if (String(mixData[i][mIdIdx]).trim() !== targetId) {
          rowsToKeep.push(mixData[i]);
        }
      }
      sheetMixup.clear();
      if (rowsToKeep.length > 0) {
        sheetMixup.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep)
          .setBorder(true, true, true, true, true, true)
          .setHorizontalAlignment("center");
        sheetMixup.getRange(1, 1, 1, rowsToKeep[0].length).setBackground("yellow").setFontWeight("bold");
      }
    }
  }

  /* Ensure Exits headers */
  if (sheetExits.getLastRow() === 0) {
    sheetExits.appendRow(["City", "Dark Store Name", "Picker Name", "Casper ID", "Reason"]);
    sheetExits.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f3f3f3");
  }
  sheetExits.appendRow([
    payload.c  || "", payload.ds || "",
    payload.n  || "", targetId,
    payload.reason || "Dashboard Exit"
  ]);

  /* Update Completion Daily — set "Is the picker active?" = No */
  markPickerInactive_(ss, [targetId]);

  return { status: "Success", message: "Record updated" };
}

/* ══════════════════════════════════════
 *  12. HANDLE BATCH EXIT REPORT
 * ══════════════════════════════════════ */

function handleBatchReport_(payload) {
  var ids = payload.ids;
  if (!Array.isArray(ids) || ids.length === 0) return { error: "No IDs provided" };

  var ss         = getSpreadsheet();
  var sheetMixup = getOrCreateSheet_(ss, CONFIG.SHEET_MIXUP);
  var sheetExits = getOrCreateSheet_(ss, CONFIG.SHEET_EXITS);

  var defaultReason = payload.reason || "Batch Exit";
  var reasons       = payload.reasons || {};
  var idSet = {};
  ids.forEach(function (id) { idSet[String(id).trim()] = true; });

  /* Ensure Exits headers */
  if (sheetExits.getLastRow() === 0) {
    sheetExits.appendRow(["City", "Dark Store Name", "Picker Name", "Casper ID", "Reason"]);
    sheetExits.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f3f3f3");
  }

  /* Remove from Mix up Report + collect new exits */
  var mixData = sheetMixup.getDataRange().getValues();
  var newExits = [];
  if (mixData.length > 0) {
    var mIdIdx = getColumnIndex_(mixData[0], ["Casper ID"]);
    var mNmIdx = getColumnIndex_(mixData[0], ["Picker Name"]);
    var mDsIdx = getColumnIndex_(mixData[0], ["Dark Store Name"]);
    var mCtIdx = getColumnIndex_(mixData[0], ["City"]);
    if (mIdIdx !== -1) {
      var rowsToKeep = [mixData[0]];
      for (var i = 1; i < mixData.length; i++) {
        var cid = String(mixData[i][mIdIdx]).trim();
        if (idSet[cid]) {
          newExits.push([
            mixData[i][mCtIdx] || "", mixData[i][mDsIdx] || "",
            mixData[i][mNmIdx] || "", cid,
            reasons[cid] || defaultReason
          ]);
        } else {
          rowsToKeep.push(mixData[i]);
        }
      }
      sheetMixup.clear();
      if (rowsToKeep.length > 0) {
        sheetMixup.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep)
          .setBorder(true, true, true, true, true, true)
          .setHorizontalAlignment("center");
        sheetMixup.getRange(1, 1, 1, rowsToKeep[0].length).setBackground("yellow").setFontWeight("bold");
      }
    }
  }

  if (newExits.length > 0) {
    var exLr = sheetExits.getLastRow();
    sheetExits.getRange(exLr + 1, 1, newExits.length, newExits[0].length).setValues(newExits);
  }

  /* Update Completion Daily for all IDs */
  markPickerInactive_(ss, Object.keys(idSet));

  return { status: "Success", message: "Batch exited successfully" };
}

/* helper — mark pickers inactive in Completion Daily */
function markPickerInactive_(ss, targetIds) {
  var sheetComp = ss.getSheetByName(CONFIG.SHEET_COMPLETION);
  if (!sheetComp) return;
  var compData  = sheetComp.getDataRange().getValues();
  if (compData.length < 2) return;
  var cIdx = getColumnIndex_(compData[0], ["Employee Code", "Casper ID"]);
  var aIdx = getColumnIndex_(compData[0], ["Is the picker active?"]);
  if (cIdx === -1 || aIdx === -1) return;
  var changed = false;
  var idSet = {};
  targetIds.forEach(function(id) { idSet[String(id).trim()] = true; });
  for (var i = 1; i < compData.length; i++) {
    var cid = String(compData[i][cIdx]).trim();
    if (idSet[cid] && String(compData[i][aIdx]).trim() !== "No") {
      compData[i][aIdx] = "No";
      changed = true;
    }
  }
  if (changed) {
    sheetComp.getRange(1, 1, compData.length, compData[0].length).setValues(compData);
  }
}

/* ══════════════════════════════════════
 *  13. HANDLE GOOGLE SHEET EXPORT
 * ══════════════════════════════════════ */

function handleExport_(payload) {
  var fileName = payload.f || "Exported_Data";
  try {
    var newSs  = SpreadsheetApp.create(fileName);
    var ssFile = DriveApp.getFileById(newSs.getId());

    /* Move to same folder as source */
    var parents = DriveApp.getFileById(getSpreadsheet().getId()).getParents();
    if (parents.hasNext()) ssFile.moveTo(parents.next());

    /* Share: Anyone with link → View */
    ssFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    /* CMSM Summary */
    var summarySheet = newSs.getSheets()[0];
    summarySheet.setName("CMSM Summary");
    if (payload.summaryData && payload.summaryData.length > 0) {
      formatAndPopulateSheet_(summarySheet, payload.summaryData);
    }

    /* Detailed */
    if (payload.detailData && payload.detailData.length > 0) {
      formatAndPopulateSheet_(newSs.insertSheet("Detailed"), payload.detailData);
    }

    /* Login Guide */
    createLoginGuideSheet_(newSs);

    trackFileForDeletion_(newSs.getId());
    return { url: newSs.getUrl() };
  } catch (err) {
    return { error: err.toString() };
  }
}

function formatAndPopulateSheet_(sheet, dataArray) {
  if (!dataArray || dataArray.length === 0) return;
  var clean = dataArray.map(function (r) {
    return r.map(function (c) { return c == null ? "" : String(c); });
  }).filter(function (r) {
    return r.some(function (c) { return c.trim() !== ""; });
  });
  if (clean.length === 0) return;
  var rows = clean.length, cols = clean[0].length;
  sheet.getRange(1, 1, rows, cols).setValues(clean);
  sheet.getRange(1, 1, 1, cols).setFontWeight("bold").setBackground("#d9ead3");
  sheet.getRange(1, 1, rows, cols).setHorizontalAlignment("center");
  sheet.autoResizeColumns(1, cols);
  sheet.setFrozenRows(1);
}

function createLoginGuideSheet_(ss) {
  var sheet = ss.insertSheet("Login Guide");
  var guideData = [
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
  sheet.getRange(1, 1, guideData.length, 2).setValues(guideData);

  sheet.getRange(1, 1, 1, 2).merge()
    .setFontSize(16).setFontWeight("bold").setFontColor("#2874F0")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  sheet.getRange(2, 1, 1, 2)
    .setFontWeight("bold").setBackground("#d9ead3").setHorizontalAlignment("center");

  for (var r = 0; r < guideData.length; r++) {
    var lbl = String(guideData[r][0]).trim().toLowerCase();
    if (lbl.indexOf("org url") !== -1 || lbl.indexOf("username") !== -1 || lbl.indexOf("password") !== -1) {
      sheet.getRange(r + 1, 1, 1, 2).setBackground("#fce4ec").setFontWeight("bold").setFontColor("#000000");
    }
  }

  sheet.getRange(guideData.length, 1, 1, 2).merge()
    .setFontSize(10).setFontColor("#64748b").setHorizontalAlignment("center").setFontStyle("italic");

  sheet.getRange(1, 1, guideData.length, 2)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.autoResizeColumns(1, 2);
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 400);
}

/* ══════════════════════════════════════
 *  14. FILE LIFECYCLE
 * ══════════════════════════════════════ */

function trackFileForDeletion_(fileId) {
  var props = PropertiesService.getScriptProperties();
  var files = [];
  try { var ex = props.getProperty("FILES_TO_DELETE"); if (ex) files = JSON.parse(ex); } catch (e) { }
  files.push({ id: fileId, timestamp: Date.now() });
  props.setProperty("FILES_TO_DELETE", JSON.stringify(files));
}

function cleanupOldFiles() {
  var props = PropertiesService.getScriptProperties();
  var files = [];
  try { var ex = props.getProperty("FILES_TO_DELETE"); if (ex) files = JSON.parse(ex); } catch (e) { return; }
  if (files.length === 0) return;

  var now     = Date.now();
  var ONE_DAY = 24 * 60 * 60 * 1000;
  var remaining = [];

  for (var i = 0; i < files.length; i++) {
    if (now - files[i].timestamp > ONE_DAY) {
      try { DriveApp.getFileById(files[i].id).setTrashed(true); } catch (e) { }
    } else {
      remaining.push(files[i]);
    }
  }
  props.setProperty("FILES_TO_DELETE", JSON.stringify(remaining));
}

/* ══════════════════════════════════════
 *  15. TRIGGER MANAGEMENT
 * ══════════════════════════════════════ */

function setupTriggers() {
  /* Delete ALL existing triggers (prevents duplicates) */
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  /* Data sync — every 4 hours */
  ScriptApp.newTrigger("runDataController")
    .timeBased()
    .everyHours(4)
    .create();

  /* File cleanup — daily at 3 AM */
  ScriptApp.newTrigger("cleanupOldFiles")
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  Logger.log("Triggers setup successfully.");
}

/* ══════════════════════════════════════
 *  16. MANUAL-RUN CONVENIENCE FUNCTIONS
 * ══════════════════════════════════════ */

function manualRefreshCache() {
  invalidateCache_();
  runDataController();
}

function manualCleanup() {
  cleanupOldFiles();
}
