import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// This runs the actual Code.gs with in-memory Google service adapters, not a reimplementation.
export function createAppsScriptHarness() {
  const rows = [];
  const outbox = [];
  const triggers = [];
  let nowMs = Date.now();
  let quota = 1500;
  let failMail = false;
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [nowMs])); } static now() { return nowMs; } }
  const props = { getProperty: key => properties[key] ?? null, setProperty: (key, value) => { properties[key] = String(value); }, setProperties: values => Object.assign(properties, values) };
  const properties = { SHARED_SECRET: 'test-only-shared-secret-0123456789abcdef', SPREADSHEET_ID: 'test-sheet' };
  const cache = new Map();
  let locked = false;
  let busy = false;
  let flushes = 0;
  let releases = 0;
  const range = (row, col, rowCount, colCount) => {
    const object = {
      getValues() { return Array.from({ length: rowCount }, (_, r) => Array.from({ length: colCount }, (_, c) => rows[row - 1 + r]?.[col - 1 + c] ?? '')); },
      setValues(values) {
        assert.ok(locked, 'Sheet writes must hold the script lock');
        for (let r = 0; r < rowCount; r++) {
          rows[row - 1 + r] ||= [];
          for (let c = 0; c < colCount; c++) rows[row - 1 + r][col - 1 + c] = values[r][c];
        }
        return object;
      },
      setNumberFormat() { return object; }, setBackground() { return object; },
      setFontColor() { return object; }, setFontWeight() { return object; },
    };
    return object;
  };
  const sheet = { getLastRow: () => rows.length, getRange: range, setFrozenRows() {}, setColumnWidth() {} };
  const context = vm.createContext({
    console: { error() {}, log() {} },
    Date: ClockDate,
    PropertiesService: { getScriptProperties: () => props },
    Utilities: {
      Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (value, secret) => [...createHmac('sha256', secret).update(value).digest()],
      computeDigest: (_, value) => [...createHash('sha256').update(value).digest()],
      getUuid: randomUUID,
      formatDate: date => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0,19).replace('T', ' '),
    },
    LockService: { getScriptLock: () => ({
      tryLock() { if (busy || locked) return false; locked = true; return true; },
      waitLock() { if (busy || locked) throw new Error('Lock busy'); locked = true; },
      releaseLock() { assert.ok(locked); locked = false; releases++; },
    }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value) }) },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }),
      flush() { assert.ok(locked); flushes++; },
    },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail(mail) { assert.equal(locked, false, 'Do not hold the sheet lock while sending email'); if (quota <= 0) throw new Error('Quota exceeded'); outbox.push(structuredClone(mail)); quota--; if (failMail) throw new Error('Simulated ambiguous provider failure'); },
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: trigger => { const i = triggers.indexOf(trigger); if (i >= 0) triggers.splice(i,1); },
      newTrigger(handler) { let time; const builder = { timeBased: () => builder, at: value => { time = value.getTime(); return builder; }, after: value => { time = nowMs + value; return builder; }, everyMinutes: value => { time = value * 60000; return builder; }, create: () => { const trigger = { handler, time, getHandlerFunction: () => handler }; triggers.push(trigger); return trigger; } }; return builder; },
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  });
  vm.runInContext(readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8'), context);
  return {
    rows, properties, cache, context, outbox, triggers,
    setNow(value) { nowMs = typeof value === 'number' ? value : Date.parse(value); },
    setQuota(value) { quota = value; },
    setMailFailure(value) { failMail = value; },
    get locked() { return locked; }, get flushes() { return flushes; }, get releases() { return releases; },
    setBusy(value) { busy = value; },
    setup() { context.setupSheet(); },
    post(envelope) { return context.doPost({ postData: { contents: JSON.stringify(envelope) } }); },
    fetch: async (_url, options) => Response.json(context.doPost({ postData: { contents: options.body } })),
  };
}
export function sign(data, secret = 'test-only-shared-secret-0123456789abcdef', timestamp = String(Date.now())) {
  const payload = JSON.stringify(data);
  return { timestamp, payload, signature: createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex') };
}
