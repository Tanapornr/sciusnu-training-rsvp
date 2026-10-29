import { TITLES, AFFILIATIONS, validateRegistration } from './validation.js';
const form = document.querySelector('#registration-form');
const fields = document.querySelector('#form-fields');
const message = document.querySelector('#form-message');
const submitButton = document.querySelector('#submit-button');
const submitLabel = document.querySelector('#submit-label');
const spinner = document.querySelector('.spinner');
const arrow = document.querySelector('.submit-arrow');
const success = document.querySelector('#success-panel');
let submitting = false;
let requestId;
let fingerprint;

for (const [id, values] of [['title', TITLES], ['affiliation', AFFILIATIONS]]) {
  for (const value of values) document.getElementById(id).add(new Option(value, value));
}
submitButton.disabled = false;
function showErrors(errors = {}) {
  for (const key of ['title', 'fullName', 'email', 'affiliation']) {
    document.getElementById(`${key}-error`).textContent = errors[key] || '';
    document.getElementById(key).setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
  }
}
function showMessage(text) { message.textContent = text; message.hidden = false; message.focus(); }
form.addEventListener('input', event => {
  const key = event.target.name;
  if (['title', 'fullName', 'email', 'affiliation'].includes(key)) {
    document.getElementById(`${key}-error`).textContent = '';
    event.target.setAttribute('aria-invalid', 'false');
    message.hidden = true;
  }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const input = Object.fromEntries(new FormData(form));
  const checked = validateRegistration(input);
  showErrors(checked.errors);
  message.hidden = true;
  if (!checked.valid) { document.getElementById(Object.keys(checked.errors)[0]).focus(); return; }
  const nextFingerprint = JSON.stringify(checked.data);
  if (fingerprint !== nextFingerprint || !requestId) {
    // Keep this ID for retries of the same normalized data, including after a timeout.
    requestId = crypto.randomUUID();
    fingerprint = nextFingerprint;
  }
  submitting = true;
  fields.disabled = true;
  form.setAttribute('aria-busy', 'true');
  submitLabel.textContent = 'กำลังบันทึกข้อมูล…';
  spinner.hidden = false;
  arrow.hidden = true;
  try {
    const response = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...checked.data, requestId, website: input.website || '' }),
      signal: AbortSignal.timeout(27000),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      if (result.errors) showErrors(result.errors);
      const messages = {
        DUPLICATE: 'ชื่อของท่านได้ลงทะเบียนแล้ว',
        REQUEST_CONFLICT: 'ข้อมูลที่ส่งซ้ำไม่ตรงกับรายการเดิม กรุณาโหลดหน้าเว็บใหม่แล้วลองอีกครั้ง',
        VALIDATION_ERROR: 'กรุณาตรวจสอบข้อมูลให้ครบถ้วน',
        RATE_LIMITED: 'มีการส่งข้อมูลจำนวนมาก กรุณารอประมาณ 10 นาทีแล้วลองอีกครั้ง',
        BUSY: 'มีผู้ลงทะเบียนพร้อมกันจำนวนมาก กรุณาลองส่งอีกครั้ง',
        REGISTRATION_CLOSED: 'ขณะนี้ปิดรับลงทะเบียนแล้ว',
        NOT_CONFIGURED: 'ระบบยังไม่พร้อมรับลงทะเบียน กรุณาลองใหม่ภายหลังหรือติดต่อผู้จัดโครงการ',
        FORBIDDEN: 'ไม่สามารถส่งข้อมูลจากหน้าเว็บนี้ได้ กรุณาเปิดเว็บไซต์ลงทะเบียนโดยตรง',
      };
      showMessage(messages[result.code] || 'ยังยืนยันผลการบันทึกไม่ได้ กรุณากดส่งอีกครั้ง ระบบจะตรวจสอบและป้องกันรายการซ้ำให้');
      return;
    }
    if (result.schemaVersion !== 2 || !['CREATED', 'ALREADY_SAVED'].includes(result.code) || !/^NU69-[A-F0-9]{16}$/.test(result.registrationId || '')) throw new Error('Invalid receipt');
    document.querySelector('#receipt-name').textContent = `${checked.data.title} ${checked.data.fullName}`;
    document.querySelector('#receipt-email').textContent = checked.data.email;
    document.querySelector('#receipt-affiliation').textContent = checked.data.affiliation;
    const mailStatus = document.querySelector('#confirmation-mail-status');
    if (mailStatus) mailStatus.textContent = result.confirmationEmailStatus === 'SENT'
      ? 'ส่งอีเมลยืนยันการลงทะเบียนแล้ว กรุณาตรวจสอบกล่องจดหมายและโฟลเดอร์จดหมายขยะ'
      : ['PENDING', 'SENDING'].includes(result.confirmationEmailStatus)
        ? 'ลงทะเบียนสำเร็จแล้ว อีเมลยืนยันอยู่ระหว่างรอส่ง กรุณาตรวจสอบกล่องจดหมายภายหลัง'
        : 'ลงทะเบียนสำเร็จแล้ว หากไม่ได้รับอีเมลยืนยัน กรุณาติดต่อผู้จัดโครงการ';
    form.hidden = true;
    document.querySelector('.participation-note').hidden = true;
    success.hidden = false;
    success.focus();
  } catch {
    showMessage('ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดส่งอีกครั้ง ระบบจะตรวจสอบและป้องกันรายการซ้ำให้');
  } finally {
    submitting = false;
    fields.disabled = false;
    form.removeAttribute('aria-busy');
    submitLabel.textContent = 'ยืนยันลงทะเบียน';
    spinner.hidden = true;
    arrow.hidden = false;
  }
});
