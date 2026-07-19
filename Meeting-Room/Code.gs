// ============================================================
//  ระบบจองห้องประชุม นครสวรรค์  —  Code.gs
// ============================================================

const SPREADSHEET_ID      = "xxxxxxxxxxxxxxxxxxxxxxxx"; // ไอดีชีต
const SHEET_NAME          = "Reservations";
const SIGNATURE_FOLDER_ID = "xxxxxxxxxxxxxxxxxxxxxxxxxxx"; // ไอดีโฟลเดอร์

// ─── ตั้งค่า Telegram ───────────────────────────────────────
const TELEGRAM_BOT_TOKEN       = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxx";        // ใส่ token จาก @BotFather
const TELEGRAM_CHAT_ID         = "xxxxxxxxxxxxxxxxx";          // ใส่ chat_id ของ admin (แจ้งเตือนตอนมีการจองใหม่)
const TELEGRAM_MAEBAAN_CHAT_ID = "xxxxxxxxxxxxx";   // ใส่ chat_id ของแม่บ้าน (แจ้งเตือนตอนอนุมัติแล้ว ให้เตรียมของ/พิมพ์ PDF)

// ─── ตั้งค่า Admin Password ─────────────────────────────────
const ADMIN_PASSWORD = "admin1234";  // เปลี่ยนตามต้องการ

// ─── ตั้งค่าอีเมลผู้ส่ง (แสดงชื่อใน "From") ──────────────────
const MAIL_SENDER_NAME = "ระบบจองห้องประชุม วท.บ.สาขาวิชาสุขภาพดิจิทัล";

// ------------------------------------------------------------
//  Web App Entry Point
// ------------------------------------------------------------
function doGet(e) {
  const page = e && e.parameter && e.parameter.page;

  let html;

  if (page === 'admin') {
    html = HtmlService.createTemplateFromFile("admin")
      .evaluate()
      .setTitle("Admin — ระบบจองห้องประชุม");
  } else {
    html = HtmlService.createTemplateFromFile("index")
      .evaluate()
      .setTitle("ระบบจองห้องประชุม วท.บ.สุขภาพดิจิทัล");
  }

  return html
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0");
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
  var months = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
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

  // นับเฉพาะแถวที่ status ไม่ใช่ "ปฏิเสธ"
  return data.slice(1)
    .filter(function(r) {
      return r[0] && r[1] === room && parseRowDate(r[0]) === date
             && r[12] !== 'ปฏิเสธ';
    })
    .map(function(r) {
      return { start: parseRowTime(r[2]), end: parseRowTime(r[3]) };
    });
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
      status       : (data[i][12] || "รอพิจารณา").toString()
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
  // opts: { isApproved, name, room, date, start, end, project, qty, reason }
  var accent   = opts.isApproved ? "#15803d" : "#991b1b";
  var accentBg = opts.isApproved ? "#dcfce7" : "#fee2e2";
  var headLine = opts.isApproved ? "✅ การจองห้องประชุมได้รับการอนุมัติ" : "❌ การจองห้องประชุมไม่ได้รับการอนุมัติ";
  var introMsg = opts.isApproved
    ? "การจองห้องประชุมของท่านได้รับการอนุมัติแล้ว กรุณาเข้าระบบเพื่อดาวน์โหลดแบบฟอร์ม PDF สำหรับใช้เป็นเอกสารยืนยัน"
    : "ขออภัยในความไม่สะดวก การจองห้องประชุมของท่านไม่ได้รับการอนุมัติในครั้งนี้";

  var reasonBlock = "";
  if (!opts.isApproved) {
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
  var lines = [];
  lines.push(opts.isApproved ? "การจองห้องประชุมได้รับการอนุมัติ" : "การจองห้องประชุมไม่ได้รับการอนุมัติ");
  lines.push("");
  lines.push("เรียน คุณ" + opts.name);
  lines.push("");
  lines.push("ห้องประชุม : " + opts.room);
  lines.push("วันที่      : " + formatDateThaiLong_(opts.date));
  lines.push("เวลา       : " + opts.start + " – " + opts.end + " น.");
  lines.push("โครงการ    : " + opts.project);
  if (!opts.isApproved) {
    lines.push("");
    lines.push("เหตุผล: " + (opts.reason || "ไม่ระบุ"));
  }
  lines.push("");
  lines.push("สำนักงานสาขา นครสวรรค์");
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
    var subject = (opts.isApproved ? "✅ อนุมัติการจองห้องประชุม — " : "❌ ไม่อนุมัติการจองห้องประชุม — ") + opts.project;
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
  sheet.getRange(realRow, 13).setValue("อนุมัติ");

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
    isApproved: true, name: name, room: room, date: date,
    start: start, end: end, project: project, qty: qty
  });

  // ─ แจ้งเตือน Telegram (ระยะที่ 2) : แจ้งแม่บ้านให้เตรียมของ + พร้อมพิมพ์ PDF ─
  var baseUrl = "";
  try { baseUrl = ScriptApp.getService().getUrl(); } catch (e) { baseUrl = ""; }

  var maidMsg = "🧺 <b>การจองห้องประชุมได้รับการอนุมัติแล้ว — กรุณาเตรียมการ</b>\n\n"
    + "📍 ห้อง    : " + room + "\n"
    + "📅 วันที่   : " + formatDateThaiLong_(date) + "\n"
    + "⏰ เวลา    : " + start + " – " + end + " น.\n"
    + "📌 เรื่อง   : " + project + "\n"
    + "👤 ผู้จอง   : " + name + " (" + position + ")\n"
    + "☎️ โทร     : " + phone + "\n"
    + "👥 จำนวน   : " + qty + " คน\n"
    + "🍱 รายการ  : " + (equipment || "-") + "\n\n"
    + "กรุณาเตรียมสถานที่และอาหารตามรายการข้างต้น พร้อมเข้าเว็บระบบเพื่อพิมพ์เอกสาร PDF ยืนยันการจอง (แท็บ \"ปฏิทิน & ประวัติการจอง\")"
    + (baseUrl ? "\n🔗 " + baseUrl : "");

  var maidSent = sendTelegramNotification_(maidMsg, TELEGRAM_MAEBAAN_CHAT_ID);
  if (!maidSent) {
    Logger.log("⚠️ แจ้งเตือนแม่บ้านไม่สำเร็จสำหรับแถว " + rowId + " — ดู log ด้านบนสำหรับรายละเอียด error จาก Telegram");
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
  sheet.getRange(realRow, 13).setValue("ปฏิเสธ");

  var row = sheet.getRange(realRow, 1, 1, 13).getValues()[0];
  var email   = (row[11] || "").toString();
  var name    = (row[7]  || "").toString();
  var project = (row[4]  || "").toString();
  var date    = parseRowDate(row[0]);
  var room    = (row[1]  || "").toString();
  var start   = parseRowTime(row[2]);
  var end     = parseRowTime(row[3]);

  var emailSent = sendDecisionEmail_(email, {
    isApproved: false, name: name, room: room, date: date,
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
//  saveSignatureToDrive
// ------------------------------------------------------------
function saveSignatureToFile_(base64Data, filename) {
  var raw   = base64Data.replace(/^data:image\/\w+;base64,/, "");
  var blob  = Utilities.newBlob(Utilities.base64Decode(raw), "image/png", filename);
  var folder= DriveApp.getFolderById(SIGNATURE_FOLDER_ID);
  var file  = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/uc?export=view&id=" + file.getId();
}

// ------------------------------------------------------------
//  getSignatureBase64 — ดึงไฟล์ลายเซ็นจาก Drive แล้วแปลงเป็น base64 data URI
//  ใช้แทนการ <img src="...drive.google.com..."> ตรงๆ ในหน้าเว็บ เพราะ
//  ลิงก์ Drive ไม่ส่ง CORS header ทำให้ html2canvas ไม่สามารถอ่านรูปมาวาด
//  ลงบน PDF ได้ (ได้ PDF ที่ไม่มีลายเซ็น) การแปลงเป็น base64 ฝั่งเซิร์ฟเวอร์
//  แล้วส่งเป็น data URI ให้ฝั่ง client จะไม่มีปัญหา CORS/taint canvas อีก
// ------------------------------------------------------------
function getSignatureBase64(url) {
  try {
    if (!url) return "";
    var m = url.match(/id=([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    var fileId = m ? m[1] : "";
    if (!fileId) return "";

    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var mimeType = blob.getContentType() || "image/png";
    var base64 = Utilities.base64Encode(blob.getBytes());
    return "data:" + mimeType + ";base64," + base64;
  } catch (e) {
    Logger.log("getSignatureBase64 error: " + e);
    return "";
  }
}

// ------------------------------------------------------------
//  sendTelegramNotification_ — ส่งข้อความแจ้งเตือนไปยัง chat ที่ระบุ
//  chatId: ถ้าไม่ระบุ จะใช้ TELEGRAM_CHAT_ID (admin) เป็นค่าเริ่มต้น
//  คืนค่า true/false บอกผลว่าส่งสำเร็จจริงหรือไม่ (เช็คจาก response ของ Telegram)
//  พร้อม log รายละเอียด error ให้เห็นสาเหตุจริงเมื่อส่งไม่สำเร็จ
// ------------------------------------------------------------
function sendTelegramNotification_(text, chatId) {
  try {
    var targetChatId = chatId || TELEGRAM_CHAT_ID;
    if (!targetChatId) {
      Logger.log("sendTelegramNotification_: ไม่มี chat_id ปลายทาง ข้ามการส่ง");
      return false;
    }
    var url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
    var payload = { chat_id: targetChatId, text: text, parse_mode: "HTML" };
    var response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true   // ไม่ throw exception แต่เราจะเช็ค response เองด้านล่าง
    });

    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code !== 200) {
      // ★ ตรงนี้คือส่วนที่ขาดไปก่อนหน้านี้ — ทำให้มองไม่เห็นสาเหตุที่แม่บ้านไม่ได้รับแจ้งเตือน
      Logger.log("sendTelegramNotification_ FAILED chat_id=" + targetChatId
        + " httpCode=" + code + " response=" + body);
      return false;
    }

    Logger.log("sendTelegramNotification_ ส่งสำเร็จไปยัง chat_id=" + targetChatId);
    return true;

  } catch(e) {
    Logger.log("Telegram error: " + e);
    return false;
  }
}

// ------------------------------------------------------------
//  testTelegramMaebaan — ฟังก์ชันทดสอบ (ไม่เกี่ยวกับระบบจอง)
//  ใช้สำหรับดีบักโดยเฉพาะ: เปิด Apps Script editor แล้วเลือกรัน
//  ฟังก์ชันนี้ (Run > testTelegramMaebaan) จากนั้นดู Execution log
//  (View > Logs หรือ Ctrl+Enter) จะเห็น error จริงจาก Telegram เช่น
//  - "Bad Request: chat not found" → chat_id ผิด หรือบอทไม่เคยถูกเพิ่มเข้ากลุ่มนี้
//  - "Forbidden: bot was kicked from the group chat" → บอทถูกเตะออกจากกลุ่ม
//  - "Bad Request: group chat was upgraded to a supergroup chat"
//      → กลุ่มถูกอัปเกรดเป็น Supergroup แล้ว ID เปลี่ยนไปเป็นรูปแบบ
//        -100xxxxxxxxxx ต้องนำ migrate_to_chat_id ใน response ไปตั้งเป็น
//        TELEGRAM_MAEBAAN_CHAT_ID ตัวใหม่
// ------------------------------------------------------------
function testTelegramMaebaan() {
  var ok = sendTelegramNotification_("🔧 ทดสอบการแจ้งเตือนไปยังกลุ่มแม่บ้าน (ลบข้อความนี้ทิ้งได้)", TELEGRAM_MAEBAAN_CHAT_ID);
  Logger.log("ผลการทดสอบส่งไปยังกลุ่มแม่บ้าน: " + (ok ? "✅ สำเร็จ" : "❌ ไม่สำเร็จ — ดู log ด้านบนเพื่อดูสาเหตุจาก Telegram"));
}

// ------------------------------------------------------------
//  saveReservation — บันทึกพร้อมส่ง Telegram (ระยะที่ 1 แจ้ง admin)
// ------------------------------------------------------------
function saveReservation(formData) {
  try {
    var existing = getBookedSlots(formData.room, formData.date);
    var ns = formData.start_time, ne = formData.end_time;
    for (var i = 0; i < existing.length; i++) {
      var s = existing[i];
      if ((ns >= s.start && ns < s.end) ||
          (ne >  s.start && ne <= s.end) ||
          (ns <= s.start && ne >= s.end)) {
        return { success: false, message: "⚠️ ไม่สามารถจองได้ เนื่องจากช่วงเวลานี้ถูกจองไปแล้ว" };
      }
    }

    var signatureUrl = "";
    if (formData.signature && formData.signature.startsWith("data:image")) {
      var fname = "sig_" + formData.date + "_"
        + (formData.requester_name || "").replace(/\s/g,"_")
        + "_" + Date.now() + ".png";
      signatureUrl = saveSignatureToFile_(formData.signature, fname);
    }

    var eq = [];
    if (formData.eq_breakfast) eq.push("อาหารว่างเช้า: "  + (formData.eq_breakfast_qty || 0) + " ชุด");
    if (formData.eq_lunch)     eq.push("อาหารกลางวัน: "   + (formData.eq_lunch_qty     || 0) + " ชุด");
    if (formData.eq_afternoon) eq.push("อาหารว่างบ่าย: "  + (formData.eq_afternoon_qty || 0) + " ชุด");

    // column: A=date, B=room, C=start, D=end, E=project, F=qty, G=equipment,
    //         H=name, I=position, J=phone, K=signatureUrl, L=email, M=status
    SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(SHEET_NAME)
      .appendRow([
        formData.date,
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
        "รอพิจารณา"             // ← column M
      ]);

    // ─ แจ้ง Telegram (ระยะที่ 1) : แจ้ง admin ว่ามีคำขอจองใหม่ ─
    var msg = "🔔 <b>มีคำขอจองห้องประชุมใหม่!</b>\n\n"
      + "👤 ผู้จอง : " + formData.requester_name + "\n"
      + "📍 ห้อง   : " + formData.room + "\n"
      + "📅 วันที่  : " + formData.date + "\n"
      + "⏰ เวลา   : " + formData.start_time + " – " + formData.end_time + " น.\n"
      + "📌 เรื่อง  : " + formData.project_name + "\n"
      + "👥 จำนวน  : " + formData.participants + " คน\n"
      + "🍱 รายการ : " + (eq.join(", ") || "-") + "\n"
      + "📧 อีเมล  : " + (formData.email || "-") + "\n\n"
      + "กรุณาเข้าหน้า Admin เพื่อพิจารณา";
    sendTelegramNotification_(msg, TELEGRAM_CHAT_ID);

    return { success: true, message: "🎉 บันทึกการจองห้องประชุมเรียบร้อยแล้ว! กรุณารอการอนุมัติจากผู้ดูแลระบบ" };
  } catch (err) {
    return { success: false, message: "เกิดข้อผิดพลาด: " + err.toString() };
  }
}



// ------------------------------------------------------------
//  getTelegramUpdates — ตัวช่วยหา chat_id ที่ถูกต้องของกลุ่มแม่บ้าน
//  วิธีใช้:
//  1) เพิ่มบอทเข้ากลุ่มแม่บ้าน แล้วพิมพ์ข้อความอะไรก็ได้ในกลุ่มนั้น (เช่น "test")
//  2) เปิด Apps Script editor แล้วเลือกรันฟังก์ชันนี้ (Run > getTelegramUpdates)
//  3) ดู Logger log จะเห็น chat.id จริงของทุกแชทที่บอทเห็นข้อความล่าสุด
//     คัดลอกค่านั้น (รวมเครื่องหมายลบ) ไปใส่ TELEGRAM_MAEBAAN_CHAT_ID
// ------------------------------------------------------------
function getTelegramUpdates() {
  try {
    var url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/getUpdates";
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());
    if (!data.ok) {
      Logger.log("getUpdates error: " + response.getContentText());
      return;
    }
    if (!data.result.length) {
      Logger.log("ไม่พบ update ล่าสุด — กรุณาส่งข้อความในกลุ่มเป้าหมายก่อน แล้วรันใหม่ภายใน 24 ชม.");
      return;
    }
    data.result.forEach(function (u) {
      var chat = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat);
      if (chat) {
        Logger.log("chat.id = " + chat.id + " | type = " + chat.type + " | ชื่อ = " + (chat.title || chat.first_name || ""));
      }
    });
  } catch (e) {
    Logger.log("getTelegramUpdates error: " + e);
  }
}



















function forceAuthorize() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const folder = DriveApp.getRootFolder();
  const doc    = DocumentApp.create('_auth_test_');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  UrlFetchApp.fetch("https://api.telegram.org");
  MailApp.getRemainingDailyQuota();
  Logger.log('Authorization complete');
}
