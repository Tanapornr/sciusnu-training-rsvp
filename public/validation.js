export const TITLES = Object.freeze(['ศ.ดร.', 'รศ.ดร.', 'ผศ.ดร.', 'ดร.', 'นาย', 'นาง', 'นางสาว']);
export const AFFILIATIONS = Object.freeze([
  'โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร',
  'คณะวิทยาศาสตร์',
  'คณะวิทยาศาสตร์การแพทย์',
  'คณะเภสัชศาสตร์',
  'คณะโลจิสติกส์และดิจิทัลซัพพลายเชน',
  'คณะสหเวชศาสตร์',
  'คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติ และสิ่งแวดล้อม',
]);
export function normalizeName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim() : '';
}
export function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
export function validEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\s,;<>\r\n]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parts[0]) && parts[1].includes('.') && parts[1].split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
export function validateRegistration(input) {
  const errors = {};
  const data = {
    title: typeof input?.title === 'string' ? input.title.trim() : '',
    fullName: normalizeName(input?.fullName),
    email: normalizeEmail(input?.email),
    affiliation: typeof input?.affiliation === 'string' ? input.affiliation.trim() : '',
  };
  if (!TITLES.includes(data.title)) errors.title = 'กรุณาเลือกคำนำหน้า';
  if (data.fullName.length < 4 || data.fullName.length > 120 ||
      !/^[\p{L}\p{M}][\p{L}\p{M} .’'()\-]*$/u.test(data.fullName) || data.fullName.split(' ').length < 2) {
    errors.fullName = 'กรุณากรอกชื่อและนามสกุล เว้นวรรคระหว่างชื่อกับนามสกุล (4–120 ตัวอักษร)';
  }
  if (!validEmail(data.email)) errors.email = 'กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com';
  if (!AFFILIATIONS.includes(data.affiliation)) errors.affiliation = 'กรุณาเลือกสังกัด/คณะจากรายการ';
  return { valid: Object.keys(errors).length === 0, errors, data };
}
