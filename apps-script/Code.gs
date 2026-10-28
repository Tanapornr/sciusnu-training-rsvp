/** SCiUS NU Training RSVP — paste into a spreadsheet-bound Apps Script project. */
var RSVP_TITLES = ['ศ.ดร.', 'รศ.ดร.', 'ผศ.ดร.', 'ดร.', 'นาย', 'นาง', 'นางสาว'];
var RSVP_AFFILIATIONS = [
  'โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร', 'คณะวิทยาศาสตร์', 'คณะวิทยาศาสตร์การแพทย์',
  'คณะเภสัชศาสตร์', 'คณะโลจิสติกส์และดิจิทัลซัพพลายเชน', 'คณะสหเวชศาสตร์',
  'คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติ และสิ่งแวดล้อม'
];
var RSVP_BASE_HEADERS = ['ลงทะเบียนเมื่อ (Asia/Bangkok)', 'รหัสลงทะเบียน', 'คำนำหน้า', 'ชื่อ-นามสกุล', 'สังกัด/คณะ', 'วันที่จัดโครงการ', 'Request ID', 'Participant key', 'Payload hash'];

var RSVP_HEADERS = RSVP_BASE_HEADERS.concat(['อีเมล', 'สถานะอีเมลเตือน', 'ส่งอีเมลเตือนเมื่อ', 'พยายามส่งเมื่อ', 'หมายเหตุอีเมลเตือน']);
var RSVP_REMINDER_AT = '2026-11-20T09:30:00+07:00';
var RSVP_REMINDER_END = '2026-11-21T00:00:00+07:00';

function doGet() { return rsvpJson_({ ok: true, service: 'sciusnu-training-rsvp', version: '1.2.0' }); }
function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SHARED_SECRET');
    var sheetId = props.getProperty('SPREADSHEET_ID');
    if (!secret || secret.length < 32 || !sheetId) return rsvpJson_({ ok: false, code: 'CONFIG_ERROR' });
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 10000) return rsvpJson_({ ok: false, code: 'VALIDATION_ERROR' });
    var envelope = JSON.parse(e.postData.contents);
    if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.timestamp !== 'string' || !/^\d{13}$/.test(envelope.timestamp) ||
        Math.abs(Date.now() - Number(envelope.timestamp)) > 300000 || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.signature)) {
      return rsvpJson_({ ok: false, code: 'UNAUTHORIZED' });
    }
    var expected = rsvpHex_(Utilities.computeHmacSha256Signature(envelope.timestamp + '.' + envelope.payload, secret, Utilities.Charset.UTF_8));
    if (!rsvpEqual_(expected, envelope.signature)) return rsvpJson_({ ok: false, code: 'UNAUTHORIZED' });
    var data = JSON.parse(envelope.payload);
    if (!data || typeof data !== 'object') return rsvpJson_({ ok: false, code: 'VALIDATION_ERROR' });
    var name = rsvpNormalize_(data.fullName);
    var email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (data.schemaVersion !== 2 || !rsvpValidEmail_(email)) return rsvpJson_({ ok: false, code: 'VALIDATION_ERROR' });
    if (RSVP_TITLES.indexOf(data.title) === -1 || RSVP_AFFILIATIONS.indexOf(data.affiliation) === -1 || name.length < 4 || name.length > 120 ||
        !/^[\p{L}\p{M}][\p{L}\p{M} .’'()\-]*$/u.test(name) || name.split(' ').length < 2 || data.eventDate !== '2026-11-21' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId || '') ||
        !/^[a-f0-9]{64}$/.test(data.clientKey || '')) return rsvpJson_({ ok: false, code: 'VALIDATION_ERROR' });
    // One registration per name for this event, regardless of title or affiliation.
    var nameKey = rsvpNameKey_(name);
    var participantKey = rsvpHash_(nameKey + '|2026-11-21');
    var payloadHash = rsvpHash_(JSON.stringify([data.title, name, email, data.affiliation, '2026-11-21']));
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(7000)) return rsvpJson_({ ok: false, code: 'BUSY' });
    try {
      var sheet = rsvpSheet_(sheetId, props.getProperty('SHEET_NAME') || 'Registrations');
      var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, RSVP_HEADERS.length).getValues() : [];
      // A retry after a network timeout returns the saved receipt without adding a row.
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][6] === data.requestId) return rsvpJson_(rows[i][8] === payloadHash ?
          { ok: true, code: 'ALREADY_SAVED', registrationId: rows[i][1], schemaVersion: 2 } : { ok: false, code: 'REQUEST_CONFLICT' });
      }
      for (var j = 0; j < rows.length; j++) {
        // Read the name so rows saved with the previous key format still match.
        if (String(rows[j][5]) === data.eventDate && rsvpNameKey_(rows[j][3]) === nameKey) {
          return rsvpJson_({ ok: false, code: 'DUPLICATE' });
        }
      }
      if (props.getProperty('REGISTRATION_OPEN') === 'false') return rsvpJson_({ ok: false, code: 'REGISTRATION_CLOSED' });
      // Shared script cache, inside the lock. Allows departments sharing a campus IP.
      // This is an abuse limit per network, never a quota per affiliation.
      var cache = CacheService.getScriptCache();
      var bucket = 'rsvp:' + data.clientKey + ':' + Math.floor(Date.now() / 600000);
      var count = Number(cache.get(bucket) || 0);
      if (count >= 120) return rsvpJson_({ ok: false, code: 'RATE_LIMITED' });
      cache.put(bucket, String(count + 1), 600);
      var registrationId = 'NU69-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
      var row = [Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'), registrationId,
        data.title, name, data.affiliation, '2026-11-21', data.requestId, participantKey, payloadHash, email,
        Date.now() < new Date(RSVP_REMINDER_AT).getTime() ? 'PENDING' : 'LATE', '', '', ''];
      // Text formatting and escaping defend against spreadsheet formula injection.
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, RSVP_HEADERS.length).setNumberFormat('@').setValues([row.map(rsvpCell_)]);
      SpreadsheetApp.flush();
      return rsvpJson_({ ok: true, code: 'CREATED', registrationId: registrationId, schemaVersion: 2 });
    } finally { lock.releaseLock(); }
  } catch (error) {
    console.error('RSVP processing failed');
    return rsvpJson_({ ok: false, code: 'INTERNAL_ERROR' });
  }
}

/** Run once from the editor after adding Script Properties. Never erases existing rows. */
function setupSheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Please set SPREADSHEET_ID in Script Properties.');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { rsvpSheet_(id, props.getProperty('SHEET_NAME') || 'Registrations'); }
  finally { lock.releaseLock(); }
}
function rsvpSheet_(id, name) {
  var book = SpreadsheetApp.openById(id);
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, RSVP_HEADERS.length).setValues([RSVP_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, RSVP_HEADERS.length).setBackground('#102d36').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setColumnWidth(4, 240);
    sheet.setColumnWidth(5, 420);
  } else {
    var headers = sheet.getRange(1, 1, 1, 9).getValues()[0];
    if (headers.join('|') !== RSVP_BASE_HEADERS.join('|')) throw new Error('Unexpected sheet headers. Use a new empty sheet name.');
    // Append columns J–N; never shift or overwrite the original registration columns.
    var tail = sheet.getRange(1, 10, 1, 5).getValues()[0];
    for (var col = 0; col < 5; col++) {
      if (tail[col] && tail[col] !== RSVP_HEADERS[col + 9]) throw new Error('Unexpected email columns');
      if (!tail[col] && sheet.getLastRow() > 1) {
        var occupied = sheet.getRange(2, col + 10, sheet.getLastRow() - 1, 1).getValues().some(function (row) { return row[0] !== ''; });
        if (occupied) throw new Error('Email migration would overwrite an unnamed column');
      }
    }
    sheet.getRange(1, 10, 1, 5).setValues([RSVP_HEADERS.slice(9)]);
  }
  return sheet;
}
function rsvpNormalize_(value) { return typeof value === 'string' ? value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim() : ''; }
function rsvpNameKey_(value) { return rsvpNormalize_(value).replace(/\s/g, '').toLowerCase(); }
function rsvpCell_(value) { var text = String(value); return /^[=+\-@\t\r\n]/.test(text) ? "'" + text : text; }
function rsvpHash_(value) { return rsvpHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)); }
function rsvpHex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
function rsvpEqual_(a, b) { var mismatch = a.length ^ b.length; for (var i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i); return mismatch === 0; }
function rsvpJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function rsvpValidEmail_(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\s,;<>\r\n]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parts[0]) && parts[1].includes('.') && parts[1].split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

/** Run from the editor after reviewing the email preview. Sends no email now. */
function setupEmailReminder() {
  if (Date.now() >= new Date(RSVP_REMINDER_AT).getTime()) throw new Error('The reminder date has passed. Do not schedule a past reminder.');
  var quota = MailApp.getRemainingDailyQuota(); // Requests send-mail authorization without sending.
  setupSheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('REMINDER_ENABLED', 'false');
  rsvpDeleteReminderTriggers_();
  try {
    ScriptApp.newTrigger('sendScheduledReminders').timeBased().at(new Date(RSVP_REMINDER_AT)).create();
    ScriptApp.newTrigger('sendScheduledReminders').timeBased().at(new Date('2026-11-20T09:40:00+07:00')).create();
    props.setProperties({ REMINDER_ENABLED: 'true', REMINDER_SCHEDULE: RSVP_REMINDER_AT, REMINDER_LAST_STATUS: 'SCHEDULED', REMINDER_QUOTA_AT_SETUP: String(quota) });
  } catch (error) { rsvpDeleteReminderTriggers_(); throw new Error('Reminder setup did not complete'); }
  console.log('Reminder scheduled for 20 November 2026, 09:30 Asia/Bangkok. No email sent during setup.');
}

/** A read-only preview returned to the editor; never sends a message. */
function previewReminderEmail() {
  var message = rsvpReminderMessage_({ title: 'นางสาว', fullName: 'ตัวอย่าง ผู้เข้าร่วม', affiliation: 'คณะวิทยาศาสตร์' });
  console.log(message.body);
  return message;
}

function rsvpReminderMessage_(person) {
  var name = (person.title + ' ' + person.fullName).trim();
  var maps = 'https://maps.app.goo.gl/oaKL7rKsn9W3KA5U8';
  var subject = 'แจ้งเตือนเข้าร่วมโครงการ วมว. วันที่ 21 พฤศจิกายน 2569';
  var body = 'เรียน ' + name + '\n\n' +
    'ขอแจ้งเตือนการเข้าร่วมโครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์ โครงการ วมว.\n' +
    'สังกัด/คณะ: ' + person.affiliation + '\n\n' +
    'วันเสาร์ที่ 21 พฤศจิกายน 2569 เวลา 09.00–16.00 น.\n' +
    'ณ ห้อง SC1-411 อาคารบริหาร คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร\n' +
    'แผนที่: ' + maps + '\n\n' +
    'กำหนดการ\n09.00–12.00 น. จิตวิทยาในการสอน\n13.00–16.00 น. เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา\n\n' +
    'สอบถามข้อมูลเพิ่มเติม 094-9426428 ธนาภรณ์ รอดฉ่ำ\n\n' +
    'ขอแสดงความนับถือ\nธนาภรณ์ รอดฉ่ำ';
  var html = `<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>แจ้งเตือนเข้าร่วมโครงการ วมว.</title></head>
<body style="margin:0;padding:0;background:#f5f6f3;color:#253d37;font-family:Tahoma,Arial,sans-serif;font-size:17px;line-height:1.9">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f6f3"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border:1px solid #e1e5de;border-radius:14px">
<tr><td style="padding:32px 30px 22px;border-bottom:1px solid #e9ece5"><img src="https://sciusnu-training-rsvp.vercel.app/images/logo-banner-scius.png" width="300" alt="โครงการ วมว. ศูนย์มหาวิทยาลัยนเรศวร" style="display:block;width:300px;max-width:100%;height:auto"><p style="margin:24px 0 5px;font-size:13px;letter-spacing:1.5px;color:#788579">SCiUS NU · TRAINING</p><h1 style="margin:0;font-size:27px;font-weight:600;line-height:1.6">แจ้งเตือนเข้าร่วมโครงการ</h1></td></tr>
<tr><td style="padding:26px 30px 30px"><p style="margin:0 0 22px">เรียน ${rsvpEscape_(name)}</p><p style="margin:0 0 8px;color:#6c796f;font-size:15px">ขอแจ้งเตือนการเข้าร่วม</p><p style="margin:0 0 22px;font-size:20px;line-height:1.8;font-weight:600">โครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์<br>โครงการ วมว.</p><p style="margin:0 0 24px;color:#627267;font-size:16px">สังกัด/คณะ: ${rsvpEscape_(person.affiliation)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8f4;border:1px solid #e5e8df;border-radius:10px"><tr><td style="padding:22px"><p style="margin:0 0 5px;color:#7b867b;font-size:14px">วันและเวลา</p><p style="margin:0 0 18px;font-size:20px;font-weight:600">วันเสาร์ที่ 21 พฤศจิกายน 2569<br><span style="font-size:17px;font-weight:400">09.00–16.00 น.</span></p><p style="margin:0 0 5px;color:#7b867b;font-size:14px">สถานที่</p><p style="margin:0 0 20px">ห้อง SC1-411 อาคารบริหาร<br>คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร</p><a href="${maps}" style="display:inline-block;color:#253d37;background:#fff;border:1px solid #bbc9bb;border-radius:7px;padding:9px 18px;text-decoration:none;font-size:16px">ดูแผนที่สถานที่จัดโครงการ ↗</a></td></tr></table>
<h2 style="margin:28px 0 12px;font-size:19px;font-weight:600">กำหนดการ</h2><p style="margin:0 0 14px"><span style="color:#748170;font-size:15px">09.00–12.00 น.</span><br>จิตวิทยาในการสอน</p><p style="margin:0 0 26px"><span style="color:#748170;font-size:15px">13.00–16.00 น.</span><br>เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา</p>
<p style="margin:0;padding:22px 0 0;border-top:1px solid #e9ece5;color:#647267;font-size:16px">สอบถามข้อมูลเพิ่มเติม<br><a href="tel:0949426428" style="color:#253d37;text-decoration:none">094-9426428</a> ธนาภรณ์ รอดฉ่ำ</p><p style="margin:26px 0 0;font-size:17px">ขอแสดงความนับถือ<br><strong style="font-weight:600">ธนาภรณ์ รอดฉ่ำ</strong></p></td></tr></table>
<p style="margin:18px 0 0;font-size:12px;color:#8a9388">โครงการ วมว. ศูนย์มหาวิทยาลัยนเรศวร</p></td></tr></table></body></html>`;
  return { subject: subject, body: body, htmlBody: html, name: 'SCiUS NU Training RSVP' };
}

function rsvpEscape_(value) { return String(value).replace(/[&<>"']/g, function (char) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]; }); }
function rsvpDeleteReminderTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (['sendScheduledReminders', 'rsvpReminderRetry'].indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
}
function rsvpReminderRetry() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === 'rsvpReminderRetry') ScriptApp.deleteTrigger(trigger); });
  return sendScheduledReminders();
}
function rsvpReminderRow_(sheet, id) {
  var count = sheet.getLastRow() - 1;
  if (count < 1) return 0;
  var ids = sheet.getRange(2, 2, count, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}
function rsvpReminderCandidate_(row) {
  return String(row[5]) === '2026-11-21' && String(row[0]) <= '2026-11-20 09:30:00' &&
    ['', 'PENDING'].indexOf(String(row[10] || '')) !== -1;
}

/** Read-only owner check; contains counts only, never participant names or addresses. */
function reminderSetupStatus() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var rows;
  try {
    var sheet = rsvpSheet_(props.getProperty('SPREADSHEET_ID'), props.getProperty('SHEET_NAME') || 'Registrations');
    rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, RSVP_HEADERS.length).getValues() : [];
  } finally { lock.releaseLock(); }
  var report = {
    enabled: props.getProperty('REMINDER_ENABLED') === 'true',
    scheduledAt: props.getProperty('REMINDER_SCHEDULE'),
    scheduledTriggers: ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'sendScheduledReminders'; }).length,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
    registrations: rows.length,
    validEmailCount: rows.filter(function (r) { return rsvpValidEmail_(typeof r[9] === 'string' ? r[9].trim().toLowerCase() : ''); }).length
  };
  console.log(JSON.stringify(report));
  return report;
}

/** Owner-triggered only. Not exposed by doGet or doPost. Never sends before the due date. */
function sendScheduledReminders() {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  if (props.getProperty('REMINDER_ENABLED') !== 'true') return { status: 'DISABLED', sent: 0 };
  if (now < new Date(RSVP_REMINDER_AT).getTime()) return { status: 'NOT_DUE', sent: 0 };
  if (now >= new Date(RSVP_REMINDER_END).getTime()) return { status: 'EXPIRED', sent: 0 };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var sheet;
  var rows;
  try {
    sheet = rsvpSheet_(props.getProperty('SPREADSHEET_ID'), props.getProperty('SHEET_NAME') || 'Registrations');
    rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, RSVP_HEADERS.length).getValues() : [];
  } finally { lock.releaseLock(); }
  var quota = MailApp.getRemainingDailyQuota();
  var sent = 0;
  var failed = 0;
  var pending = false;
  var budget = Math.min(50, Math.max(0, quota));
  for (var i = 0; i < rows.length; i++) {
    if (!rsvpReminderCandidate_(rows[i])) continue;
    if (sent + failed >= budget || Date.now() - now > 210000) { pending = true; continue; }
    var claimed;
    var registrationId = rows[i][1];
    lock.waitLock(10000);
    try {
      var rowNumber = rsvpReminderRow_(sheet, registrationId);
      if (!rowNumber) continue;
      var fresh = sheet.getRange(rowNumber, 1, 1, RSVP_HEADERS.length).getValues()[0];
      if (!rsvpReminderCandidate_(fresh)) continue;
      var email = typeof fresh[9] === 'string' ? fresh[9].trim().toLowerCase() : '';
      if (!rsvpValidEmail_(email)) {
        sheet.getRange(rowNumber, 11, 1, 4).setValues([[email ? 'INVALID_EMAIL' : 'MISSING_EMAIL', '', '', 'ผู้จัดต้องตรวจสอบอีเมล']]);
        SpreadsheetApp.flush(); continue;
      }
      // Claim durably before sending. SENDING and ERROR are never auto-retried.
      // This avoids duplicate reminders if execution stops after the email is accepted.
      sheet.getRange(rowNumber, 11, 1, 4).setValues([['SENDING', '', Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'), '']]);
      SpreadsheetApp.flush();
      claimed = { email: email, title: fresh[2], fullName: fresh[3], affiliation: fresh[4] };
    } finally { lock.releaseLock(); }
    if (!claimed) continue;
    var delivered = false;
    try { var mail = rsvpReminderMessage_(claimed); mail.to = claimed.email; MailApp.sendEmail(mail); delivered = true; sent++; }
    catch (error) { failed++; }
    lock.waitLock(10000);
    try {
      var target = rsvpReminderRow_(sheet, registrationId);
      if (target) {
        var current = sheet.getRange(target, 11, 1, 4).getValues()[0];
        if (current[0] === 'SENDING') {
          sheet.getRange(target, 11, 1, 4).setValues([[delivered ? 'SENT' : 'ERROR', delivered ? Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss') : '', current[2], delivered ? '' : 'SEND_FAILED_REVIEW: ตรวจสอบก่อนส่งใหม่']]);
          SpreadsheetApp.flush();
        }
      }
    } finally { lock.releaseLock(); }
  }
  var status = pending && quota === 0 ? 'QUOTA_EXHAUSTED' : pending ? 'PENDING' : failed ? 'NEEDS_REVIEW' : 'COMPLETE';
  props.setProperties({ REMINDER_LAST_STATUS: status, REMINDER_LAST_RUN: new Date().toISOString(), REMINDER_LAST_SENT_COUNT: String(sent) });
  if (pending && ScriptApp.getProjectTriggers().every(function (trigger) { return trigger.getHandlerFunction() !== 'rsvpReminderRetry'; })) {
    ScriptApp.newTrigger('rsvpReminderRetry').timeBased().after(quota === 0 ? 15 * 60000 : 60000).create();
  }
  return { status: status, sent: sent, failed: failed };
}
