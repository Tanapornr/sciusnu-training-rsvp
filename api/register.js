import { createHmac } from 'node:crypto';
import { validateRegistration } from '../public/validation.js';

const MAX_BYTES = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^NU69-[A-F0-9]{16}$/;
const CODES = {
  DUPLICATE: [409, 'ชื่อของท่านได้ลงทะเบียนแล้ว'],
  REQUEST_CONFLICT: [409, 'ข้อมูลที่ส่งซ้ำไม่ตรงกับรายการเดิม กรุณาโหลดหน้าเว็บใหม่แล้วลองอีกครั้ง'],
  VALIDATION_ERROR: [400, 'กรุณาตรวจสอบข้อมูลให้ครบถ้วน'],
  RATE_LIMITED: [429, 'มีการส่งข้อมูลจำนวนมาก กรุณารอประมาณ 10 นาทีแล้วลองอีกครั้ง'],
  BUSY: [503, 'มีผู้ลงทะเบียนพร้อมกันจำนวนมาก กรุณาลองส่งอีกครั้ง'],
  REGISTRATION_CLOSED: [403, 'ขณะนี้ปิดรับลงทะเบียนแล้ว'],
};
function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}
async function readJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Error('TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('BAD_JSON');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Dependency injection is used only by tests. Production calls use process.env and fetch.
export async function handleRegistration(request, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  if (request.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'รองรับการส่งแบบ POST เท่านั้น' }, 405, { Allow: 'POST' });
  const allowed = (env.ALLOWED_ORIGINS || (env.VERCEL ? '' : 'http://localhost:3000,http://127.0.0.1:3000')).split(',').map(x => x.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  if (!origin || !allowed.includes(origin)) return json({ ok: false, code: 'FORBIDDEN', message: 'ไม่สามารถส่งข้อมูลจากหน้าเว็บนี้ได้ กรุณาเปิดเว็บไซต์ลงทะเบียนโดยตรง' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'รูปแบบข้อมูลไม่ถูกต้อง' }, 415);
  let input;
  try { input = await readJson(request); }
  catch (e) { return json({ ok: false, code: e.message === 'TOO_LARGE' ? 'TOO_LARGE' : 'BAD_JSON', message: 'ข้อมูลไม่ถูกต้องหรือมีขนาดใหญ่เกินไป' }, e.message === 'TOO_LARGE' ? 413 : 400); }
  const checked = validateRegistration(input);
  if (!checked.valid || !UUID.test(input?.requestId || '') || typeof input?.website !== 'string' || input.website !== '') {
    return json({ ok: false, code: 'VALIDATION_ERROR', message: 'กรุณาตรวจสอบข้อมูลให้ครบถ้วน', errors: checked.errors }, 400);
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.APPS_SCRIPT_URL || '') || (env.APPS_SCRIPT_SECRET || '').length < 32) {
    console.error('Registration configuration missing or invalid');
    return json({ ok: false, code: 'NOT_CONFIGURED', message: 'ระบบยังไม่พร้อมรับลงทะเบียน กรุณาลองใหม่ภายหลังหรือติดต่อผู้จัดโครงการ' }, 503);
  }
  // Vercel overwrites x-vercel-forwarded-for; never trust browser-supplied x-forwarded-for.
  const ip = env.VERCEL ? (request.headers.get('x-vercel-forwarded-for') || 'unknown') : 'local-development';
  const clientKey = createHmac('sha256', env.APPS_SCRIPT_SECRET).update(ip.split(',')[0].trim()).digest('hex');
  const payload = JSON.stringify({ ...checked.data, requestId: input.requestId, clientKey, eventDate: '2026-11-21', schemaVersion: 2 });
  const timestamp = String(now());
  const signature = createHmac('sha256', env.APPS_SCRIPT_SECRET).update(`${timestamp}.${payload}`).digest('hex');
  try {
    const upstream = await fetchImpl(env.APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp, payload, signature }),
      redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(22000),
    });
    if (!upstream.ok) throw new Error('UPSTREAM_HTTP');
    const result = await upstream.json();
    if (result?.ok === true && result.schemaVersion === 2 && ['CREATED', 'ALREADY_SAVED'].includes(result.code) && ID.test(result.registrationId || '')) {
      return json({ ok: true, code: result.code, registrationId: result.registrationId, schemaVersion: 2 }, result.code === 'CREATED' ? 201 : 200);
    }
    if (result?.ok === false && CODES[result.code]) {
      const [status, message] = CODES[result.code];
      return json({ ok: false, code: result.code, message }, status, status === 429 ? { 'Retry-After': '600' } : {});
    }
    throw new Error('UPSTREAM_RESPONSE');
  } catch (e) {
    // Do not log the request, name, URL, signature, or secrets.
    console.error('Registration upstream failure', ['TimeoutError', 'AbortError'].includes(e.name) ? 'TIMEOUT' : 'UNAVAILABLE');
    return json({ ok: false, code: 'UPSTREAM_UNAVAILABLE', message: 'ยังยืนยันผลการบันทึกไม่ได้ กรุณากดส่งอีกครั้ง ระบบจะตรวจสอบและป้องกันรายการซ้ำให้' }, 502);
  }
}
export async function POST(request) { return handleRegistration(request); }
