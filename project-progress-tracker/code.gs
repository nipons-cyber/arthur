/**
 * ระบบติดตามความคืบหน้าโครงการ (Project Progress Tracking)
 * เก็บข้อมูลโครงการและบันทึกความคืบหน้ารายเดือนลง Google Sheets
 */

var PROJECTS_SHEET = 'Projects';
var PROGRESS_SHEET = 'Progress';

var PROJECTS_HEADERS = ['ProjectID', 'ProjectName', 'Owner', 'StartDate', 'Status', 'Description', 'CreatedAt'];
var PROGRESS_HEADERS = ['ID', 'ProjectID', 'ProjectName', 'Month', 'Progress', 'Status', 'Notes', 'UpdatedBy', 'UpdatedAt'];

var PROJECT_STATUSES = ['กำลังดำเนินการ', 'เสร็จสิ้น', 'ระงับชั่วคราว', 'ยกเลิก'];
var PROGRESS_STATUSES = ['ตามแผน', 'ล่าช้า', 'มีความเสี่ยง', 'เสร็จสมบูรณ์'];

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ระบบติดตามความคืบหน้าโครงการ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function projectsSheet_() { return getSheet_(PROJECTS_SHEET, PROJECTS_HEADERS); }
function progressSheet_() { return getSheet_(PROGRESS_SHEET, PROGRESS_HEADERS); }

function rowsToObjects_(sheet, headers) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row, i) {
    var obj = {};
    headers.forEach(function (h, idx) { obj[h] = row[idx]; });
    obj._row = i + 2;
    return obj;
  });
}

function getMeta() {
  return { projectStatuses: PROJECT_STATUSES, progressStatuses: PROGRESS_STATUSES };
}

/** ดึงรายชื่อโครงการทั้งหมด */
function getProjects() {
  var sheet = projectsSheet_();
  var rows = rowsToObjects_(sheet, PROJECTS_HEADERS);
  return rows.map(function (r) {
    return {
      id: r.ProjectID,
      name: r.ProjectName,
      owner: r.Owner,
      startDate: formatDate_(r.StartDate),
      status: r.Status,
      description: r.Description,
      createdAt: formatDateTime_(r.CreatedAt)
    };
  }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'th'); });
}

/** ดึงบันทึกความคืบหน้าทั้งหมด (ทุกโครงการ ทุกเดือน) */
function getProgressEntries() {
  var sheet = progressSheet_();
  var rows = rowsToObjects_(sheet, PROGRESS_HEADERS);
  return rows.map(function (r) {
    return {
      id: r.ID,
      projectId: r.ProjectID,
      projectName: r.ProjectName,
      month: r.Month,
      progress: Number(r.Progress) || 0,
      status: r.Status,
      notes: r.Notes,
      updatedBy: r.UpdatedBy,
      updatedAt: formatDateTime_(r.UpdatedAt)
    };
  }).sort(function (a, b) { return a.month < b.month ? 1 : (a.month > b.month ? -1 : 0); });
}

/** เพิ่มโครงการใหม่ */
function addProject(data) {
  data = data || {};
  var name = (data.name || '').trim();
  if (!name) throw new Error('กรุณาระบุชื่อโครงการ');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = projectsSheet_();
    var existing = rowsToObjects_(sheet, PROJECTS_HEADERS);
    var dup = existing.some(function (r) { return (r.ProjectName || '').trim().toLowerCase() === name.toLowerCase(); });
    if (dup) throw new Error('มีโครงการชื่อนี้อยู่แล้ว');

    var id = Utilities.getUuid();
    var now = new Date();
    sheet.appendRow([
      id,
      name,
      (data.owner || '').trim(),
      data.startDate ? new Date(data.startDate) : '',
      data.status || PROJECT_STATUSES[0],
      (data.description || '').trim(),
      now
    ]);
    return { success: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

/** แก้ไขข้อมูลโครงการที่มีอยู่ */
function updateProject(data) {
  data = data || {};
  if (!data.id) throw new Error('ไม่พบรหัสโครงการ');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = projectsSheet_();
    var rows = rowsToObjects_(sheet, PROJECTS_HEADERS);
    var target = rows.filter(function (r) { return r.ProjectID === data.id; })[0];
    if (!target) throw new Error('ไม่พบโครงการนี้');

    var name = data.name !== undefined && data.name !== '' ? data.name.trim() : target.ProjectName;
    sheet.getRange(target._row, 1, 1, PROJECTS_HEADERS.length).setValues([[
      target.ProjectID,
      name,
      data.owner !== undefined ? data.owner : target.Owner,
      data.startDate ? new Date(data.startDate) : target.StartDate,
      data.status || target.Status,
      data.description !== undefined ? data.description : target.Description,
      target.CreatedAt
    ]]);

    if (name !== target.ProjectName) {
      var progSheet = progressSheet_();
      var progRows = rowsToObjects_(progSheet, PROGRESS_HEADERS);
      progRows.forEach(function (r) {
        if (r.ProjectID === data.id) {
          progSheet.getRange(r._row, 3).setValue(name);
        }
      });
    }
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/** บันทึก/อัปเดตความคืบหน้าของโครงการในเดือนหนึ่งๆ (upsert ต่อ โครงการ+เดือน) */
function submitProgress(data) {
  data = data || {};
  var projectId = data.projectId;
  var month = data.month; // รูปแบบ 'YYYY-MM'
  if (!projectId) throw new Error('กรุณาเลือกโครงการ');
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('รูปแบบเดือนไม่ถูกต้อง');
  var progress = Number(data.progress);
  if (isNaN(progress) || progress < 0 || progress > 100) throw new Error('ความคืบหน้าต้องอยู่ระหว่าง 0-100');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var projSheet = projectsSheet_();
    var projects = rowsToObjects_(projSheet, PROJECTS_HEADERS);
    var project = projects.filter(function (p) { return p.ProjectID === projectId; })[0];
    if (!project) throw new Error('ไม่พบโครงการนี้');

    var sheet = progressSheet_();
    var rows = rowsToObjects_(sheet, PROGRESS_HEADERS);
    var now = new Date();
    var existingRow = rows.filter(function (r) { return r.ProjectID === projectId && r.Month === month; })[0];

    var status = data.status || PROGRESS_STATUSES[0];
    var notes = (data.notes || '').trim();
    var updatedBy = (data.updatedBy || '').trim();

    if (existingRow) {
      sheet.getRange(existingRow._row, 1, 1, PROGRESS_HEADERS.length).setValues([[
        existingRow.ID, projectId, project.ProjectName, month, progress, status, notes, updatedBy, now
      ]]);
      return { success: true, mode: 'updated' };
    } else {
      sheet.appendRow([Utilities.getUuid(), projectId, project.ProjectName, month, progress, status, notes, updatedBy, now]);
      return { success: true, mode: 'created' };
    }
  } finally {
    lock.releaseLock();
  }
}

/** ลบบันทึกความคืบหน้ารายการหนึ่ง (แก้ไขข้อมูลผิดพลาด) */
function deleteProgress(id) {
  if (!id) throw new Error('ไม่พบรหัสรายการ');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = progressSheet_();
    var rows = rowsToObjects_(sheet, PROGRESS_HEADERS);
    var target = rows.filter(function (r) { return r.ID === id; })[0];
    if (!target) throw new Error('ไม่พบรายการนี้');
    sheet.deleteRow(target._row);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function formatDate_(v) {
  if (!v) return '';
  try { return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'yyyy-MM-dd'); } catch (e) { return v; }
}
function formatDateTime_(v) {
  if (!v) return '';
  try { return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); } catch (e) { return v; }
}
