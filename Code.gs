/* ═══════════════════════════════════════════════════════════════
   Flipkart Minutes — Google Apps Script Backend (Code.gs)
   ═══════════════════════════════════════════════════════════════ */

var SS_ID = '1iKahNXSOsdzDHf0M8QGez2HQOO2vJuRff8KV439koPM';
var IND_SHEET = 'Raw - Picker - Induction';
var REF_SHEET = 'Raw - Picker - Refresher';
var EXIT_SHEET = 'Exits';
var LOG_SHEET = 'Log Error';
var CACHE_KEY_DATA = 'dash_data_v3';

var PENDING_STATUSES = {
  'Not Started': 1,
  'In-Progress': 1,
  'NOT STARTED': 1,
  'IN-PROGRESS': 1,
  'IN PROGRESS': 1
};

/* ── Web App Entry Points ── */
function doGet(e) { return processRequest_(e); }
function doPost(e) { return processRequest_(e); }

function processRequest_(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = params.action;
    var body = null;

    if (!action && e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
        action = body.action;
      } catch (jsonErr) {
        return buildJsonResponse_({ error: 'Invalid JSON payload' });
      }
    }

    if (!action) return buildJsonResponse_({ error: 'No action provided.' });

    switch (action) {
      case 'getData':
        return buildJsonResponse_(fetchDashboardDataCached_());
      case 'exit':
        return buildJsonResponse_(processBatchExits_(body));
      case 'export':
        return buildJsonResponse_(generateExportSheet_(body));
      case 'diagnoseAuth':
        return buildJsonResponse_(diagnoseAuth_());
      default:
        return buildJsonResponse_({ error: 'Invalid action: ' + action });
    }
  } catch (error) {
    logSystemError_('processRequest_', error);
    return buildJsonResponse_({ error: error.message || String(error) });
  }
}

function buildJsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeString_(value) {
  if (value == null) return '';
  var trimmed = String(value).trim();
  return (trimmed === '' || trimmed === '#N/A' || trimmed.toUpperCase() === 'N/A') ? '' : trimmed;
}

/* ── Fast Cached Dashboard Data (< 200ms response time) ── */
function fetchDashboardDataCached_() {
  var cached = getCachedJson_(CACHE_KEY_DATA);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_) {}
  }

  var freshData = fetchDashboardData_();
  setCachedJson_(CACHE_KEY_DATA, JSON.stringify(freshData), 600); // 10 minutes cache
  return freshData;
}

/* ── Fetch & Match Induction + Refresher + Active Status ── */
function fetchDashboardData_() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var indData = fetchSheetData_(ss, IND_SHEET);
  var refData = fetchSheetData_(ss, REF_SHEET);
  var exitedIds = fetchExitedIds_(ss);

  var hasInduction = indData.length > 0;
  var hasRefresher = refData.length > 0;

  var indMap = {}, refMap = {}, allIds = {};

  for (var i = 0; i < indData.length; i++) {
    var rInd = indData[i];
    indMap[rInd.id] = rInd;
    allIds[rInd.id] = true;
  }

  for (var j = 0; j < refData.length; j++) {
    var rRef = refData[j];
    refMap[rRef.id] = rRef;
    allIds[rRef.id] = true;
  }

  var pendingList = [];
  var inactiveList = [];

  for (var id in allIds) {
    var indRecord = indMap[id];
    var refRecord = refMap[id];
    var baseRecord = indRecord || refRecord;

    var indRawStatus = indRecord ? indRecord.status : '';
    var refRawStatus = refRecord ? refRecord.status : '';

    var indIsPending = !!PENDING_STATUSES[indRawStatus];
    var refIsPending = !!PENDING_STATUSES[refRawStatus];

    // Check if either program is pending ("Not Started" or "In-Progress")
    var isPending = (hasInduction && indIsPending) || (hasRefresher && refIsPending);

    // Active ? logic: Column 11 = 'No' (case-insensitive) OR present in Exits sheet -> Inactive
    var indActive = indRecord ? indRecord.active : '';
    var refActive = refRecord ? refRecord.active : '';
    var isExplicitNo = (indActive.toUpperCase() === 'NO') || (refActive.toUpperCase() === 'NO');
    var isExited = !!exitedIds[id] || isExplicitNo;

    // Standardized display strings
    var indDisplay = indRecord ? (indIsPending ? 'Pending' : (indRawStatus || 'Completed')) : 'N/A';
    var refDisplay = refRecord ? (refIsPending ? 'Pending' : (refRawStatus || 'Completed')) : 'N/A';

    var item = {
      id: id,
      nm: baseRecord.name,
      ds: baseRecord.store,
      ct: baseRecord.city,
      cm: (indRecord && indRecord.cm) ? indRecord.cm : ((refRecord && refRecord.cm) ? refRecord.cm : ''),
      sm: (indRecord && indRecord.sm) ? indRecord.sm : ((refRecord && refRecord.sm) ? refRecord.sm : ''),
      tn: (indRecord && indRecord.trainer) ? indRecord.trainer : ((refRecord && refRecord.trainer) ? refRecord.trainer : ''),
      wh: baseRecord.wh,
      ind: indDisplay,
      ref: refDisplay,
      indPending: indIsPending,
      refPending: refIsPending,
      active: !isExited
    };

    if (isExited) {
      inactiveList.push(item);
    } else if (isPending) {
      pendingList.push(item);
    }
  }

  return {
    hasInduction: hasInduction,
    hasRefresher: hasRefresher,
    pending: pendingList,
    inactive: inactiveList,
    totalPending: pendingList.length,
    totalInactive: inactiveList.length
  };
}

/* ── Read Raw Sheet Data (All 11 Columns) ── */
function fetchSheetData_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastRow = sheet.getLastRow();
  var numRows = lastRow - 1;
  var numCols = Math.max(sheet.getLastColumn(), 11);
  var data = sheet.getRange(2, 1, numRows, numCols).getValues();
  var parsed = [];

  for (var i = 0; i < data.length; i++) {
    var id = sanitizeString_(data[i][0]);
    if (id) {
      parsed.push({
        id: id,
        name: sanitizeString_(data[i][1]),
        status: sanitizeString_(data[i][2]),
        wh: sanitizeString_(data[i][3]),
        sm: sanitizeString_(data[i][4]),        // Store Manager
        cm: sanitizeString_(data[i][5]),        // Cluster Manager
        trainer: sanitizeString_(data[i][6]),   // Trainer
        city: sanitizeString_(data[i][7]),      // City
        store: sanitizeString_(data[i][8]),     // Dark Store Name
        type: sanitizeString_(data[i][9]),      // Type (Induction / Refresher)
        active: sanitizeString_(data[i][10])    // Active ? ('Yes' / 'No')
      });
    }
  }
  return parsed;
}

/* ── Read Exited Casper IDs ── */
function fetchExitedIds_(ss) {
  var exitSheet = ss.getSheetByName(EXIT_SHEET);
  if (!exitSheet || exitSheet.getLastRow() < 2) return {};

  var exitVals = exitSheet.getRange(2, 2, exitSheet.getLastRow() - 1, 1).getValues();
  var exited = {};
  for (var i = 0; i < exitVals.length; i++) {
    var val = sanitizeString_(exitVals[i][0]);
    if (val) exited[val] = true;
  }
  return exited;
}

/* ── Process Batch Inactive / Exits ── */
function processBatchExits_(payload) {
  if (!payload || !payload.items || !payload.items.length) {
    throw new Error('No items provided.');
  }

  var ss = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(EXIT_SHEET);
  if (!sheet) throw new Error('Exits sheet not found.');

  var existingExits = fetchExitedIds_(ss);

  var indData = fetchSheetData_(ss, IND_SHEET);
  var refData = fetchSheetData_(ss, REF_SHEET);
  var dataMap = {};
  for (var i = 0; i < indData.length; i++) dataMap[indData[i].id] = indData[i];
  for (var j = 0; j < refData.length; j++) {
    if (!dataMap[refData[j].id]) dataMap[refData[j].id] = refData[j];
  }

  var rowsToAppend = [];
  for (var k = 0; k < payload.items.length; k++) {
    var id = sanitizeString_(payload.items[k].id);
    if (!id || existingExits[id]) continue;

    var canonical = dataMap[id];
    var pName = canonical ? canonical.name : (sanitizeString_(payload.items[k].name) || 'N/A');
    var pCity = canonical ? canonical.city : (sanitizeString_(payload.items[k].city) || 'N/A');
    var pStore = canonical ? canonical.store : (sanitizeString_(payload.items[k].store) || 'N/A');

    rowsToAppend.push([pName, id, pCity, pStore]);
    existingExits[id] = true;
  }

  if (rowsToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, 4).setValues(rowsToAppend);
    SpreadsheetApp.flush();
  }

  // Clear cache so fresh data loads immediately
  clearCachedJson_(CACHE_KEY_DATA);

  return { status: 'Success', count: rowsToAppend.length };
}

/* ── Generate Google Sheet Export (Deletes All Empty Cells + Anyone with link sharing) ── */
function generateExportSheet_(payload) {
  if (!payload) throw new Error('No export payload provided.');

  var timeZone = Session.getScriptTimeZone();
  var timestamp = Utilities.formatDate(new Date(), timeZone, 'dd-MM-yyyy_HHmm');
  var sheetTitle = 'Flipkart Minutes - ' + (sanitizeString_(payload.f) || 'Export') + ' (' + timestamp + ')';

  var spreadsheet = SpreadsheetApp.create(sheetTitle);

  // 1. Generate Guide Sheet
  createGuideSheet_(spreadsheet);

  // 2. Generate Data Sheet
  var dataSheet = spreadsheet.insertSheet('Pendency Data');
  var data = (payload.detailData && payload.detailData.length > 0) ? payload.detailData : payload.summaryData;

  if (data && data.length > 0) {
    var numRows = data.length;
    var numCols = data[0].length;
    var range = dataSheet.getRange(1, 1, numRows, numCols);
    range.setValues(data);

    // Format Header Row
    var headerRange = dataSheet.getRange(1, 1, 1, numCols);
    headerRange.setFontWeight('bold')
      .setBackground('#BA0843')
      .setFontColor('#FFFFFF')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // Format Data Rows: Center-aligned, Black Border
    var dataRange = dataSheet.getRange(2, 1, numRows - 1, numCols);
    dataRange.setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // Thin Black Border
    range.setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);

    dataSheet.setFrozenRows(1);
    for (var col = 1; col <= numCols; col++) {
      dataSheet.autoResizeColumn(col);
    }

    // ── DELETE ALL EMPTY CELLS ──
    var maxCols = dataSheet.getMaxColumns();
    if (maxCols > numCols) {
      dataSheet.deleteColumns(numCols + 1, maxCols - numCols);
    }
    var maxRows = dataSheet.getMaxRows();
    if (maxRows > numRows) {
      dataSheet.deleteRows(numRows + 1, maxRows - numRows);
    }
  }

  // Remove default 'Sheet1'
  var defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet) {
    try { spreadsheet.deleteSheet(defaultSheet); } catch (_) {}
  }

  // Set default sharing: Anyone with link can view (Multi-method fallback)
  setSharingAnyoneWithLink_(spreadsheet.getId());

  // Track file for auto-cleanup after 24h
  trackFileForDeletion_(spreadsheet.getId());

  return { url: spreadsheet.getUrl(), status: 'Success' };
}

/* ── Robust Sharing Helper: Sets "Anyone with the link can view" ── */
function setSharingAnyoneWithLink_(fileId) {
  // Method 0: Advanced Google Drive Service (Drive API v3)
  if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.create) {
    try {
      Drive.Permissions.create({
        role: 'reader',
        type: 'anyone'
      }, fileId, { supportsAllDrives: true });
      Logger.log('[Method 0 - Drive API v3] SUCCESS: Anyone with link can view granted');
      return true;
    } catch (advErr) {
      Logger.log('[Method 0 - Drive API v3] Error: ' + advErr.message);
    }
  }

  // Method 1: DriveApp standard (Anyone with link)
  try {
    var file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log('[Method 1 - DriveApp] SUCCESS: Anyone with link can view granted');
    return true;
  } catch (driveAppErr) {
    Logger.log('[Method 1 - DriveApp] Error: ' + driveAppErr.message);
  }

  // Method 1B: Domain with link fallback (Google Workspace policy)
  try {
    var fileDom = DriveApp.getFileById(fileId);
    fileDom.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log('[Method 1B - Domain] SUCCESS: Domain with link granted');
    return true;
  } catch (domErr) {
    Logger.log('[Method 1B - Domain] Error: ' + domErr.message);
  }

  // Method 2: Drive REST API v3 via UrlFetchApp with OAuth Token
  try {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions?supportsAllDrives=true';
    var response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        'role': 'reader',
        'type': 'anyone',
        'allowFileDiscovery': false
      }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      Logger.log('[Method 2 - REST v3] SUCCESS (HTTP ' + code + ')');
      return true;
    } else {
      Logger.log('[Method 2 - REST v3] Failed HTTP ' + code + ': ' + response.getContentText());
    }
  } catch (restErr) {
    Logger.log('[Method 2 - REST v3] Exception: ' + restErr.message);
  }

  // Method 3: Drive REST API v2
  try {
    var url2 = 'https://www.googleapis.com/drive/v2/files/' + fileId + '/permissions';
    var response2 = UrlFetchApp.fetch(url2, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        'role': 'reader',
        'type': 'anyone',
        'withLink': true
      }),
      muteHttpExceptions: true
    });
    var code2 = response2.getResponseCode();
    if (code2 >= 200 && code2 < 300) {
      Logger.log('[Method 3 - REST v2] SUCCESS (HTTP ' + code2 + ')');
      return true;
    } else {
      Logger.log('[Method 3 - REST v2] Failed HTTP ' + code2 + ': ' + response2.getContentText());
    }
  } catch (restErr2) {
    Logger.log('[Method 3 - REST v2] Exception: ' + restErr2.message);
  }

  return false;
}

/* ── Create Guide Sheet (Deletes All Empty Cells + Formats Red Border & Yellow Inside) ── */
function createGuideSheet_(spreadsheet) {
  var sheet = spreadsheet.insertSheet('Picker Login Guide');

  var guideData = [
    ['Picker Login Guide', ''],
    ['', ''],
    ['Android App Link', 'https://play.google.com/store/apps/details?id=com.disprz'],
    ['Iphone App Link', 'https://apps.apple.com/in/app/disprz/id1458716803'],
    ['', ''],
    ['Orginistaional Url', 'edl.disprz.com'],
    ['User ID', 'Casper ID (456354) [without ca.]'],
    ['Password', 'Edl@123']
  ];

  sheet.getRange(1, 1, guideData.length, 2).setValues(guideData);

  // Main Header
  sheet.getRange('A1:B1').merge()
    .setFontWeight('bold')
    .setFontSize(15)
    .setFontColor('#BA0843')
    .setHorizontalAlignment('center');

  sheet.getRange('A3:A4').setFontWeight('bold');
  sheet.getRange('A6:A8').setFontWeight('bold');

  // Format Credentials: Border Red (#DC2626), Inside Yellow (#FEF08A)
  var cred1 = sheet.getRange('B6');
  cred1.setBackground('#FEF08A').setFontWeight('bold')
    .setBorder(true, true, true, true, true, true, '#DC2626', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  var cred2 = sheet.getRange('B8');
  cred2.setBackground('#FEF08A').setFontWeight('bold')
    .setBorder(true, true, true, true, true, true, '#DC2626', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  sheet.autoResizeColumn(1);
  sheet.autoResizeColumn(2);

  // ── DELETE ALL EMPTY CELLS ON GUIDE SHEET ──
  var maxGCols = sheet.getMaxColumns();
  if (maxGCols > 2) {
    sheet.deleteColumns(3, maxGCols - 2);
  }
  var maxGRows = sheet.getMaxRows();
  if (maxGRows > guideData.length) {
    sheet.deleteRows(guideData.length + 1, maxGRows - guideData.length);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   LARGE-PAYLOAD CHUNKED CACHING ENGINE
   ═══════════════════════════════════════════════════════════════════ */

function setCachedJson_(key, jsonStr, ttlSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    var CHUNK_SIZE = 90000;
    var numChunks = Math.ceil(jsonStr.length / CHUNK_SIZE);
    var chunks = {};
    for (var i = 0; i < numChunks; i++) {
      chunks[key + '_' + i] = jsonStr.substr(i * CHUNK_SIZE, CHUNK_SIZE);
    }
    chunks[key + '_meta'] = JSON.stringify({ count: numChunks });
    cache.putAll(chunks, ttlSeconds || 600);
  } catch (_) {}
}

function getCachedJson_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var metaStr = cache.get(key + '_meta');
    if (!metaStr) return null;
    var meta = JSON.parse(metaStr);
    var keys = [];
    for (var i = 0; i < meta.count; i++) keys.push(key + '_' + i);
    var chunks = cache.getAll(keys);
    var full = '';
    for (var j = 0; j < meta.count; j++) {
      var piece = chunks[key + '_' + j];
      if (!piece) return null;
      full += piece;
    }
    return full;
  } catch (_) { return null; }
}

function clearCachedJson_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var metaStr = cache.get(key + '_meta');
    if (metaStr) {
      var meta = JSON.parse(metaStr);
      var keys = [key + '_meta'];
      for (var i = 0; i < meta.count; i++) keys.push(key + '_' + i);
      cache.removeAll(keys);
    }
  } catch (_) {}
}

/* ═══════════════════════════════════════════════════════════════════
   AUTOMATIC CLEANUP & HOUSEKEEPING
   ═══════════════════════════════════════════════════════════════════ */

function trackFileForDeletion_(fileId) {
  try {
    var props = PropertiesService.getScriptProperties();
    var files = [];
    var ex = props.getProperty("FILES_TO_DELETE");
    if (ex) files = JSON.parse(ex);
    files.push({ id: fileId, timestamp: Date.now() });
    if (files.length > 150) {
      var cutoff = Date.now() - (48 * 60 * 60 * 1000);
      files = files.filter(function(item) { return item.timestamp > cutoff; });
    }
    props.setProperty("FILES_TO_DELETE", JSON.stringify(files));
  } catch (_) {}
}

function runDailyCleanup() {
  var props = PropertiesService.getScriptProperties();
  var files = [];
  try {
    var ex = props.getProperty("FILES_TO_DELETE");
    if (ex) files = JSON.parse(ex);
  } catch (e) { return; }

  if (files && files.length > 0) {
    var now = Date.now(), ONE_DAY = 24 * 60 * 60 * 1000, remaining = [];
    for (var i = 0; i < files.length; i++) {
      if (now - files[i].timestamp > ONE_DAY) {
        try { DriveApp.getFileById(files[i].id).setTrashed(true); } catch (_) {}
      } else {
        remaining.push(files[i]);
      }
    }
    props.setProperty("FILES_TO_DELETE", JSON.stringify(remaining));
  }

  cleanOldLogs_();
}

function cleanOldLogs_() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(LOG_SHEET);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow > 250) {
      sheet.deleteRows(2, lastRow - 200);
    }
  } catch (_) {}
}

function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "runDailyCleanup" || fn === "runDataController") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("runDailyCleanup").timeBased().atHour(3).everyDays(1).create();
}

function manualCleanup() {
  runDailyCleanup();
}

function logSystemError_(source, error) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(LOG_SHEET);
    if (sheet) {
      sheet.appendRow([
        new Date(),
        source,
        (error && error.message) ? error.message : String(error),
        (error && error.stack) ? error.stack : '',
        'Flipkart Minutes Apps Script Log'
      ]);
    }
  } catch (_) {}
}

function trashFileSafely_(fileId) {
  if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.remove) {
    try {
      Drive.Files.remove(fileId);
      Logger.log('[Cleanup] Trashed via Drive API v3 remove');
      return true;
    } catch (e0) {
      Logger.log('[Cleanup] Drive.Files.remove error: ' + e0.message);
    }
  }
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    Logger.log('[Cleanup] Trashed via DriveApp.setTrashed');
    return true;
  } catch (e1) {
    Logger.log('[Cleanup] DriveApp.setTrashed error: ' + e1.message);
  }
  return false;
}

/* ── Force Full OAuth Authorization ──
   Run this function from the toolbar! Because it contains uncaught calls to
   UrlFetchApp and DriveApp.setSharing, Google is FORCED to show the consent dialog.
*/
function forceDriveAuthorization() {
  // 1. Forces consent for: https://www.googleapis.com/auth/script.external_request
  UrlFetchApp.fetch('https://www.google.com');

  // 2. Forces consent for: https://www.googleapis.com/auth/drive
  var testFile = DriveApp.createFile('permission_handshake.txt', 'Google Drive OAuth Verification');
  testFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  testFile.setTrashed(true);

  Logger.log('>>> ALL PERMISSIONS (Drive Full Access + UrlFetch) GRANTED SUCCESSFULLY! <<<');
}

function setupSharingAndPermissions() {
  Logger.log('─── Starting Full Diagnostic & Permissions Setup ───');
  try {
    var root = DriveApp.getRootFolder();
    Logger.log('[Check] DriveApp Root folder: ' + root.getName());
  } catch (eRoot) {
    Logger.log('[Check] DriveApp Root folder ERROR: ' + eRoot.message);
  }

  var testSheet = SpreadsheetApp.create('Sharing_Verification_Test');
  var testId = testSheet.getId();
  Logger.log('Created temporary sheet: ' + testId);

  var sharingResult = setSharingAnyoneWithLink_(testId);
  Logger.log('setSharingAnyoneWithLink_ overall: ' + (sharingResult ? 'SUCCESS' : 'FAILED'));

  var cleaned = trashFileSafely_(testId);
  Logger.log('Temporary sheet cleaned up: ' + cleaned);

  if (sharingResult) {
    Logger.log('>>> SUCCESS: Google Sheet is now shared! <<<');
  } else {
    Logger.log('>>> FAILED: Check the method error details above to see why Google rejected it. <<<');
  }
  Logger.log('─── Diagnostic Complete ───');
}

function diagnoseAuth_() {
  var diag = {};
  try {
    var testSheet = SpreadsheetApp.create('Auth_Diag_' + Date.now());
    var id = testSheet.getId();
    diag.sheetCreated = true;
    diag.sheetId = id;

    diag.driveAppSharing = false;
    try {
      var f = DriveApp.getFileById(id);
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      diag.driveAppSharing = true;
    } catch (e1) {
      diag.driveAppError = e1.message;
    }

    try {
      DriveApp.getFileById(id).setTrashed(true);
      diag.trashed = true;
    } catch (e2) {
      diag.trashError = e2.message;
    }
  } catch (eGlobal) {
    diag.globalError = eGlobal.message;
  }
  return diag;
}
