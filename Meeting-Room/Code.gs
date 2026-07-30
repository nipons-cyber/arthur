// ============================================================
//  ระบบจองห้องประชุม  —  Code.gs
// ============================================================

const SPREADSHEET_ID      = "xxxxxxxxxxxxxxxxxxxxxxxx"; // ไอดีชีต
const SHEET_NAME          = "Reservations";

// ─── รายชื่อห้องประชุม + จำนวนที่นั่ง ───────────────────────
// หมายเหตุ: index.html ดึงรายการนี้มาสร้าง <select> โดยตรงผ่าน HTML template
// scriptlet (<? ROOMS ?>) เพื่อให้ฝั่ง client กับ server ใช้ข้อมูลชุดเดียวกันเสมอ
const ROOMS = [
  { name: "Stark 1",          seats: 6  },
  { name: "Maverick 2",       seats: 18 },
  { name: "Gump 3",           seats: 40 },
  { name: "Sherlock 4",       seats: 18 },
  { name: "Wayne 5",          seats: 6  },
  { name: "Thor 6",           seats: 6  },
  { name: "Hermione 7",       seats: 6  },
  { name: "Yoda 8",           seats: 30 },
  { name: "Platform 9-3/4",   seats: 8  },
  { name: "Natasha 10",       seats: 8  },
  { name: "Dumbledore 11",    seats: 18 },
  { name: "Hulk 12",          seats: 6  },
  { name: "Parker 13",        seats: 4  }
];

const REPEAT_FREQUENCIES = ["daily", "weekly", "monthly"];
const STATUS_PENDING   = "รอพิจารณา";
const STATUS_APPROVED  = "อนุมัติ";
const STATUS_REJECTED  = "ปฏิเสธ";
const STATUS_CANCELLED = "ยกเลิก";

// ─── ตั้งค่า LINE (Messaging API) ─────────────────────────────
// สร้าง LINE Official Account + Messaging API Channel ได้ฟรีที่
// https://developers.line.biz แล้วนำ "Channel access token" มาใส่ด้านล่าง
const LINE_CHANNEL_ACCESS_TOKEN = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // Messaging API > Channel access token
const LINE_ADMIN_TARGET_ID      = "xxxxxxxxxxxxxxxxx";             // userId หรือ groupId ของ admin (แจ้งเตือนตอนมีการจองใหม่)
const LINE_MAEBAAN_TARGET_ID    = "xxxxxxxxxxxxx";                 // userId หรือ groupId ของแม่บ้าน (แจ้งเตือนตอนอนุมัติแล้ว ให้เตรียมของ/พิมพ์ PDF)
// วิธีหา userId/groupId: ดูคอมเมนต์ที่ฟังก์ชัน doPost ด้านล่าง

// ─── ตั้งค่า Admin Password ─────────────────────────────────
const ADMIN_PASSWORD = "admin1234";  // เปลี่ยนตามต้องการ

// ─── ตั้งค่าอีเมลผู้ส่ง (แสดงชื่อใน "From") ──────────────────
const MAIL_SENDER_NAME = "ระบบจองห้องประชุม";

// ------------------------------------------------------------
//  Web App Entry Point
// ------------------------------------------------------------
function doGet(e) {
  const params = (e && e.parameter) || {};
  const page   = params.page;
  const action = params.action;

  // ปุ่มอนุมัติ/ปฏิเสธด่วนในข้อความ LINE (ไม่ต้อง login เข้าหน้า Admin)
  if (action === 'approve' || action === 'reject') {
    return handleQuickAction_(params);
  }

  let html;

  if (page === 'admin') {
    html = HtmlService.createTemplateFromFile("admin")
      .evaluate()
      .setTitle("Admin — ระบบจองห้องประชุม");
  } else {
    html = HtmlService.createTemplateFromFile("index")
      .evaluate()
      .setTitle("ระบบจองห้องประชุม");
  }

  return html
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0");
}

// ------------------------------------------------------------
//  doPost — รับ webhook event จาก LINE
//  ใช้หลักๆ เพื่อหา userId/groupId ของ admin/แม่บ้านตอนตั้งค่าครั้งแรก
//  (ปุ่มอนุมัติ/ปฏิเสธในข้อความเป็นลิงก์ธรรมดา ไม่ใช่ postback จึงไม่ต้องพึ่ง
//  webhook ตอนใช้งานจริง แต่ต้องเปิด webhook ไว้ตอนหา ID และให้ verify ผ่าน)
//
//  วิธีหา userId/groupId:
//  1) Deploy เว็บแอปนี้ แล้วนำ URL ที่ลงท้าย /exec ไปตั้งเป็น Webhook URL ที่
//     LINE Developers Console > Messaging API > Webhook settings
//     เปิด "Use webhook" แล้วกด Verify ให้ขึ้นสำเร็จ
//  2) เพิ่มบอทเป็นเพื่อน (สแกน QR ใน Console) แล้วพิมพ์ข้อความอะไรก็ได้ไปหาบอท
//     — ถ้าจะเอา groupId ให้เชิญบอทเข้ากลุ่มแล้วพิมพ์ข้อความในกลุ่มนั้นแทน
//  3) เปิด Apps Script > Executions ดู log ของ doPost จะเห็น userId/groupId
//     คัดลอกไปใส่ LINE_ADMIN_TARGET_ID หรือ LINE_MAEBAAN_TARGET_ID
// ------------------------------------------------------------
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(function(event) {
      var source = event.source || {};
      Logger.log("LINE event: type=" + event.type
        + " userId=" + (source.userId || "-")
        + " groupId=" + (source.groupId || "-")
        + " roomId=" + (source.roomId || "-"));
    });
  } catch (parseErr) {
    Logger.log("doPost parse error: " + parseErr);
  }
  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
//  handleQuickAction_ — ประมวลผลปุ่มอนุมัติ/ปฏิเสธด่วนจากข้อความ LINE
//  ตรวจสอบ id + token (สุ่มต่อรายการตอนบันทึกการจอง) แทนรหัสผ่าน Admin
//  token เดายากและใช้ได้แค่ครั้งเดียว (สถานะเปลี่ยนแล้วลิงก์จะใช้ซ้ำไม่ได้)
// ------------------------------------------------------------
function handleQuickAction_(params) {
  var id     = parseInt(params.id, 10);
  var token  = (params.token || "").toString();
  var action = params.action;

  if (isNaN(id) || !token || (action !== 'approve' && action !== 'reject')) {
    return quickActionPage_("ลิงก์ไม่ถูกต้อง", "พารามิเตอร์ของลิงก์ไม่ครบถ้วน", false);
  }

  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var realRow = id + 1;
  if (realRow < 2 || realRow > sheet.getLastRow()) {
    return quickActionPage_("ไม่พบรายการจองนี้", "รายการอาจถูกลบหรือลิงก์ไม่ถูกต้อง", false);
  }

  var row = sheet.getRange(realRow, 1, 1, 15).getValues()[0];
  var storedToken = (row[14] || "").toString();
  if (!storedToken || storedToken !== token) {
    return quickActionPage_("ลิงก์ไม่ถูกต้องหรือหมดอายุ", "กรุณาเข้าไปดำเนินการผ่านหน้า Admin แทน", false);
  }

  var status = (row[12] || STATUS_PENDING).toString();
  if (status !== STATUS_PENDING) {
    return quickActionPage_("รายการนี้ถูกดำเนินการไปแล้ว", "สถานะปัจจุบัน: " + status, false);
  }

  var result = (action === 'approve')
    ? approveReservation(ADMIN_PASSWORD, id)
    : rejectReservation(ADMIN_PASSWORD, id, "ปฏิเสธผ่านปุ่มด่วนจาก LINE");

  var title = action === 'approve' ? "✅ อนุมัติเรียบร้อยแล้ว" : "❌ บันทึกการปฏิเสธแล้ว";
  return quickActionPage_(title, result.message, true);
}

// ------------------------------------------------------------
//  quickActionPage_ — หน้ายืนยันผลแบบง่ายๆ หลังกดปุ่มอนุมัติ/ปฏิเสธด่วน
// ------------------------------------------------------------
function quickActionPage_(title, message, success) {
  var color = success ? "#16a34a" : "#dc2626";
  var icon  = success ? "✅" : "⚠️";
  var html =
    '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + title + '</title>' +
    '<style>' +
      'body{font-family:Tahoma,Arial,sans-serif;background:#f1f5f9;display:flex;' +
        'align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box;}' +
      '.box{background:#fff;border-radius:16px;padding:36px 32px;max-width:420px;width:100%;' +
        'text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08);}' +
      '.icon{font-size:48px;margin-bottom:12px;}' +
      'h1{font-size:20px;color:' + color + ';margin:0 0 10px;}' +
      'p{color:#475569;font-size:14px;line-height:1.7;margin:0;}' +
    '</style></head><body>' +
    '<div class="box"><div class="icon">' + icon + '</div><h1>' + title + '</h1><p>' + (message || "") + '</p></div>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ------------------------------------------------------------
//  getAdminUrl — คืน URL ของหน้า Admin จาก Web App ที่ deploy จริง
//  (ใช้แทนการเดา query string เอง เพื่อให้ลิงก์ใช้งานได้จริงเสมอ
//   ไม่ว่าจะ deploy ใหม่/deploy ซ้ำกี่ครั้งก็ตาม)
// ------------------------------------------------------------
function getAdminUrl() {
  try {
    var base = ScriptApp.getService().getUrl(); // URL ของ Web App ปัจจุบัน
    if (!base) return "";
    return base + "?page=admin";
  } catch (e) {
    Logger.log("getAdminUrl error: " + e);
    return "";
  }
}

// ------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------
function parseRowDate(v) {
  if (!v) return "";
  var d = v instanceof Date ? v : new Date(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function parseRowTime(v) {
  if (!v) return "";
  if (v instanceof Date)
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm");
  return v.toString();
}

function formatDateThaiLong_(dateStr) {
  if (!dateStr) return "";
  var parts = dateStr.split("-");
  var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
  var months = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
  return d + " " + months[m - 1] + " " + (y + 543);
}

// ------------------------------------------------------------
//  getBookedSlots
// ------------------------------------------------------------
function getBookedSlots(room, date) {
  var data = SpreadsheetApp
    .openById(SPREADSHEET_ID)
    .getSheetByName(SHEET_NAME)
    .getDataRange().getValues();
  return filterBookedRows_(data, room, date);
}

// นับเฉพาะแถวที่ยังมีผลอยู่ (ไม่ใช่แถวที่ถูกปฏิเสธหรือยกเลิกไปแล้ว)
// แยกเป็นฟังก์ชันกลางเพื่อให้ saveReservation เช็คหลายวันพร้อมกัน (จองซ้ำ)
// ได้จากข้อมูลชีตที่อ่านมาครั้งเดียว แทนที่จะเปิดชีตซ้ำทีละวัน
function filterBookedRows_(data, room, date) {
  return data.slice(1)
    .filter(function(r) {
      return r[0] && r[1] === room && parseRowDate(r[0]) === date
             && r[12] !== STATUS_REJECTED && r[12] !== STATUS_CANCELLED;
    })
    .map(function(r) {
      return { start: parseRowTime(r[2]), end: parseRowTime(r[3]) };
    });
}

// ------------------------------------------------------------
//  ตัวช่วยคำนวณวันที่สำหรับการจองซ้ำ (Daily / Weekly / Monthly)
// ------------------------------------------------------------
function findRoom_(roomName) {
  for (var i = 0; i < ROOMS.length; i++) {
    if (ROOMS[i].name === roomName) return ROOMS[i];
  }
  return null;
}

function parseDateStrParts_(dateStr) {
  var p = dateStr.split("-");
  return { y: parseInt(p[0], 10), m: parseInt(p[1], 10), d: parseInt(p[2], 10) };
}

function formatDateParts_(y, m, d) {
  var mm = (m < 10 ? "0" : "") + m;
  var dd = (d < 10 ? "0" : "") + d;
  return y + "-" + mm + "-" + dd;
}

function daysInMonth_(y, m) {
  return new Date(y, m, 0).getDate(); // m นับ 1-12; new Date(y, m, 0) = วันสุดท้ายของเดือน m
}

function addDaysToDateStr_(dateStr, days) {
  var p = parseDateStrParts_(dateStr);
  var d = new Date(p.y, p.m - 1, p.d);
  d.setDate(d.getDate() + days);
  return formatDateParts_(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// บวกจำนวนเดือน โดย clamp วันที่ให้ไม่เกินวันสุดท้ายของเดือนปลายทาง
// เช่น 31 ม.ค. + 1 เดือน = 28/29 ก.พ. (ไม่ใช่ 2/3 มี.ค.)
function addMonthsClampedToDateStr_(dateStr, months) {
  var p = parseDateStrParts_(dateStr);
  var totalMonths = (p.m - 1) + months;
  var y = p.y + Math.floor(totalMonths / 12);
  var m = (totalMonths % 12) + 1;
  var d = Math.min(p.d, daysInMonth_(y, m));
  return formatDateParts_(y, m, d);
}

function computeRepeatDates_(startDateStr, freq, count) {
  var dates = [startDateStr];
  for (var i = 1; i < count; i++) {
    if (freq === "daily")        dates.push(addDaysToDateStr_(startDateStr, i));
    else if (freq === "weekly")  dates.push(addDaysToDateStr_(startDateStr, i * 7));
    else if (freq === "monthly") dates.push(addMonthsClampedToDateStr_(startDateStr, i));
  }
  return dates;
}

// ------------------------------------------------------------
//  getAllReservations — สำหรับผู้ใช้ทั่วไป
// ------------------------------------------------------------
function getAllReservations() {
  var data = SpreadsheetApp
    .openById(SPREADSHEET_ID)
    .getSheetByName(SHEET_NAME)
    .getDataRange().getValues();

  var events = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    events.push({
      id           : i,
      date         : parseRowDate(data[i][0]),
      room         : (data[i][1]  || "").toString(),
      start        : parseRowTime(data[i][2]),
      end          : parseRowTime(data[i][3]),
      project      : (data[i][4]  || "").toString(),
      qty          : (data[i][5]  || "0").toString(),
      equipment    : (data[i][6]  || "").toString(),
      name         : (data[i][7]  || "").toString(),
      position     : (data[i][8]  || "").toString(),
      phone        : (data[i][9]  || "").toString(),
      signatureUrl : (data[i][10] || "").toString(),
      email        : (data[i][11] || "").toString(),
      status       : (data[i][12] || STATUS_PENDING).toString(),
      repeatGroupId: (data[i][13] || "").toString()
    });
  }
  return events;
}

// ------------------------------------------------------------
//  getAllReservationsAdmin — สำหรับ admin (มี password guard)
// ------------------------------------------------------------
function getAllReservationsAdmin(password) {
  if (password !== ADMIN_PASSWORD)
    return { error: "รหัสผ่านไม่ถูกต้อง" };
  return getAllReservations();
}

// ------------------------------------------------------------
//  buildEmailHtml_ — สร้างเทมเพลต HTML email กลาง ใช้ทั้งอนุมัติ/ปฏิเสธ
// ------------------------------------------------------------
function buildEmailHtml_(opts) {
  // opts: { kind: 'approved'|'rejected'|'cancelled', name, room, date, start, end, project, qty, reason }
  var kind = opts.kind || (opts.isApproved ? "approved" : "rejected"); // isApproved: เผื่อโค้ดเก่าเรียกแบบเดิม

  var accent   = kind === "approved" ? "#15803d" : kind === "cancelled" ? "#475569" : "#991b1b";
  var accentBg = kind === "approved" ? "#dcfce7" : kind === "cancelled" ? "#e2e8f0" : "#fee2e2";
  var headLine = kind === "approved"  ? "✅ การจองห้องประชุมได้รับการอนุมัติ"
               : kind === "cancelled" ? "🚫 การจองห้องประชุมถูกยกเลิก"
               :                        "❌ การจองห้องประชุมไม่ได้รับการอนุมัติ";
  var introMsg = kind === "approved"
    ? "การจองห้องประชุมของท่านได้รับการอนุมัติแล้ว กรุณาเข้าระบบเพื่อดาวน์โหลดแบบฟอร์ม PDF สำหรับใช้เป็นเอกสารยืนยัน"
    : kind === "cancelled"
      ? "การจองห้องประชุมของท่านถูกยกเลิกโดยผู้ดูแลระบบ"
      : "ขออภัยในความไม่สะดวก การจองห้องประชุมของท่านไม่ได้รับการอนุมัติในครั้งนี้";

  var reasonBlock = "";
  if (kind !== "approved") {
    reasonBlock =
      '<tr><td style="padding:14px 28px 0;">' +
        '<div style="background:#fff7f7;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;">' +
          '<div style="font-size:12px;font-weight:700;color:#991b1b;letter-spacing:.3px;margin-bottom:4px;">เหตุผล</div>' +
          '<div style="font-size:14px;color:#7f1d1d;line-height:1.6;">' + (opts.reason || "ไม่ระบุ") + '</div>' +
        '</div>' +
      '</td></tr>';
  }

  var html =
'<div style="background:#f1f5f9;padding:32px 16px;font-family:Tahoma,Arial,sans-serif;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,.08);">' +
    '<tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);background-color:#4f46e5;padding:28px 28px 22px;">' +
      '<div style="display:inline-block;background:rgba(255,255,255,.18);color:#e0e7ff;font-size:11px;font-weight:600;letter-spacing:.5px;padding:4px 12px;border-radius:100px;margin-bottom:10px;">สำนักงานหลักสูตร วท.บ.สุขภาพดิจิทัล</div><br>' +
      '<span style="font-family:Tahoma,Arial,sans-serif;font-size:20px;font-weight:700;color:#ffffff;">ระบบจองห้องประชุม</span>' +
    '</td></tr>' +
    '<tr><td style="padding:26px 28px 6px;">' +
      '<div style="display:inline-block;background:' + accentBg + ';color:' + accent + ';font-size:14px;font-weight:700;padding:6px 14px;border-radius:8px;margin-bottom:14px;">' + headLine + '</div>' +
      '<p style="font-size:14px;color:#334155;line-height:1.8;margin:10px 0 4px;">เรียน คุณ' + opts.name + '</p>' +
      '<p style="font-size:14px;color:#475569;line-height:1.8;margin:0;">' + introMsg + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px 4px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">' +
        '<tr><td style="padding:16px 18px;font-size:13.5px;color:#334155;line-height:2;">' +
          '<b style="color:#1e293b;">ห้องประชุม</b>&nbsp;&nbsp;' + opts.room + '<br>' +
          '<b style="color:#1e293b;">วันที่</b>&nbsp;&nbsp;' + formatDateThaiLong_(opts.date) + '<br>' +
          '<b style="color:#1e293b;">เวลา</b>&nbsp;&nbsp;' + opts.start + ' – ' + opts.end + ' น.<br>' +
          '<b style="color:#1e293b;">โครงการ/กิจกรรม</b>&nbsp;&nbsp;' + opts.project +
          (opts.qty ? '<br><b style="color:#1e293b;">จำนวนผู้เข้าร่วม</b>&nbsp;&nbsp;' + opts.qty + ' คน' : '') +
        '</td></tr>' +
      '</table>' +
    '</td></tr>' +
    reasonBlock +
    '<tr><td style="padding:22px 28px 26px;">' +
      '<p style="font-size:13px;color:#64748b;line-height:1.8;margin:0 0 4px;">หากมีข้อสงสัยกรุณาติดต่อเจ้าหน้าที่ผู้ดูแลระบบ</p>' +
      '<p style="font-size:13px;color:#64748b;line-height:1.8;margin:0;">ขอบคุณครับ/ค่ะ<br><b style="color:#475569;">สำนักงานหลักสูตร วท.บ.สุขภาพดิจิทัล</b></p>' +
    '</td></tr>' +
    '<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;text-align:center;">' +
      '<span style="font-size:11.5px;color:#94a3b8;">อีเมลนี้ส่งโดยระบบอัตโนมัติ กรุณาอย่าตอบกลับอีเมลนี้</span>' +
    '</td></tr>' +
  '</table>' +
'</div>';

  return html;
}

function buildEmailPlainText_(opts) {
  // ข้อความล้วนสำรอง สำหรับไคลเอนต์อีเมลที่ไม่รองรับ HTML
  var kind = opts.kind || (opts.isApproved ? "approved" : "rejected");
  var lines = [];
  lines.push(kind === "approved"  ? "การจองห้องประชุมได้รับการอนุมัติ"
           : kind === "cancelled" ? "การจองห้องประชุมถูกยกเลิก"
           :                        "การจองห้องประชุมไม่ได้รับการอนุมัติ");
  lines.push("");
  lines.push("เรียน คุณ" + opts.name);
  lines.push("");
  lines.push("ห้องประชุม : " + opts.room);
  lines.push("วันที่      : " + formatDateThaiLong_(opts.date));
  lines.push("เวลา       : " + opts.start + " – " + opts.end + " น.");
  lines.push("โครงการ    : " + opts.project);
  if (kind !== "approved") {
    lines.push("");
    lines.push("เหตุผล: " + (opts.reason || "ไม่ระบุ"));
  }
  lines.push("");
  lines.push("");
  return lines.join("\n");
}

// ------------------------------------------------------------
//  sendDecisionEmail_ — ส่งอีเมล HTML แจ้งผล พร้อม log ผลลัพธ์
// ------------------------------------------------------------
function sendDecisionEmail_(email, opts) {
  if (!email) {
    Logger.log("sendDecisionEmail_: ไม่มีอีเมลผู้รับ ข้ามการส่ง");
    return false;
  }
  try {
    var kind = opts.kind || (opts.isApproved ? "approved" : "rejected");
    var subjectPrefix = kind === "approved"  ? "✅ อนุมัติการจองห้องประชุม — "
                       : kind === "cancelled" ? "🚫 ยกเลิกการจองห้องประชุม — "
                       :                        "❌ ไม่อนุมัติการจองห้องประชุม — ";
    var subject = subjectPrefix + opts.project;
    MailApp.sendEmail({
      to       : email,
      subject  : subject,
      body     : buildEmailPlainText_(opts),
      htmlBody : buildEmailHtml_(opts),
      name     : MAIL_SENDER_NAME
    });
    Logger.log("ส่งอีเมลสำเร็จไปยัง: " + email);
    return true;
  } catch (e) {
    Logger.log("sendDecisionEmail_ ERROR ส่งอีเมลไม่สำเร็จ (" + email + "): " + e);
    return false;
  }
}

// ------------------------------------------------------------
//  approveReservation — admin อนุมัติ
// ------------------------------------------------------------
function approveReservation(password, rowId) {
  if (password !== ADMIN_PASSWORD)
    return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };

  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var realRow = parseInt(rowId) + 1;  // +1 เพราะ row 1 = header

  // อัปเดต column M (index 13) = status
  sheet.getRange(realRow, 13).setValue(STATUS_APPROVED);

  // ดึงข้อมูลแถวนั้นมาส่งอีเมล / แจ้งเตือน
  var row = sheet.getRange(realRow, 1, 1, 13).getValues()[0];
  var email     = (row[11] || "").toString();
  var name      = (row[7]  || "").toString();
  var project   = (row[4]  || "").toString();
  var date      = parseRowDate(row[0]);
  var room      = (row[1]  || "").toString();
  var start     = parseRowTime(row[2]);
  var end       = parseRowTime(row[3]);
  var qty       = (row[5]  || "").toString();
  var equipment = (row[6]  || "").toString();
  var position  = (row[8]  || "").toString();
  var phone     = (row[9]  || "").toString();

  var emailSent = sendDecisionEmail_(email, {
    kind: "approved", name: name, room: room, date: date,
    start: start, end: end, project: project, qty: qty
  });

  // ─ แจ้งเตือน LINE (ระยะที่ 2) : แจ้งแม่บ้านให้เตรียมของ + พร้อมพิมพ์ PDF ─
  var baseUrl = "";
  try { baseUrl = ScriptApp.getService().getUrl(); } catch (e) { baseUrl = ""; }

  var maidLines = [
    "📍 ห้อง: " + room,
    "📅 วันที่: " + formatDateThaiLong_(date),
    "⏰ เวลา: " + start + " – " + end + " น.",
    "📌 เรื่อง: " + project,
    "👤 ผู้จอง: " + name + " (" + position + ")",
    "☎️ โทร: " + phone,
    "👥 จำนวน: " + qty + " คน",
    "🥤 น้ำดื่ม: " + (equipment || "-"),
    "กรุณาเตรียมสถานที่และน้ำดื่มตามรายการข้างต้น พร้อมเข้าเว็บระบบเพื่อพิมพ์เอกสาร PDF ยืนยันการจอง (แท็บ \"ปฏิทิน & ประวัติการจอง\")"
  ];
  if (baseUrl) maidLines.push("🔗 " + baseUrl);

  var maidMsg = buildFlexNoticeMessage_("🧺 การจองห้องประชุมได้รับการอนุมัติแล้ว — กรุณาเตรียมการ", maidLines);
  var maidSent = sendLineMessage_(LINE_MAEBAAN_TARGET_ID, [maidMsg]);
  if (!maidSent) {
    Logger.log("⚠️ แจ้งเตือนแม่บ้านไม่สำเร็จสำหรับแถว " + rowId + " — ดู log ด้านบนสำหรับรายละเอียด error จาก LINE");
  }

  return {
    success: true,
    message: emailSent
      ? "อนุมัติเรียบร้อยแล้ว และส่งอีเมลแจ้งผู้จองแล้ว"
      : "อนุมัติเรียบร้อยแล้ว (ไม่สามารถส่งอีเมลได้ — โปรดตรวจสอบอีเมลผู้จองหรือสิทธิ์การส่งเมล)"
  };
}

// ------------------------------------------------------------
//  rejectReservation — admin ปฏิเสธ
// ------------------------------------------------------------
function rejectReservation(password, rowId, reason) {
  if (password !== ADMIN_PASSWORD)
    return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };

  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var realRow = parseInt(rowId) + 1;
  sheet.getRange(realRow, 13).setValue(STATUS_REJECTED);

  var row = sheet.getRange(realRow, 1, 1, 13).getValues()[0];
  var email   = (row[11] || "").toString();
  var name    = (row[7]  || "").toString();
  var project = (row[4]  || "").toString();
  var date    = parseRowDate(row[0]);
  var room    = (row[1]  || "").toString();
  var start   = parseRowTime(row[2]);
  var end     = parseRowTime(row[3]);

  var emailSent = sendDecisionEmail_(email, {
    kind: "rejected", name: name, room: room, date: date,
    start: start, end: end, project: project, reason: reason
  });

  return {
    success: true,
    message: emailSent
      ? "บันทึกการปฏิเสธเรียบร้อยแล้ว และส่งอีเมลแจ้งผู้จองแล้ว"
      : "บันทึกการปฏิเสธเรียบร้อยแล้ว (ไม่สามารถส่งอีเมลได้ — โปรดตรวจสอบอีเมลผู้จองหรือสิทธิ์การส่งเมล)"
  };
}

// ------------------------------------------------------------
//  cancelReservation — admin ยกเลิกการจอง 1 รายการ
//  (ใช้กับรายการที่ "รอพิจารณา" หรือ "อนุมัติ" ไปแล้วก็ได้ เผื่อลูกค้าแจ้งยกเลิกทีหลัง)
// ------------------------------------------------------------
function cancelReservation(password, rowId, reason) {
  if (password !== ADMIN_PASSWORD)
    return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };

  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var realRow = parseInt(rowId) + 1;
  sheet.getRange(realRow, 13).setValue(STATUS_CANCELLED);

  var row = sheet.getRange(realRow, 1, 1, 13).getValues()[0];
  var email   = (row[11] || "").toString();
  var name    = (row[7]  || "").toString();
  var project = (row[4]  || "").toString();
  var date    = parseRowDate(row[0]);
  var room    = (row[1]  || "").toString();
  var start   = parseRowTime(row[2]);
  var end     = parseRowTime(row[3]);

  var emailSent = sendDecisionEmail_(email, {
    kind: "cancelled", name: name, room: room, date: date,
    start: start, end: end, project: project, reason: reason
  });

  return {
    success: true,
    message: emailSent
      ? "ยกเลิกรายการเรียบร้อยแล้ว และส่งอีเมลแจ้งผู้จองแล้ว"
      : "ยกเลิกรายการเรียบร้อยแล้ว (ไม่สามารถส่งอีเมลได้ — โปรดตรวจสอบอีเมลผู้จองหรือสิทธิ์การส่งเมล)"
  };
}

// ------------------------------------------------------------
//  cancelReservationGroup — admin ยกเลิกการจองซ้ำทั้งชุด (repeat booking)
//  โดยยกเลิกทุกแถวที่มี repeatGroupId (column N) ตรงกัน และยังไม่ถูกยกเลิก/ปฏิเสธไปก่อนแล้ว
// ------------------------------------------------------------
function cancelReservationGroup(password, groupId, reason) {
  if (password !== ADMIN_PASSWORD)
    return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };
  if (!groupId)
    return { success: false, message: "ไม่พบชุดการจองซ้ำนี้" };

  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var data  = sheet.getDataRange().getValues();

  var name = "", email = "", project = "", room = "", start = "", end = "";
  var cancelledDates = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if ((row[13] || "").toString() !== groupId) continue;
    var status = (row[12] || STATUS_PENDING).toString();
    if (status === STATUS_CANCELLED || status === STATUS_REJECTED) continue;

    sheet.getRange(i + 1, 13).setValue(STATUS_CANCELLED);
    cancelledDates.push(formatDateThaiLong_(parseRowDate(row[0])));

    name    = (row[7]  || "").toString();
    email   = (row[11] || "").toString();
    project = (row[4]  || "").toString();
    room    = (row[1]  || "").toString();
    start   = parseRowTime(row[2]);
    end     = parseRowTime(row[3]);
  }

  if (!cancelledDates.length)
    return { success: false, message: "ไม่พบรายการในชุดนี้ที่สามารถยกเลิกได้ (อาจถูกยกเลิกไปแล้วทั้งหมด)" };

  var emailSent = sendDecisionEmail_(email, {
    kind: "cancelled", name: name, room: room,
    date: "", start: start, end: end, project: project,
    reason: (reason || "") + "\nยกเลิกทั้งชุด (" + cancelledDates.length + " วัน): " + cancelledDates.join(", ")
  });

  return {
    success: true,
    message: "ยกเลิกทั้งชุด " + cancelledDates.length + " รายการเรียบร้อยแล้ว"
      + (emailSent ? " และส่งอีเมลแจ้งผู้จองแล้ว" : " (ไม่สามารถส่งอีเมลได้)")
  };
}

// ------------------------------------------------------------
//  cancelReservationByRequester — ผู้จองยกเลิกการจองของตัวเอง
//  ไม่ต้องผ่านการอนุมัติของ Admin ยืนยันตัวตนด้วยอีเมลที่ใช้ตอนจอง
//  (ต้องตรงกับที่บันทึกไว้ในแถวนั้นเป๊ะๆ ถึงจะยกเลิกได้)
// ------------------------------------------------------------
function cancelReservationByRequester(id, email) {
  var realRow = parseInt(id, 10) + 1;

  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (isNaN(realRow) || realRow < 2 || realRow > sheet.getLastRow()) {
    return { success: false, message: "ไม่พบรายการจองนี้" };
  }

  var row = sheet.getRange(realRow, 1, 1, 13).getValues()[0];
  var storedEmail = (row[11] || "").toString().trim().toLowerCase();
  var inputEmail  = (email || "").toString().trim().toLowerCase();
  if (!storedEmail || storedEmail !== inputEmail) {
    return { success: false, message: "อีเมลไม่ตรงกับที่ใช้ตอนจอง กรุณาตรวจสอบอีกครั้ง" };
  }

  var status = (row[12] || STATUS_PENDING).toString();
  if (status === STATUS_CANCELLED) {
    return { success: false, message: "รายการนี้ถูกยกเลิกไปแล้ว" };
  }
  if (status === STATUS_REJECTED) {
    return { success: false, message: "รายการนี้ถูกปฏิเสธไปแล้ว ไม่สามารถยกเลิกซ้ำได้" };
  }

  sheet.getRange(realRow, 13).setValue(STATUS_CANCELLED);

  var name    = (row[7] || "").toString();
  var project = (row[4] || "").toString();
  var date    = parseRowDate(row[0]);
  var room    = (row[1] || "").toString();
  var start   = parseRowTime(row[2]);
  var end     = parseRowTime(row[3]);

  sendDecisionEmail_(storedEmail, {
    kind: "cancelled", name: name, room: room, date: date,
    start: start, end: end, project: project,
    reason: "ยกเลิกโดยผู้จองเอง"
  });

  // แจ้งเตือน admin (และแม่บ้านถ้าอนุมัติไปแล้ว) เผื่อกำลังเตรียมของอยู่
  var cancelLines = [
    "👤 ผู้จอง: " + name,
    "📍 ห้อง: " + room,
    "📅 วันที่: " + formatDateThaiLong_(date),
    "⏰ เวลา: " + start + " – " + end + " น.",
    "📌 เรื่อง: " + project
  ];
  var cancelMsg = buildFlexNoticeMessage_("🚫 ผู้จองยกเลิกการจองด้วยตัวเอง", cancelLines);
  sendLineMessage_(LINE_ADMIN_TARGET_ID, [cancelMsg]);
  if (status === STATUS_APPROVED) {
    sendLineMessage_(LINE_MAEBAAN_TARGET_ID, [cancelMsg]);
  }

  return { success: true, message: "ยกเลิกการจองเรียบร้อยแล้ว" };
}

// ------------------------------------------------------------
//  getSignatureBase64 — คืนค่าลายเซ็น (base64 data URI) ให้ตรงตามที่เก็บไว้
//  ลายเซ็นถูกเก็บเป็น base64 data URI ตรงในเซลล์ชีตอยู่แล้ว (ดู saveReservation)
//  ฟังก์ชันนี้เก็บไว้เพื่อความเข้ากันได้กับ index.html เดิม และรองรับรายการ
//  เก่าที่เคยเก็บเป็นลิงก์ Drive ไว้ก่อนย้ายมาเก็บ base64 ตรงๆ (จะคืนค่าว่าง
//  เพราะไม่ใช้ DriveApp แล้ว — ระบบจะพิมพ์ PDF แบบไม่มีลายเซ็นสำหรับรายการเก่ากลุ่มนี้)
// ------------------------------------------------------------
function getSignatureBase64(url) {
  if (url && url.startsWith("data:image")) return url;
  return "";
}

// ------------------------------------------------------------
//  sendLineMessage_ — push ข้อความ (array ของ LINE message object) ไปยัง
//  userId/groupId ที่ระบุ ผ่าน LINE Messaging API
//  คืนค่า true/false บอกผลว่าส่งสำเร็จจริงหรือไม่ พร้อม log รายละเอียด
//  error ให้เห็นสาเหตุจริงเมื่อส่งไม่สำเร็จ
// ------------------------------------------------------------
function sendLineMessage_(targetId, messages) {
  try {
    if (!targetId) {
      Logger.log("sendLineMessage_: ไม่มี userId/groupId ปลายทาง ข้ามการส่ง");
      return false;
    }
    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      Logger.log("sendLineMessage_: ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN");
      return false;
    }
    var response = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + LINE_CHANNEL_ACCESS_TOKEN },
      payload: JSON.stringify({ to: targetId, messages: messages }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log("sendLineMessage_ FAILED to=" + targetId
        + " httpCode=" + code + " response=" + response.getContentText());
      return false;
    }

    Logger.log("sendLineMessage_ ส่งสำเร็จไปยัง " + targetId);
    return true;

  } catch (e) {
    Logger.log("LINE error: " + e);
    return false;
  }
}

function sendLineTextMessage_(targetId, text) {
  return sendLineMessage_(targetId, [{ type: "text", text: text }]);
}

// ------------------------------------------------------------
//  buildFlexNoticeMessage_ — สร้าง LINE Flex Message (การ์ดแจ้งเตือน)
//  lines: array ของบรรทัดข้อความ (string ธรรมดา)
//  approveUrl/rejectUrl: ถ้ามีทั้งคู่ จะมีปุ่ม "อนุมัติ/ปฏิเสธ" ต่อท้าย
// ------------------------------------------------------------
function buildFlexNoticeMessage_(title, lines, approveUrl, rejectUrl) {
  var bubble = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical", backgroundColor: "#4f46e5", paddingAll: "16px",
      contents: [{ type: "text", text: title, weight: "bold", size: "md", color: "#ffffff", wrap: true }]
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
      contents: lines.map(function(t) {
        return { type: "text", text: t, size: "sm", color: "#334155", wrap: true };
      })
    }
  };

  if (approveUrl && rejectUrl) {
    bubble.footer = {
      type: "box", layout: "horizontal", spacing: "sm", paddingAll: "12px",
      contents: [
        { type: "button", style: "primary", color: "#16a34a", height: "sm",
          action: { type: "uri", label: "อนุมัติ", uri: approveUrl } },
        { type: "button", style: "primary", color: "#dc2626", height: "sm",
          action: { type: "uri", label: "ปฏิเสธ", uri: rejectUrl } }
      ]
    };
  }

  return { type: "flex", altText: title.substring(0, 400), contents: bubble };
}

// ------------------------------------------------------------
//  testLineMaebaan — ฟังก์ชันทดสอบ (ไม่เกี่ยวกับระบบจอง)
//  ใช้สำหรับดีบักโดยเฉพาะ: เปิด Apps Script editor แล้วเลือกรันฟังก์ชันนี้
//  (Run > testLineMaebaan) จากนั้นดู Execution log (View > Logs) จะเห็น
//  error จริงจาก LINE ถ้าส่งไม่สำเร็จ (เช่น target ผิด, token หมดอายุ)
// ------------------------------------------------------------
function testLineMaebaan() {
  var ok = sendLineTextMessage_(LINE_MAEBAAN_TARGET_ID, "🔧 ทดสอบการแจ้งเตือนไปยังแม่บ้าน (ลบข้อความนี้ทิ้งได้)");
  Logger.log("ผลการทดสอบส่งไปยังแม่บ้าน: " + (ok ? "✅ สำเร็จ" : "❌ ไม่สำเร็จ — ดู log ด้านบนเพื่อดูสาเหตุจาก LINE"));
}

// ------------------------------------------------------------
//  saveReservation — บันทึกพร้อมส่ง LINE (ระยะที่ 1 แจ้ง admin)
// ------------------------------------------------------------
function saveReservation(formData) {
  try {
    var room = findRoom_(formData.room);
    if (!room) {
      return { success: false, message: "⚠️ ไม่พบห้องประชุมที่เลือก กรุณาเลือกห้องจากรายการ" };
    }

    var qty = parseInt(formData.participants, 10) || 0;
    if (qty > room.seats) {
      return {
        success: false,
        message: "⚠️ จำนวนผู้เข้าร่วม (" + qty + " คน) เกินความจุของห้อง " + room.name
          + " (รองรับสูงสุด " + room.seats + " ที่นั่ง)"
      };
    }

    var isRepeat = formData.repeat_enable === "yes";
    var freq     = formData.repeat_freq;
    var count    = isRepeat ? (parseInt(formData.repeat_count, 10) || 1) : 1;
    if (isRepeat && REPEAT_FREQUENCIES.indexOf(freq) === -1) {
      return { success: false, message: "⚠️ กรุณาเลือกความถี่การจองซ้ำให้ถูกต้อง" };
    }
    if (isRepeat && (count < 2 || count > 52)) {
      return { success: false, message: "⚠️ จำนวนครั้งที่จองซ้ำต้องอยู่ระหว่าง 2-52 ครั้ง" };
    }

    var dates = isRepeat ? computeRepeatDates_(formData.date, freq, count) : [formData.date];

    var sheet    = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    var allRows  = sheet.getDataRange().getValues();
    var ns = formData.start_time, ne = formData.end_time;
    var conflictDates = [];

    dates.forEach(function(dateStr) {
      var existing = filterBookedRows_(allRows, formData.room, dateStr);
      var conflict = existing.some(function(s) {
        return (ns >= s.start && ns < s.end) ||
               (ne >  s.start && ne <= s.end) ||
               (ns <= s.start && ne >= s.end);
      });
      if (conflict) conflictDates.push(formatDateThaiLong_(dateStr));
    });

    if (conflictDates.length) {
      return {
        success: false,
        message: "⚠️ ไม่สามารถจองได้ เนื่องจากช่วงเวลานี้ถูกจองไปแล้วในวันที่: " + conflictDates.join(", ")
      };
    }

    // เก็บลายเซ็นเป็น base64 data URI ตรงในเซลล์ชีตเลย (ไม่ผ่าน Google Drive)
    // เพื่อไม่ให้ระบบจองต้องพึ่งสิทธิ์ DriveApp ซึ่งมักติดปัญหา authorization/สิทธิ์
    // ขององค์กรที่ deploy — คอลัมน์นี้รองรับได้ถึง 50,000 ตัวอักษรต่อเซลล์
    var signatureUrl = (formData.signature && formData.signature.startsWith("data:image"))
      ? formData.signature
      : "";

    var eq = [];
    if (formData.eq_water) eq.push("น้ำดื่ม: " + (formData.eq_water_qty || 0) + " ขวด");

    var groupId = (isRepeat && dates.length > 1) ? ("RG-" + Utilities.getUuid()) : "";

    // column: A=date, B=room, C=start, D=end, E=project, F=qty, G=equipment,
    //         H=name, I=position, J=phone, K=signatureUrl, L=email, M=status,
    //         N=repeatGroupId, O=approvalToken (สำหรับปุ่มอนุมัติ/ปฏิเสธด่วนใน LINE)
    var insertedRows = []; // { id, token }
    dates.forEach(function(dateStr) {
      var token = Utilities.getUuid();
      sheet.appendRow([
        dateStr,
        formData.room,
        formData.start_time,
        formData.end_time,
        formData.project_name,
        formData.participants,
        eq.join(", "),
        formData.requester_name,
        formData.position,
        formData.phone,
        signatureUrl,
        formData.email || "",   // ← column L
        STATUS_PENDING,          // ← column M
        groupId                  // ← column N
      ]);
      var newRow = sheet.getLastRow();
      sheet.getRange(newRow, 15).setValue(token); // ← column O
      insertedRows.push({ id: newRow - 1, token: token });
    });

    // ปุ่มอนุมัติ/ปฏิเสธด่วน — ใส่ให้เฉพาะการจองแบบเดี่ยว (ไม่ใช่จองซ้ำ)
    // เพราะจองซ้ำมีหลายแถว/หลายโทเค็น ต้องพิจารณาทีละรายการผ่านหน้า Admin แทน
    var approveUrl = "", rejectUrl = "";
    if (insertedRows.length === 1) {
      var baseUrl = "";
      try { baseUrl = ScriptApp.getService().getUrl(); } catch (e) { baseUrl = ""; }
      if (baseUrl) {
        var r0 = insertedRows[0];
        approveUrl = baseUrl + "?action=approve&id=" + r0.id + "&token=" + r0.token;
        rejectUrl  = baseUrl + "?action=reject&id="  + r0.id + "&token=" + r0.token;
      }
    }

    // ─ แจ้ง LINE (ระยะที่ 1) : แจ้ง admin ว่ามีคำขอจองใหม่ ─
    var dateLine = dates.length > 1
      ? dates.map(function(x) { return formatDateThaiLong_(x); }).join(", ")
      : formData.date;
    var bookingLines = [
      "👤 ผู้จอง: " + formData.requester_name,
      "📍 ห้อง: " + formData.room,
      "📅 วันที่: " + dateLine,
      "⏰ เวลา: " + formData.start_time + " – " + formData.end_time + " น.",
      "📌 เรื่อง: " + formData.project_name,
      "👥 จำนวน: " + formData.participants + " คน",
      "🥤 น้ำดื่ม: " + (eq.join(", ") || "-"),
      "📧 อีเมล: " + (formData.email || "-")
    ];
    if (dates.length > 1) bookingLines.push("⚠️ จองซ้ำ กรุณาพิจารณาทีละรายการผ่านหน้า Admin");

    var bookingTitle = "🔔 คำขอจองห้องประชุมใหม่" + (dates.length > 1 ? " (จองซ้ำ " + dates.length + " ครั้ง)" : "");
    var bookingMsg = buildFlexNoticeMessage_(bookingTitle, bookingLines, approveUrl, rejectUrl);
    sendLineMessage_(LINE_ADMIN_TARGET_ID, [bookingMsg]);

    return {
      success: true,
      message: dates.length > 1
        ? "🎉 บันทึกการจองห้องประชุมแบบซ้ำเรียบร้อยแล้ว (" + dates.length + " ครั้ง)! กรุณารอการอนุมัติจากผู้ดูแลระบบ"
        : "🎉 บันทึกการจองห้องประชุมเรียบร้อยแล้ว! กรุณารอการอนุมัติจากผู้ดูแลระบบ"
    };
  } catch (err) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + err.toString() };
  }
}

// (หา userId/groupId ของ LINE ได้จากคอมเมนต์เหนือฟังก์ชัน doPost ด้านบนแทน)


















function forceAuthorize() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  UrlFetchApp.fetch("https://api.line.me");
  MailApp.getRemainingDailyQuota();
  Logger.log('Authorization complete');
}
