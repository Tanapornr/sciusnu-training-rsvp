import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleRegistration } from '../api/register.js';
import { AFFILIATIONS, TITLES, normalizeName, validateRegistration } from '../public/validation.js';
import { createAppsScriptHarness, sign } from './helpers/apps-script.mjs';
import { validEmail } from '../public/validation.js';
import { EVENT } from '../public/confirmation.js';

const origin = 'http://localhost:3000';
const valid = () => ({ title: 'ดร.', fullName: 'สมชาย ใจดี', email: 'somchai@example.com', affiliation: AFFILIATIONS[1], requestId: randomUUID(), website: '' });
const gasData = () => ({ ...valid(), eventDate: '2026-11-21', schemaVersion: 2, clientKey: 'a'.repeat(64) });
const request = (body, headers = {}) => new Request(`${origin}/api/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const environment = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test-deployment/exec', APPS_SCRIPT_SECRET: 'test-only-shared-secret-0123456789abcdef', ALLOWED_ORIGINS: origin };
function integration() { const harness = createAppsScriptHarness(); return { harness, call: data => handleRegistration(request(data), { env: environment, fetchImpl: harness.fetch }) }; }

test('all 7 title and 7 affiliation choices pass; name whitespace is normalized', () => {
  for (const title of TITLES) for (const affiliation of AFFILIATIONS) assert.equal(validateRegistration({ ...valid(), title, affiliation }).valid, true);
  assert.equal(normalizeName('  สมชาย\u200B   ใจดี  '), 'สมชาย ใจดี');
});
test('validation rejects missing, unlisted, overlong, single-token and formula-like names', () => {
  for (const fullName of ['', 'สมชาย', '=SUM(A1) ใจดี', '@name Test', '<script> Test', 'x'.repeat(121) + ' Test']) assert.equal(validateRegistration({ ...valid(), fullName }).valid, false);
  assert.equal(validateRegistration({ ...valid(), title: 'คุณ' }).valid, false);
  assert.equal(validateRegistration({ ...valid(), affiliation: 'อื่น ๆ' }).valid, false);
  assert.equal(validateRegistration(null).valid, false);
});
test('actual API → signed Apps Script → sheet → confirmed response; retry writes one row', async () => {
  const { harness, call } = integration();
  const input = valid();
  const first = await call(input);
  const receipt = await first.json();
  assert.equal(first.status, 201);
  assert.equal(receipt.code, 'CREATED');
  assert.match(receipt.registrationId, /^NU69-[A-F0-9]{16}$/);
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.rows[1][3], input.fullName);
  assert.equal(harness.rows[1][5], '2026-11-21');
  assert.equal(harness.flushes, 3);
  assert.equal(harness.locked, false);
  const retry = await call(input);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ...receipt, code: 'ALREADY_SAVED' });
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.releases, 4);
});
test('same name is rejected across affiliations, titles, whitespace and case', async () => {
  const { harness, call } = integration();
  await call({ ...valid(), fullName: 'Jane Doe' });
  for (const affiliation of AFFILIATIONS) {
    const response = await call({ ...valid(), fullName: '  jane   doe ', title: 'นางสาว', affiliation });
    assert.equal(response.status, 409);
    const result = await response.json();
    assert.equal(result.code, 'DUPLICATE');
    assert.equal(result.message, 'ชื่อของท่านได้ลงทะเบียนแล้ว');
  }
  assert.equal(harness.rows.length, 2);
});

test('a previously saved row with the old affiliation-based key still blocks a duplicate name', () => {
  const h = createAppsScriptHarness();
  const input = gasData();
  assert.equal(h.post(sign(input)).code, 'CREATED');
  h.rows[1][7] = h.context.rsvpHash_('สมชายใจดี|' + input.affiliation + '|2026-11-21');
  const previousRows = structuredClone(h.rows);
  assert.equal(h.post(sign({ ...gasData(), affiliation: AFFILIATIONS[2], title: 'นาย', fullName: '  สมชาย   ใจดี ' })).code, 'DUPLICATE');
  assert.deepEqual(h.rows, previousRows);
});

test('30 different people in one affiliation can register through the same network', async () => {
  const { harness, call } = integration();
  for (let i = 0; i < 30; i++) {
    const fullName = 'Person ' + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + i % 26);
    assert.equal((await call({ ...valid(), fullName })).status, 201);
  }
  assert.equal(harness.rows.length, 31);
  assert.equal(new Set(harness.rows.slice(1).map(row => row[4])).size, 1);
});

test('idempotency key reuse with changed data is a conflict', async () => {
  const { harness, call } = integration();
  const input = valid();
  await call(input);
  const result = await call({ ...input, fullName: 'สมหญิง ใจดี' });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, 'REQUEST_CONFLICT');
  assert.equal(harness.rows.length, 2);
});
test('forbidden origin, missing origin, honeypot and invalid JSON never call backend', async () => {
  let called = false;
  const options = { env: environment, fetchImpl: () => { called = true; throw new Error('Unexpected fetch'); } };
  assert.equal((await handleRegistration(request(valid(), { origin: 'https://attacker.example' }), options)).status, 403);
  assert.equal((await handleRegistration(request(valid(), { origin: '' }), options)).status, 403);
  assert.equal((await handleRegistration(request({ ...valid(), website: 'spam' }), options)).status, 400);
  assert.equal((await handleRegistration(request('not-json'), options)).status, 400);
  assert.equal((await handleRegistration(request('null'), options)).status, 400);
  assert.equal(called, false);
});
test('request limits, method and media type are enforced', async () => {
  assert.equal((await handleRegistration(request(' '.repeat(9000)), { env: environment })).status, 413);
  assert.equal((await handleRegistration(request(valid(), { 'content-type': 'text/plain' }), { env: environment })).status, 415);
  assert.equal((await handleRegistration(new Request(origin), { env: environment })).status, 405);
});
test('missing server configuration fails closed', async () => {
  const response = await handleRegistration(request(valid()), { env: { ALLOWED_ORIGINS: origin } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'NOT_CONFIGURED');
});
test('upstream HTML, false success, failure and timeout never produce a success receipt', async () => {
  for (const fetchImpl of [
    async () => new Response('<html>login required</html>'),
    async () => Response.json({ ok: true, code: 'CREATED', registrationId: 'garbage' }),
    async () => new Response('', { status: 500 }),
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
  ]) {
    const response = await handleRegistration(request(valid()), { env: environment, fetchImpl });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).ok, false);
  }
});
test('Apps Script rejects invalid signature, expired envelope and invalid data before writing', () => {
  const h = createAppsScriptHarness();
  assert.equal(h.post({ ...sign(gasData()), signature: '0'.repeat(64) }).code, 'UNAUTHORIZED');
  assert.equal(h.post(sign(gasData(), h.properties.SHARED_SECRET, String(Date.now() - 600000))).code, 'UNAUTHORIZED');
  assert.equal(h.post(sign({ ...gasData(), fullName: '=IMPORTXML Test' })).code, 'VALIDATION_ERROR');
  assert.equal(h.post(sign(null)).code, 'VALIDATION_ERROR');
  assert.equal(h.rows.length, 0);
});
test('lock contention returns BUSY without writes; schema mismatch preserves existing data', () => {
  const h = createAppsScriptHarness();
  h.setBusy(true);
  assert.equal(h.post(sign(gasData())).code, 'BUSY');
  assert.equal(h.rows.length, 0);
  h.setBusy(false);
  h.rows.push(['existing unrelated sheet']);
  assert.equal(h.post(sign(gasData())).code, 'INTERNAL_ERROR');
  assert.deepEqual(h.rows, [['existing unrelated sheet']]);
  assert.equal(h.locked, false);
});
test('setup is repeatable and preserves registrations; registration switch blocks new rows', () => {
  const h = createAppsScriptHarness();
  h.setup();
  const data = gasData();
  assert.equal(h.post(sign(data)).code, 'CREATED');
  h.setup();
  assert.equal(h.rows.length, 2);
  h.properties.REGISTRATION_OPEN = 'false';
  assert.equal(h.post(sign({ ...gasData(), fullName: 'สมหญิง รักเรียน' })).code, 'REGISTRATION_CLOSED');
  assert.equal(h.post(sign(data)).code, 'ALREADY_SAVED');
  assert.equal(h.rows.length, 2);
});
test('shared best-effort rate limit rejects the 121st unique registration, while retry stays idempotent', () => {
  const h = createAppsScriptHarness();
  const first = gasData();
  assert.equal(h.post(sign(first)).code, 'CREATED');
  for (let i = 1; i < 120; i++) assert.equal(h.post(sign({ ...gasData(), fullName: `Person ${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}` })).code, 'CREATED');
  assert.equal(h.post(sign({ ...gasData(), fullName: 'Last Person' })).code, 'RATE_LIMITED');
  assert.equal(h.post(sign(first)).code, 'ALREADY_SAVED');
  assert.equal(h.rows.length, 121);
});
test('formula escaping and public health endpoint do not expose participant data', () => {
  const h = createAppsScriptHarness();
  assert.equal(h.context.rsvpCell_('=1+1'), "'=1+1");
  assert.equal(h.context.rsvpCell_('@formula'), "'@formula");
  assert.equal(h.context.rsvpCell_('ชื่อ นามสกุล'), 'ชื่อ นามสกุล');
  assert.deepEqual(Object.keys(h.context.doGet()).sort(), ['confirmationEmail', 'ok', 'service', 'version']);
});

test('email is required and validated consistently in browser, API and Apps Script', async () => {
  for (const email of ['', 'a@', 'a@example', 'x@example.com,other@example.com', 'x@example.com\r\nBcc:test@example.com', 'a..b@example.com', '.name@example.com', 'x@-example.com', 'a'.repeat(65) + '@example.com']) {
    assert.equal(validEmail(email), false, email);
    assert.equal(validateRegistration({ ...valid(), email }).valid, false);
    const h = createAppsScriptHarness();
    assert.equal(h.post(sign({ ...gasData(), email })).code, 'VALIDATION_ERROR');
    assert.equal(h.rows.length, 0);
  }
  assert.equal(validateRegistration({ ...valid(), email: ' Name+tag@Example.COM ' }).data.email, 'name+tag@example.com');
  const { harness, call } = integration();
  const response = await call({ ...valid(), email: ' Name+tag@Example.COM ' });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).schemaVersion, 2);
  assert.equal(harness.rows[1][9], 'name+tag@example.com');
  assert.equal(harness.outbox.length, 1, 'Registration sends one confirmation');
  assert.ok(harness.outbox[0].subject.startsWith('ลงทะเบียนสำเร็จ'));
  assert.equal(harness.rows[1][10], 'PENDING', 'The dated reminder remains separate');
});

test('legacy nine-column rows survive additive email migration unchanged', () => {
  const h = createAppsScriptHarness();
  h.setup();
  h.rows[0].length = 9;
  const legacy = ['2026-10-28 12:00:00','NU69-1234567890ABCDEF','ดร.','ผู้เข้าร่วม เดิม','คณะวิทยาศาสตร์','2026-11-21','legacy-request','old-key','old-hash'];
  h.rows.push([...legacy]);
  h.setup();
  assert.equal(h.rows[0].length, 18);
  assert.deepEqual(h.rows[1], legacy);
  h.setup();
  assert.deepEqual(h.rows[1], legacy);
  const changed = structuredClone(h.rows);
  h.rows[0][9] = 'Unrelated data';
  assert.throws(() => h.setup());
  assert.deepEqual(h.rows[1], changed[1]);
});

test('setting up reminders creates exactly two dated triggers and sends no mail', () => {
  const h = createAppsScriptHarness();
  h.outbox.length = 0;
  h.context.setupEmailReminder();
  assert.equal(h.outbox.length, 0);
  assert.equal(h.properties.REMINDER_ENABLED, 'true');
  assert.equal(h.triggers.length, 2);
  assert.equal(h.triggers[0].time, Date.parse('2026-11-20T02:30:00Z'));
  assert.equal(h.triggers[1].time, Date.parse('2026-11-20T02:40:00Z'));
  h.outbox.length = 0;
  h.context.setupEmailReminder();
  assert.equal(h.triggers.length, 2);
  h.setNow('2026-11-20T10:00:00+07:00');
  assert.throws(() => h.context.setupEmailReminder());
});

test('reminders never send early, use separate recipients, and do not resend completed rows', () => {
  const h = createAppsScriptHarness();
  h.post(sign(gasData()));
  h.post(sign({ ...gasData(), fullName: 'สมหญิง รักเรียน', email: 'second@example.com' }));
  h.outbox.length = 0;
  h.context.setupEmailReminder();
  assert.equal(h.context.sendScheduledReminders().status, 'NOT_DUE');
  assert.equal(h.outbox.length, 0);
  h.setNow('2026-11-20T09:30:00+07:00');
  const result = h.context.sendScheduledReminders();
  assert.equal(result.sent, 2);
  assert.equal(h.outbox.length, 2);
  assert.equal(h.outbox[0].to, 'somchai@example.com');
  assert.equal(h.outbox[1].to, 'second@example.com');
  for (const mail of h.outbox) {
    assert.equal(mail.cc, undefined); assert.equal(mail.bcc, undefined);
    assert.ok(mail.body.includes('SC1-411'));
    assert.ok(mail.body.includes('094-9426428'));
    assert.ok(mail.body.includes('21 พฤศจิกายน 2569'));
  }
  assert.equal(h.rows[1][10], 'SENT');
  assert.equal(h.rows[1][11], '2026-11-20 09:30:00');
  h.context.sendScheduledReminders();
  assert.equal(h.outbox.length, 2);
});

test('missing emails, late registrations, exhausted quota and ambiguous send failures are safe', () => {
  const h = createAppsScriptHarness();
  h.post(sign(gasData()));
  h.outbox.length = 0;
  h.context.setupEmailReminder();
  h.setNow('2026-11-20T09:30:00+07:00');
  h.setQuota(0);
  assert.equal(h.context.sendScheduledReminders().status, 'QUOTA_EXHAUSTED');
  assert.equal(h.rows[1][10], 'PENDING');
  assert.equal(h.outbox.length, 0);
  h.setQuota(1500);
  h.setMailFailure(true);
  h.context.sendScheduledReminders();
  assert.equal(h.rows[1][10], 'ERROR');
  assert.equal(h.outbox.length, 1);
  h.context.sendScheduledReminders();
  assert.equal(h.outbox.length, 1, 'Ambiguous delivery is never retried automatically');
  h.post(sign({ ...gasData(), fullName: 'ลงทะเบียน ภายหลัง', email: 'late@example.com' }, undefined, String(h.context.Date.now())));
  assert.equal(h.rows[2][10], 'LATE');
  h.rows[1][9] = ''; h.rows[1][10] = '';
  h.context.sendScheduledReminders();
  assert.equal(h.rows[1][10], 'MISSING_EMAIL');
  h.setNow('2026-11-21T00:01:00+07:00');
  assert.equal(h.context.sendScheduledReminders().status, 'EXPIRED');
});

test('a partially sent batch is resumed without duplicate delivery', () => {
  const h = createAppsScriptHarness();
  for (let i = 0; i < 55; i++) h.post(sign({ ...gasData(), fullName: 'Person ' + String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + i % 26) }));
  h.outbox.length = 0;
  h.context.setupEmailReminder();
  h.setNow('2026-11-20T09:30:00+07:00');
  assert.equal(h.context.sendScheduledReminders().sent, 50);
  assert.equal(h.triggers.filter(t => t.handler === 'rsvpReminderRetry').length, 1);
  assert.equal(h.context.rsvpReminderRetry().sent, 5);
  assert.equal(h.outbox.length, 55);
  assert.equal(h.context.sendScheduledReminders().sent, 0);
});

test('email preview is escaped and sends nothing; venue and receipt UI are consistent', () => {
  const h = createAppsScriptHarness();
  h.context.previewReminderEmail();
  assert.equal(h.outbox.length, 0);
  const mail = h.context.rsvpReminderMessage_({ title: 'นาย', fullName: '<img src=x>', affiliation: 'A & B' });
  assert.ok(mail.htmlBody.includes('&lt;img src=x&gt;'));
  assert.ok(mail.htmlBody.includes('A &amp; B'));
  assert.ok(mail.body.includes(EVENT.venue));
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="fullName"') < html.indexOf('id="email"'));
  assert.ok(html.indexOf('id="email"') < html.indexOf('id="affiliation"'));
  assert.ok(html.includes('id="receipt-email"'));
  assert.equal(html.includes('id="save-confirmation"'), false);
  assert.ok(html.includes('id="confirmation-mail-status"'));
  assert.equal(html.includes('data-calendar-link'), false);
  assert.equal(html.includes('เพิ่มกิจกรรมในปฏิทิน'), false);
});
