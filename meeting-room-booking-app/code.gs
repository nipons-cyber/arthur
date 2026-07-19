/**
 * RESERVATIONS SPK OFFICE
 * ผูก script นี้กับ Google Sheet ปลายทาง (Extensions > Apps Script)
 * ข้อมูลจะถูกบันทึกลงชีทชื่อ "Reservations" (จะถูกสร้างอัตโนมัติถ้ายังไม่มี)
 */

var SHEET_NAME = 'Reservations';

/**
 * รายการห้องประชุม
 * - name   : ชื่อห้อง
 * - seats  : จำนวนที่นั่ง
 * - locked : true = ยังไม่เปิดให้จอง (แสดงในรายการแต่จองไม่ได้)
 */
var ROOMS = [
  { name: 'Stark',          seats: 6,  locked: true },
  { name: 'Maverick',       seats: 18, locked: false },
  { name: 'Gump',           seats: 40, locked: true },
  { name: 'Sherlock',       seats: 18, locked: false },
  { name: 'Wayne',          seats: 6,  locked: false },
  { name: 'Thor',           seats: 6,  locked: false },
  { name: 'Hermione',       seats: 6,  locked: false },
  { name: 'Yoda',           seats: 30, locked: true },
  { name: 'Platform 9-3/4', seats: 8,  locked: true },
  { name: 'Natasha',        seats: 8,  locked: true },
  { name: 'Dumbledore',     seats: 18, locked: true },
  { name: 'Hulk',           seats: 6,  locked: false },
  { name: 'Parker',         seats: 4,  locked: false }
];

var START_HOUR = 8;
var START_MIN = 30;
var END_HOUR = 17;
var END_MIN = 30;
var SLOT_MINUTES = 30;

var MAX_REPEAT = 52; // จำกัดจำนวนครั้งของการจองซ้ำ (กันจองยาวเกินไป)

var HEADERS = ['Date', 'Room', 'Start', 'End', 'Name', 'Tel', 'BookingID', 'Equipment'];

/**
 * ตัวเลือกเครื่องดื่ม/อุปกรณ์ที่ขอใช้ (แสดงเป็น checkbox บนฟอร์มจอง)
 */
var EQUIPMENT_OPTIONS = ['น้ำดื่ม', 'Dongle'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('RESERVATIONS SPK OFFICE')
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
  } else {
    // เติมหัวคอลัมน์ "BookingID" / "Equipment" ให้ชีทเดิมที่สร้างก่อนมีฟีเจอร์เหล่านี้
    var headerRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (headerRow[6] !== 'BookingID') {
      sheet.getRange(1, 7).setValue('BookingID');
    }
    if (headerRow[7] !== 'Equipment') {
      sheet.getRange(1, 8).setValue('Equipment');
    }
  }
  // บังคับคอลัมน์ Date / Start / End / Tel / BookingID / Equipment ให้เป็นข้อความเสมอ
  // กัน Google Sheets auto-convert เป็นค่า Date/Time/Number ซึ่งจะทำให้เทียบเวลาชนกันผิดพลาด
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('C:D').setNumberFormat('@');
  sheet.getRange('F:H').setNumberFormat('@');
  return sheet;
}

/**
 * คืนรายการห้องทั้งหมด (รวมห้องที่ล็อกไว้) ให้ frontend แสดงผล
 */
function getRooms() {
  return ROOMS;
}

/**
 * คืนรายการตัวเลือกเครื่องดื่ม/อุปกรณ์ที่ขอใช้ ให้ frontend แสดงเป็น checkbox
 */
function getEquipmentOptions() {
  return EQUIPMENT_OPTIONS;
}

function isRoomBookable_(roomName) {
  for (var i = 0; i < ROOMS.length; i++) {
    if (ROOMS[i].name === roomName) {
      return !ROOMS[i].locked;
    }
  }
  return false;
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

/**
 * บวกวันให้กับสตริงวันที่รูปแบบ yyyy-MM-dd แล้วคืนสตริงรูปแบบเดิม
 */
function addDaysToDateStr_(dateStr, days) {
  var parts = String(dateStr).split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + days);
  return Utilities.formatString('%04d-%02d-%02d', d.getFullYear(), d.getMonth() + 1, d.getDate());
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
 * บันทึกการจองใหม่ลง Google Sheets (รองรับการจองซ้ำแบบ repeat)
 * form = { date, room, startTime, endTime, name, phone, repeatType, repeatCount }
 *   repeatType : 'none' | 'daily' | 'weekly'
 *   repeatCount: จำนวนครั้งรวมครั้งแรก (ใช้เมื่อ repeatType != 'none')
 */
function submitReservation(form) {
  if (!form || !form.date || !form.room || !form.startTime || !form.endTime || !form.name || !form.phone) {
    return { success: false, message: 'Please fill in all fields.' };
  }
  if (isRoomBookable_(form.room) === false) {
    return { success: false, message: 'Room ' + form.room + ' is not open for booking yet. Please choose another room.' };
  }

  var startMin = timeToMinutes_(form.startTime);
  var endMin = timeToMinutes_(form.endTime);
  if (isNaN(startMin) || isNaN(endMin) || endMin <= startMin) {
    return { success: false, message: 'Invalid time range.' };
  }

  // สร้างรายการวันที่ทั้งหมดตามรูปแบบการจองซ้ำ
  var repeatType = form.repeatType || 'none';
  var count = 1;
  var step = 0;
  if (repeatType === 'daily') { step = 1; }
  else if (repeatType === 'weekly') { step = 7; }

  if (step > 0) {
    count = parseInt(form.repeatCount, 10);
    if (isNaN(count) || count < 1) count = 1;
    if (count > MAX_REPEAT) count = MAX_REPEAT;
  }

  var dates = [];
  for (var i = 0; i < count; i++) {
    dates.push(step === 0 ? form.date : addDaysToDateStr_(form.date, i * step));
  }

  // เครื่องดื่ม/อุปกรณ์ที่ขอใช้ (ไม่บังคับ) - รับเป็น array แล้วเก็บลงชีทเป็นสตริงคั่นด้วยจุลภาค
  var equipment = Array.isArray(form.equipment) ? form.equipment.join(', ') : (form.equipment || '');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var booked = [];
    var conflicts = [];
    var rowsToAdd = [];

    for (var j = 0; j < dates.length; j++) {
      var d = dates[j];
      var existing = getBookingsForRoomDate_(d, form.room);
      var overlap = existing.some(function (b) {
        return startMin < b.end && endMin > b.start;
      });
      if (overlap) {
        conflicts.push(d);
      } else {
        rowsToAdd.push([d, form.room, form.startTime, form.endTime, form.name, form.phone, Utilities.getUuid(), equipment]);
        booked.push(d);
      }
    }

    if (rowsToAdd.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, HEADERS.length).setValues(rowsToAdd);
      SpreadsheetApp.flush(); // เขียนลงชีทจริงก่อนปลดล็อก กันคำขอที่รออยู่อ่านข้อมูลเก่า
    }

    if (booked.length === 0) {
      var failMsg = step === 0
        ? 'This time slot is already booked. Please choose another time.'
        : 'Every selected date is already booked at this time. Please choose another time.';
      return { success: false, message: failMsg, booked: 0, conflicts: conflicts };
    }

    var msg;
    if (step === 0) {
      msg = 'Room ' + form.room + ' booked successfully.';
    } else {
      msg = 'Room ' + form.room + ' booked successfully: ' + booked.length + ' booking(s).';
      if (conflicts.length > 0) {
        msg += ' (Skipped ' + conflicts.length + ' already-booked date(s): ' + conflicts.join(', ') + ')';
      }
    }
    return { success: true, message: msg, booked: booked.length, conflicts: conflicts };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ค้นหาการจองในอนาคต (วันนี้เป็นต้นไป) ตามเบอร์ติดต่อ เพื่อใช้ในหน้ายกเลิกการจอง
 * จะเติมรหัสการจอง (UUID) ให้แถวเก่าที่ยังไม่มี เพื่อให้ยกเลิกได้อย่างแม่นยำ
 */
function getBookingsByPhone(phone) {
  if (!phone) return [];
  var target = String(phone).trim();
  if (target === '') return [];

  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var todayKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var results = [];
  var backfilled = false;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[5]).trim() !== target) continue;
    var rowDate = formatDateKey_(row[0]);
    if (rowDate < todayKey) continue; // ข้ามการจองที่ผ่านไปแล้ว (เทียบสตริง yyyy-MM-dd ได้ตรง)

    var id = row[6];
    if (!id) {
      id = Utilities.getUuid();
      sheet.getRange(i + 2, 7).setValue(id);
      backfilled = true;
    }
    results.push({
      id: id,
      date: rowDate,
      room: row[1],
      startTime: formatTimeValue_(row[2]),
      endTime: formatTimeValue_(row[3]),
      name: row[4]
    });
  }

  if (backfilled) SpreadsheetApp.flush();

  results.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return timeToMinutes_(a.startTime) - timeToMinutes_(b.startTime);
  });
  return results;
}

/**
 * ยกเลิก (ลบ) การจองตามรหัสการจอง โดยตรวจเบอร์ติดต่อให้ตรงกันก่อนเพื่อความปลอดภัย
 */
function cancelReservation(bookingId, phone) {
  if (!bookingId) {
    return { success: false, message: 'Booking ID not found.' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: false, message: 'Booking not found (it may have already been cancelled).' };
    }

    var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][6]) === String(bookingId)) {
        if (phone && String(data[i][5]).trim() !== String(phone).trim()) {
          return { success: false, message: 'Phone number does not match this booking.' };
        }
        sheet.deleteRow(i + 2);
        SpreadsheetApp.flush();
        return { success: true, message: 'Booking cancelled successfully.' };
      }
    }
    return { success: false, message: 'Booking not found (it may have already been cancelled).' };
  } finally {
    lock.releaseLock();
  }
}
