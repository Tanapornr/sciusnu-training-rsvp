/** SCiUS NU Training RSVP — paste into a spreadsheet-bound Apps Script project. */
var RSVP_TITLES = ['ศ.ดร.', 'รศ.ดร.', 'ผศ.ดร.', 'ดร.', 'นาย', 'นาง', 'นางสาว'];
var RSVP_AFFILIATIONS = [
  'โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร', 'คณะวิทยาศาสตร์', 'คณะวิทยาศาสตร์การแพทย์',
  'คณะเภสัชศาสตร์', 'คณะโลจิสติกส์และดิจิทัลซัพพลายเชน', 'คณะสหเวชศาสตร์',
  'คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติ และสิ่งแวดล้อม'
];
var RSVP_HEADERS = ['ลงทะเบียนเมื่อ (Asia/Bangkok)', 'รหัสลงทะเบียน', 'คำนำหน้า', 'ชื่อ-นามสกุล', 'สังกัด/คณะ', 'วันที่จัดโครงการ', 'Request ID', 'Participant key', 'Payload hash'];

function doGet() { return rsvpJson_({ ok: true, service: 'sciusnu-training-rsvp', version: '1.1.0' }); }
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
    if (RSVP_TITLES.indexOf(data.title) === -1 || RSVP_AFFILIATIONS.indexOf(data.affiliation) === -1 || name.length < 4 || name.length > 120 ||
        !/^[\p{L}\p{M}][\p{L}\p{M} .’'()\-]*$/u.test(name) || name.split(' ').length < 2 || data.eventDate !== '2026-11-21' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId || '') ||
        !/^[a-f0-9]{64}$/.test(data.clientKey || '')) return rsvpJson_({ ok: false, code: 'VALIDATION_ERROR' });
    // One registration per name for this event, regardless of title or affiliation.
    var nameKey = rsvpNameKey_(name);
    var participantKey = rsvpHash_(nameKey + '|2026-11-21');
    var payloadHash = rsvpHash_(data.title + '|' + name + '|' + data.affiliation + '|2026-11-21');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(7000)) return rsvpJson_({ ok: false, code: 'BUSY' });
    try {
      var sheet = rsvpSheet_(sheetId, props.getProperty('SHEET_NAME') || 'Registrations');
      var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues() : [];
      // A retry after a network timeout returns the saved receipt without adding a row.
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][6] === data.requestId) return rsvpJson_(rows[i][8] === payloadHash ?
          { ok: true, code: 'ALREADY_SAVED', registrationId: rows[i][1] } : { ok: false, code: 'REQUEST_CONFLICT' });
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
        data.title, name, data.affiliation, '2026-11-21', data.requestId, participantKey, payloadHash];
      // Text formatting and escaping defend against spreadsheet formula injection.
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 9).setNumberFormat('@').setValues([row.map(rsvpCell_)]);
      SpreadsheetApp.flush();
      return rsvpJson_({ ok: true, code: 'CREATED', registrationId: registrationId });
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
    sheet.getRange(1, 1, 1, 9).setBackground('#102d36').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setColumnWidth(4, 240);
    sheet.setColumnWidth(5, 420);
  } else {
    var headers = sheet.getRange(1, 1, 1, 9).getValues()[0];
    if (headers.join('|') !== RSVP_HEADERS.join('|')) throw new Error('Unexpected sheet headers. Use a new empty sheet name.');
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
