/** SCiUS NU Training RSVP — paste into a spreadsheet-bound Apps Script project. */
var RSVP_TITLES = ['ศ.ดร.', 'รศ.ดร.', 'ผศ.ดร.', 'ดร.', 'นาย', 'นาง', 'นางสาว'];
var RSVP_AFFILIATIONS = [
  'โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร', 'คณะวิทยาศาสตร์', 'คณะวิทยาศาสตร์การแพทย์',
  'คณะเภสัชศาสตร์', 'คณะโลจิสติกส์และดิจิทัลซัพพลายเชน', 'คณะสหเวชศาสตร์',
  'คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติ และสิ่งแวดล้อม'
];
var RSVP_BASE_HEADERS = ['ลงทะเบียนเมื่อ (Asia/Bangkok)', 'รหัสลงทะเบียน', 'คำนำหน้า', 'ชื่อ-นามสกุล', 'สังกัด/คณะ', 'วันที่จัดโครงการ', 'Request ID', 'Participant key', 'Payload hash'];

var RSVP_HEADERS = RSVP_BASE_HEADERS.concat(['อีเมล', 'สถานะอีเมลเตือน', 'ส่งอีเมลเตือนเมื่อ', 'พยายามส่งเมื่อ', 'หมายเหตุอีเมลเตือน', 'สถานะอีเมลยืนยัน', 'ส่งอีเมลยืนยันเมื่อ', 'พยายามส่งอีเมลยืนยันเมื่อ', 'หมายเหตุอีเมลยืนยัน']);
var RSVP_REMINDER_AT = '2026-11-20T09:30:00+07:00';
var RSVP_REMINDER_END = '2026-11-21T00:00:00+07:00';

function doGet() { return rsvpJson_({ ok: true, service: 'sciusnu-training-rsvp', version: '1.3.1', confirmationEmail: true }); }
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
          { ok: true, code: 'ALREADY_SAVED', registrationId: rows[i][1], schemaVersion: 2, confirmationEmailStatus: String(rows[i][14] || 'UNKNOWN') } : { ok: false, code: 'REQUEST_CONFLICT' });
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
        Date.now() < new Date(RSVP_REMINDER_END).getTime() ? 'PENDING' : 'LATE', '', '', '', 'PENDING', '', '', ''];
      // Text formatting and escaping defend against spreadsheet formula injection.
      var savedRow = sheet.getLastRow() + 1;
      sheet.getRange(savedRow, 1, 1, RSVP_HEADERS.length).setNumberFormat('@').setValues([row.map(rsvpCell_)]);
      SpreadsheetApp.flush();
      // Send after releasing the registration lock below.
    } finally { lock.releaseLock(); }
    var confirmationStatus = rsvpSendConfirmation_(sheet, savedRow, row);
    return rsvpJson_({ ok: true, code: 'CREATED', registrationId: registrationId, schemaVersion: 2, confirmationEmailStatus: confirmationStatus });
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
    var tail = sheet.getRange(1, 10, 1, RSVP_HEADERS.length - 9).getValues()[0];
    for (var col = 0; col < RSVP_HEADERS.length - 9; col++) {
      if (tail[col] && tail[col] !== RSVP_HEADERS[col + 9]) throw new Error('Unexpected email columns');
      if (!tail[col] && sheet.getLastRow() > 1) {
        var occupied = sheet.getRange(2, col + 10, sheet.getLastRow() - 1, 1).getValues().some(function (row) { return row[0] !== ''; });
        if (occupied) throw new Error('Email migration would overwrite an unnamed column');
      }
    }
    sheet.getRange(1, 10, 1, RSVP_HEADERS.length - 9).setValues([RSVP_HEADERS.slice(9)]);
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
  var subject = 'แจ้งเตือนเข้าร่วมโครงการ วมว. | 21 พฤศจิกายน 2569';
  var body = 'เรียน ' + name + '\n\nขอแจ้งเตือนการเข้าร่วมโครงการในวันเสาร์ที่ 21 พฤศจิกายน 2569\n' +
    'ผู้เข้าร่วม: ' + name + '\nอีเมล: ' + person.email + '\nสังกัด/คณะ: ' + person.affiliation + '\n\n' +
    'ยืนยันการเข้าร่วมโครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์ โครงการ วมว.\n' +
    'วันเสาร์ที่ 21 พฤศจิกายน 2569 เวลา 09.00–16.00 น.\n' +
    'ณ ห้อง SC1-411 อาคารบริหาร คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร\nแผนที่: ' + maps + '\n\n' +
    '09.00–12.00 น. จิตวิทยาในการสอน\nผู้ช่วยศาสตราจารย์ ดร.ชนัดดา ภูหงษ์ทอง\nอาจารย์ประจำภาควิชาบริหาร วิจัยและพัฒนานวัตกรรมทางการศึกษา\nคณะศึกษาศาสตร์ มหาวิทยาลัยนเรศวร\n\n' +
    '13.00–16.00 น. เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา\nน.ส.ภัทราภรณ์ ธีระการณ์\nนักจิตวิทยาปฏิบัติการ กลุ่มงานจิตเวชและยาเสพติด โรงพยาบาลพุทธชินราช พิษณุโลก\n\n' +
    'สอบถามข้อมูลเพิ่มเติม 094-9426428 ธนาภรณ์ รอดฉ่ำ\n\nขอแสดงความนับถือ\nธนาภรณ์ รอดฉ่ำ';
  var html = `<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>แจ้งเตือนเข้าร่วมโครงการ | SCiUS NU</title></head>
<body style="margin:0;background:#f5f6f8;color:#233149;font-family:Prompt,Tahoma,Arial,sans-serif;line-height:1.8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e7eaf0;border-radius:16px;overflow:hidden">
<tr><td style="padding:25px 30px;background:#172235"><img src="https://sciusnu-training-rsvp.vercel.app/images/logo-banner-scius.png" width="330" alt="โครงการ วมว. ศูนย์มหาวิทยาลัยนเรศวร" style="display:block;width:330px;max-width:100%;height:auto"></td></tr>
<tr><td style="padding:30px"><p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;color:#e37531">EVENT REMINDER · 21 NOVEMBER 2026</p><h1 style="font-size:29px;line-height:1.5;margin:0 0 22px;color:#172235">แจ้งเตือนเข้าร่วมโครงการ</h1>
<p style="margin:0 0 22px;font-size:16px">เรียน ${rsvpEscape_(name)}<br>ขอแจ้งเตือนการเข้าร่วมโครงการในวันเสาร์ที่ 21 พฤศจิกายน 2569 ตามรายละเอียดด้านล่าง</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f2;border:1px solid #ffe5d0;border-radius:10px"><tr><td style="padding:20px;font-size:16px"><p style="margin:0 0 12px"><span style="font-size:13px;color:#91877e">ผู้เข้าร่วม</span><br><strong>${rsvpEscape_(name)}</strong></p><p style="margin:0 0 12px"><span style="font-size:13px;color:#91877e">อีเมล</span><br>${rsvpEscape_(person.email)}</p><p style="margin:0"><span style="font-size:13px;color:#91877e">สังกัด/คณะ</span><br>${rsvpEscape_(person.affiliation)}</p></td></tr></table>
<h2 style="font-size:20px;margin:27px 0 16px;line-height:1.8">โครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์<br>โครงการ วมว.</h2><p style="font-size:17px;margin:0 0 16px"><strong>วันเสาร์ที่ 21 พฤศจิกายน 2569</strong><br>เวลา 09.00–16.00 น.</p><p style="font-size:16px;margin:0 0 17px">ณ ห้อง SC1-411 อาคารบริหาร<br>คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร</p>
<a href="${maps}" style="display:inline-block;background:#fc7627;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:15px">ดูแผนที่สถานที่จัดโครงการ ↗</a>
<h2 style="font-size:20px;margin:30px 0 14px">กำหนดการและวิทยากร</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8ecf2;border-radius:10px"><tr><td style="padding:16px 18px;background:#fff5eb;font-size:14px;color:#d76e2b">ช่วงเช้า · 09.00–12.00 น.</td></tr><tr><td style="padding:18px"><h3 style="font-size:19px;margin:0 0 14px">จิตวิทยาในการสอน</h3><img src="https://sciusnu-training-rsvp.vercel.app/images/speaker-chanadda.png" width="84" alt="ผู้ช่วยศาสตราจารย์ ดร.ชนัดดา ภูหงษ์ทอง" style="display:block;width:84px;height:auto;border-radius:8px;margin-bottom:12px"><p style="font-size:16px;margin:0 0 7px;font-weight:bold">ผู้ช่วยศาสตราจารย์ ดร.ชนัดดา ภูหงษ์ทอง</p><p style="font-size:14px;color:#7a8596;margin:0">อาจารย์ประจำภาควิชาบริหาร<br>วิจัยและพัฒนานวัตกรรมทางการศึกษา<br>คณะศึกษาศาสตร์ มหาวิทยาลัยนเรศวร</p></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8ecf2;border-radius:10px;margin-top:14px"><tr><td style="padding:16px 18px;background:#fff5eb;font-size:14px;color:#d76e2b">ช่วงบ่าย · 13.00–16.00 น.</td></tr><tr><td style="padding:18px"><h3 style="font-size:19px;margin:0 0 14px;line-height:1.7">เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา</h3><p style="font-size:16px;margin:0 0 7px;font-weight:bold">น.ส.ภัทราภรณ์ ธีระการณ์</p><p style="font-size:14px;color:#7a8596;margin:0">นักจิตวิทยาปฏิบัติการ<br>กลุ่มงานจิตเวชและยาเสพติด<br>โรงพยาบาลพุทธชินราช พิษณุโลก</p></td></tr></table>
<p style="font-size:15px;color:#7b8595;margin:27px 0 20px;padding-top:20px;border-top:1px solid #e8ecf2">สอบถามข้อมูลเพิ่มเติม<br><a href="tel:0949426428" style="color:#d76e2b;text-decoration:none">094-9426428</a> ธนาภรณ์ รอดฉ่ำ</p><p style="font-size:16px;margin:0">ขอแสดงความนับถือ<br><strong>ธนาภรณ์ รอดฉ่ำ</strong></p></td></tr></table>
<p style="font-size:12px;color:#98a0ad;margin:17px 0">SCiUS NU Training RSVP · 2569</p></td></tr></table></body></html>`;
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
  return String(row[5]) === '2026-11-21' &&
    ['', 'PENDING', 'LATE', 'MISSING_EMAIL', 'INVALID_EMAIL'].indexOf(String(row[10] || '')) !== -1;
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

/** Owner setup only. Creates a queue worker; sends no email during setup. */
function setupConfirmationEmails() {
  MailApp.getRemainingDailyQuota();
  setupSheet();
  if (!ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'sendPendingConfirmations'; })) {
    ScriptApp.newTrigger('sendPendingConfirmations').timeBased().everyMinutes(5).create();
  }
  console.log('Confirmation emails enabled; pending-only queue checked every 5 minutes. No email sent during setup.');
}

/** Claim durably, send without holding the sheet lock, then mark the result. */
function rsvpSendConfirmation_(sheet, rowNumber, row) {
  var lock = LockService.getScriptLock();
  var person, registrationId = row[1];
  if (!lock.tryLock(1000)) return 'PENDING';
  try {
    rowNumber = rsvpReminderRow_(sheet, registrationId);
    if (!rowNumber) return 'ERROR';
    row = sheet.getRange(rowNumber, 1, 1, RSVP_HEADERS.length).getValues()[0];
    if (row[14] !== 'PENDING') return String(row[14] || 'UNKNOWN');
    if (MailApp.getRemainingDailyQuota() < 1) return 'PENDING';
    sheet.getRange(rowNumber, 15, 1, 4).setValues([['SENDING', '', new Date().toISOString(), '']]);
    SpreadsheetApp.flush();
    person = { title: row[2], fullName: row[3], affiliation: row[4], email: String(row[9]).trim().toLowerCase() };
  } catch(error) { return 'ERROR'; }
  finally { lock.releaseLock(); }
  var result = 'SENT';
  try {
    var mail = rsvpConfirmationMessage_(person);
    mail.to = person.email; // One recipient per message; never expose the participant list.
    MailApp.sendEmail(mail);
  } catch (error) { result = 'ERROR'; }
  // SENDING/ERROR are never retried automatically after ambiguous provider errors.
  if (lock.tryLock(1000)) try {
    rowNumber = rsvpReminderRow_(sheet, registrationId);
    if (rowNumber) sheet.getRange(rowNumber, 15, 1, 4).setValues([[result, result === 'SENT' ? new Date().toISOString() : '', new Date().toISOString(), result === 'ERROR' ? 'กรุณาตรวจสอบประวัติการส่งก่อนส่งซ้ำ' : '']]);
    SpreadsheetApp.flush();
  } catch(ignored) {} finally { lock.releaseLock(); }
  return result;
}

function sendPendingConfirmations() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { status: 'BUSY', sent: 0 };
  var sent = 0, started = Date.now();
  try {
    var sheet = rsvpSheet_(props.getProperty('SPREADSHEET_ID'), props.getProperty('SHEET_NAME') || 'Registrations');
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, RSVP_HEADERS.length).getValues() : [];
  } finally { lock.releaseLock(); }
    for (var i = 0; i < rows.length; i++) {
      if (sent >= 20 || Date.now() - started > 15000 || MailApp.getRemainingDailyQuota() < 1) break;
      if (rows[i][14] !== 'PENDING' || !rsvpValidEmail_(String(rows[i][9] || ''))) continue;
      if (rsvpSendConfirmation_(sheet, i + 2, rows[i]) === 'SENT') sent++;
    }
  // The existing 5-minute worker is also a fallback for the dated reminder.
  // Each reminder is claimed separately, so concurrent triggers cannot resend it.
  if (props.getProperty('REMINDER_ENABLED') === 'true' && Date.now() >= new Date(RSVP_REMINDER_AT).getTime() && Date.now() < new Date(RSVP_REMINDER_END).getTime()) sendScheduledReminders();
  return { status: 'COMPLETE', sent: sent };
}

function previewConfirmationEmail() {
  var mail = rsvpConfirmationMessage_({ title: 'นางสาว', fullName: 'ตัวอย่าง ผู้เข้าร่วม', email: 'participant@example.com', affiliation: 'คณะวิทยาศาสตร์' });
  console.log(mail.body); return mail;
}

function rsvpConfirmationMessage_(person) {
  var name = (person.title + ' ' + person.fullName).trim();
  var maps = 'https://maps.app.goo.gl/oaKL7rKsn9W3KA5U8';
  var subject = 'ลงทะเบียนสำเร็จ | โครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์ โครงการ วมว.';
  var body = 'เรียน ' + name + '\n\nลงทะเบียนสำเร็จแล้ว\n' +
    'ผู้เข้าร่วม: ' + name + '\nอีเมล: ' + person.email + '\nสังกัด/คณะ: ' + person.affiliation + '\n\n' +
    'ยืนยันการเข้าร่วมโครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์ โครงการ วมว.\n' +
    'วันเสาร์ที่ 21 พฤศจิกายน 2569 เวลา 09.00–16.00 น.\n' +
    'ณ ห้อง SC1-411 อาคารบริหาร คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร\nแผนที่: ' + maps + '\n\n' +
    'สอบถามข้อมูลเพิ่มเติม 094-9426428 ธนาภรณ์ รอดฉ่ำ\n\nขอแสดงความนับถือ\nธนาภรณ์ รอดฉ่ำ';
  var html = `<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ลงทะเบียนสำเร็จ | SCiUS NU</title></head>
<body style="margin:0;background:#f5f6f8;color:#233149;font-family:Prompt,Tahoma,Arial,sans-serif;line-height:1.8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e7eaf0;border-radius:16px;overflow:hidden">
<tr><td style="padding:25px 30px;background:#172235"><img src="https://sciusnu-training-rsvp.vercel.app/images/logo-banner-scius.png" width="330" alt="โครงการ วมว. ศูนย์มหาวิทยาลัยนเรศวร" style="display:block;width:330px;max-width:100%;height:auto"></td></tr>
<tr><td style="padding:30px"><p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;color:#e37531">REGISTRATION CONFIRMED</p><h1 style="font-size:29px;line-height:1.5;margin:0 0 22px;color:#172235">ลงทะเบียนสำเร็จแล้ว</h1>
<p style="margin:0 0 22px;font-size:16px">เรียน ${rsvpEscape_(name)}<br>ระบบได้รับข้อมูลและยืนยันการเข้าร่วมโครงการของท่านเรียบร้อยแล้ว</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f2;border:1px solid #ffe5d0;border-radius:10px"><tr><td style="padding:20px;font-size:16px"><p style="margin:0 0 12px"><span style="font-size:13px;color:#91877e">ผู้เข้าร่วม</span><br><strong>${rsvpEscape_(name)}</strong></p><p style="margin:0 0 12px"><span style="font-size:13px;color:#91877e">อีเมล</span><br>${rsvpEscape_(person.email)}</p><p style="margin:0"><span style="font-size:13px;color:#91877e">สังกัด/คณะ</span><br>${rsvpEscape_(person.affiliation)}</p></td></tr></table>
<h2 style="font-size:20px;margin:27px 0 16px;line-height:1.8">โครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์<br>โครงการ วมว.</h2><p style="font-size:17px;margin:0 0 16px"><strong>วันเสาร์ที่ 21 พฤศจิกายน 2569</strong><br>เวลา 09.00–16.00 น.</p><p style="font-size:16px;margin:0 0 17px">ณ ห้อง SC1-411 อาคารบริหาร<br>คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร</p>
<a href="${maps}" style="display:inline-block;background:#fc7627;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:15px">ดูแผนที่สถานที่จัดโครงการ ↗</a>
<p style="font-size:15px;color:#7b8595;margin:27px 0 20px;padding-top:20px;border-top:1px solid #e8ecf2">สอบถามข้อมูลเพิ่มเติม<br><a href="tel:0949426428" style="color:#d76e2b;text-decoration:none">094-9426428</a> ธนาภรณ์ รอดฉ่ำ</p><p style="font-size:16px;margin:0">ขอแสดงความนับถือ<br><strong>ธนาภรณ์ รอดฉ่ำ</strong></p></td></tr></table>
<p style="font-size:12px;color:#98a0ad;margin:17px 0">SCiUS NU Training RSVP · 2569</p></td></tr></table></body></html>`;
  return { subject: subject, body: body, htmlBody: html, name: 'SCiUS NU Training RSVP' };
}
