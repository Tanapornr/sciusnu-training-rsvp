import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleRegistration } from '../api/register.js';
import { AFFILIATIONS, TITLES, normalizeName, validateRegistration } from '../public/validation.js';
import { createAppsScriptHarness, sign } from './helpers/apps-script.mjs';
import { calendarHref, OUTLOOK_CALENDAR } from '../public/calendar.js';

const origin = 'http://localhost:3000';
const valid = () => ({ title: 'ดร.', fullName: 'สมชาย ใจดี', affiliation: AFFILIATIONS[1], requestId: randomUUID(), website: '' });
const gasData = () => ({ ...valid(), eventDate: '2026-11-21', clientKey: 'a'.repeat(64) });
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
  assert.equal(harness.flushes, 1);
  assert.equal(harness.locked, false);
  const retry = await call(input);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ...receipt, code: 'ALREADY_SAVED' });
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.releases, 2);
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
  assert.deepEqual(Object.keys(h.context.doGet()).sort(), ['ok', 'service', 'version']);
});
test('calendar uses Thai event time, CRLF and safe 75-byte folding', () => {
  const calendar = readFileSync(new URL('../public/event.ics', import.meta.url), 'utf8');
  assert.ok(calendar.includes('DTSTART:20261121T020000Z\r\n'));
  assert.ok(calendar.includes('DTEND:20261121T090000Z\r\n'));
  assert.equal(calendar.replace(/\r\n/g, '').includes('\n'), false);
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.ok(calendar.replace(/\r\n /g, '').includes('เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา'));
});

test('desktop calendars open the requested Outlook URL; mobile links preserve the event', () => {
  assert.equal(calendarHref({ userAgent: 'Mozilla Windows NT 10.0', platform: 'Win32' }), OUTLOOK_CALENDAR);
  assert.equal(calendarHref({ userAgent: 'Macintosh', platform: 'MacIntel' }), OUTLOOK_CALENDAR);
  assert.equal(calendarHref({ userAgent: 'iPhone' }), '/event.ics');
  assert.equal(calendarHref({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }), '/event.ics');
  const android = calendarHref({ userAgent: 'Mozilla Android 15' });
  assert.ok(android.startsWith('intent://calendar.google.com/calendar/render?'));
  assert.ok(android.includes('package=com.google.android.calendar;'));
  const encoded = android.split('S.browser_fallback_url=')[1].split(';end')[0];
  const fallback = new URL(decodeURIComponent(encoded));
  assert.equal(fallback.origin, 'https://calendar.google.com');
  assert.equal(fallback.searchParams.get('dates'), '20261121T020000Z/20261121T090000Z');
  assert.equal(fallback.searchParams.get('ctz'), 'Asia/Bangkok');
  assert.ok(fallback.searchParams.get('details').includes('ปฐมพยาบาลทางใจ'));
});
