/**
 * ระบบจองห้องประชุม SPK OFFICE
 * ผูก script นี้กับ Google Sheet ปลายทาง (Extensions > Apps Script)
 * ข้อมูลจะถูกบันทึกลงชีทชื่อ "Reservations" (จะถูกสร้างอัตโนมัติถ้ายังไม่มี)
 */

var SHEET_NAME = 'Reservations';

var ROOMS = ['MR-1', 'MR-2', 'MR-3 FL.3', 'MR-3 FL.3', 'MR-4 FL.4', 'MR-4 FL.4'];

var START_HOUR = 8;
var START_MIN = 30;
var END_HOUR = 17;
var END_MIN = 30;
var SLOT_MINUTES = 30;

var HEADERS = ['Date', 'Room', 'Start', 'End', 'Name', 'Tel'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('ระบบจองห้องประชุม SPK OFFICE')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  // บังคับคอลัมน์ Date / Start / End / Tel ให้เป็นข้อความเสมอ
  // กัน Google Sheets auto-convert เป็นค่า Date/Time/Number ซึ่งจะทำให้เทียบเวลาชนกันผิดพลาด
  // (จองห้องซ้ำเวลาเดิมได้) และเบอร์โทรที่ขึ้นต้นด้วย 0 ถูกตัดเลข 0 ทิ้ง
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('C:D').setNumberFormat('@');
  sheet.getRange('F:F').setNumberFormat('@');
  return sheet;
}

function getRooms() {
  return ROOMS;
}

function generateTimeSlots_() {
  var slots = [];
  var h = START_HOUR;
  var m = START_MIN;
  while (h < END_HOUR || (h === END_HOUR && m <= END_MIN)) {
    slots.push(Utilities.formatString('%02d:%02d', h, m));
    m += SLOT_MINUTES;
    if (m >= 60) {
      m -= 60;
      h += 1;
    }
  }
  return slots;
}

function timeToMinutes_(t) {
  // ถ้าค่าที่อ่านจากชีทถูก Sheets auto-convert เป็น Date/Time object (แถวเก่าก่อนแก้บั๊ก)
  // ให้ดึงชั่วโมง/นาทีจากตัว Date object โดยตรง แทนการแปลงเป็น string ตรงๆ ซึ่งจะได้ NaN
  if (Object.prototype.toString.call(t) === '[object Date]') {
    return t.getHours() * 60 + t.getMinutes();
  }
  var parts = String(t).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function formatTimeValue_(t) {
  if (Object.prototype.toString.call(t) === '[object Date]') {
    return Utilities.formatDate(t, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(t).trim();
}

function formatDateKey_(dateValue) {
  if (Object.prototype.toString.call(dateValue) === '[object Date]') {
    return Utilities.formatDate(dateValue, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(dateValue).trim();
}

function getBookingsForRoomDate_(dateStr, room) {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var bookings = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowDate = formatDateKey_(row[0]);
    var rowRoom = row[1];
    if (rowDate === dateStr && rowRoom === room && row[2] !== '' && row[3] !== '') {
      bookings.push({
        start: timeToMinutes_(row[2]),
        end: timeToMinutes_(row[3])
      });
    }
  }
  return bookings;
}

/**
 * คืนรายการการจองที่มีอยู่แล้วของห้อง+วันที่ที่เลือก (ให้ทุกคนเห็นว่าช่วงไหนถูกจองไปแล้ว)
 * เรียงตามเวลาเริ่มจอง
 */
function getExistingBookings(dateStr, room) {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var bookings = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rowDate = formatDateKey_(row[0]);
    if (rowDate === dateStr && row[1] === room && row[2] !== '' && row[3] !== '') {
      bookings.push({
        startTime: formatTimeValue_(row[2]),
        endTime: formatTimeValue_(row[3]),
        name: row[4]
      });
    }
  }
  bookings.sort(function (a, b) {
    return timeToMinutes_(a.startTime) - timeToMinutes_(b.startTime);
  });
  return bookings;
}

/**
 * คืนรายการ "Start" ที่ยังว่างอยู่ สำหรับห้อง+วันที่ที่เลือก
 */
function getAvailableStartTimes(dateStr, room) {
  var allSlots = generateTimeSlots_();
  var startCandidates = allSlots.slice(0, allSlots.length - 1); // ตัดตัวสุดท้าย (17:30) ออกจากการเป็นเวลาเริ่ม
  var bookings = getBookingsForRoomDate_(dateStr, room);

  return startCandidates.filter(function (slot) {
    var t = timeToMinutes_(slot);
    return !bookings.some(function (b) {
      return t >= b.start && t < b.end;
    });
  });
}

/**
 * คืนรายการ "End" ที่เลือกได้ เมื่อทราบเวลาเริ่มแล้ว
 * โดยจะหยุดที่การจองถัดไปที่ใกล้ที่สุด หรือ 17:30 เป็นอย่างช้าที่สุด
 */
function getAvailableEndTimes(dateStr, room, startTime) {
  var allSlots = generateTimeSlots_();
  var startMinutes = timeToMinutes_(startTime);
  var bookings = getBookingsForRoomDate_(dateStr, room);

  var maxEnd = timeToMinutes_(allSlots[allSlots.length - 1]); // 17:30
  bookings.forEach(function (b) {
    if (b.start >= startMinutes && b.start < maxEnd) {
      maxEnd = b.start;
    }
  });

  return allSlots.filter(function (slot) {
    var t = timeToMinutes_(slot);
    return t > startMinutes && t <= maxEnd;
  });
}

/**
 * บันทึกการจองใหม่ลง Google Sheets
 * form = { date, room, startTime, endTime, name, phone }
 */
function submitReservation(form) {
  if (!form || !form.date || !form.room || !form.startTime || !form.endTime || !form.name || !form.phone) {
    return { success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
  }
  if (ROOMS.indexOf(form.room) === -1) {
    return { success: false, message: 'ห้องประชุมไม่ถูกต้อง' };
  }

  var startMin = timeToMinutes_(form.startTime);
  var endMin = timeToMinutes_(form.endTime);
  if (isNaN(startMin) || isNaN(endMin) || endMin <= startMin) {
    return { success: false, message: 'ช่วงเวลาไม่ถูกต้อง' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var bookings = getBookingsForRoomDate_(form.date, form.room);
    var overlap = bookings.some(function (b) {
      return startMin < b.end && endMin > b.start;
    });
    if (overlap) {
      return { success: false, message: 'ช่วงเวลานี้ถูกจองไปแล้ว กรุณาเลือกเวลาอื่น' };
    }

    var sheet = getSheet_();
    sheet.appendRow([form.date, form.room, form.startTime, form.endTime, form.name, form.phone]);
    SpreadsheetApp.flush(); // เขียนลงชีทจริงก่อนปลดล็อก กันคำขอที่รออยู่อ่านข้อมูลเก่า
    return { success: true, message: 'บันทึกการจองห้อง ' + form.room + ' สำเร็จ' };
  } finally {
    lock.releaseLock();
  }
}
