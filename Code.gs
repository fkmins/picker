/* ═══════════════════════════════════════════════════════════════
   Flipkart Minutes — Google Apps Script Backend (Code.gs)
   ═══════════════════════════════════════════════════════════════ */

var SS_ID = '1iKahNXSOsdzDHf0M8QGez2HQOO2vJuRff8KV439koPM';
var IND_SHEET = 'Raw - Picker - Induction';
var REF_SHEET = 'Raw - Picker - Refresher';
var EXIT_SHEET = 'Exits';
var LOG_SHEET = 'Log Error';

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
        return buildJsonResponse_(fetchDashboardData_());
      case 'exit':
        return buildJsonResponse_(processBatchExits_(body));
      case 'export':
        return buildJsonResponse_(generateExportSheet_(body));
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

/* ── Fetch Dashboard Data ── */
function fetchDashboardData_() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var indData = fetchSheetData_(ss, IND_SHEET);
  var refData = fetchSheetData_(ss, REF_SHEET);
  var exitedIds = fetchExitedIds_(ss);

  var indMap = {}, refMap = {}, relevantIds = {};

  for (var i = 0; i < indData.length; i++) {
    var rInd = indData[i];
    indMap[rInd.id] = rInd;
    if (PENDING_STATUSES[rInd.status]) relevantIds[rInd.id] = true;
  }

  for (var j = 0; j < refData.length; j++) {
    var rRef = refData[j];
    refMap[rRef.id] = rRef;
    if (PENDING_STATUSES[rRef.status]) relevantIds[rRef.id] = true;
  }

  var resultList = [];
  for (var id in relevantIds) {
    if (exitedIds[id]) continue;

    var indRecord = indMap[id];
    var refRecord = refMap[id];
    var baseRecord = indRecord || refRecord;

    var indStatus = indRecord ? indRecord.status : 'Not Assigned';
    var refStatus = refRecord ? refRecord.status : 'Not Assigned';

    if (PENDING_STATUSES[indStatus]) indStatus = 'Pending';
    if (PENDING_STATUSES[refStatus]) refStatus = 'Pending';

    resultList.push({
      id: id,
      nm: baseRecord.name,
      ds: baseRecord.store,
      ct: baseRecord.city,
      cm: (indRecord && indRecord.cm) ? indRecord.cm : ((refRecord && refRecord.cm) ? refRecord.cm : ''),
      tn: (indRecord && indRecord.trainer) ? indRecord.trainer : ((refRecord && refRecord.trainer) ? refRecord.trainer : ''),
      wh: baseRecord.wh,
      ind: indStatus,
      ref: refStatus
    });
  }

  return resultList;
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

    // ── DELETE ALL EMPTY CELLS (No extra empty columns, No extra empty rows) ──
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

  // Set default sharing: Anyone with link can view
  try {
    var file = DriveApp.getFileById(spreadsheet.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (driveErr) {
    logSystemError_('generateExportSheet_ Drive sharing', driveErr);
  }

  return { url: spreadsheet.getUrl(), status: 'Success' };
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
  // Row 6 (Orginistaional Url) & Row 8 (Password)
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

/* ── Read Raw Sheet Data safely ── */
function fetchSheetData_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastRow = sheet.getLastRow();
  var numRows = lastRow - 1;
  var data = sheet.getRange(2, 1, numRows, 9).getValues();
  var parsed = [];

  for (var i = 0; i < data.length; i++) {
    var id = sanitizeString_(data[i][0]);
    if (id) {
      parsed.push({
        id: id,
        name: sanitizeString_(data[i][1]),
        status: sanitizeString_(data[i][2]),
        wh: sanitizeString_(data[i][3]),
        cm: sanitizeString_(data[i][5]),
        trainer: sanitizeString_(data[i][6]),
        city: sanitizeString_(data[i][7]),
        store: sanitizeString_(data[i][8])
      });
    }
  }
  return parsed;
}

/* ── Error Logging ── */
function logSystemError_(source, error) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(LOG_SHEET);
    if (sheet) {
      sheet.appendRow([
        new Date(),
        source,
        error.message || String(error),
        error.stack || '',
        'Flipkart Minutes Apps Script Log'
      ]);
    }
  } catch (_) {}
}

/* ── One-Time Authorization Function ──
   RUN THIS FUNCTION ONCE IN SCRIPT EDITOR TO GRANT DRIVE & SHEETS PERMISSIONS!
*/
function authorizeDrive() {
  var root = DriveApp.getRootFolder();
  var ss = SpreadsheetApp.openById(SS_ID);
  Logger.log('Authorized Drive & Sheets successfully for: ' + ss.getName());
}
