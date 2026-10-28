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
export function validateRegistration(input) {
  const errors = {};
  const data = {
    title: typeof input?.title === 'string' ? input.title.trim() : '',
    fullName: normalizeName(input?.fullName),
    affiliation: typeof input?.affiliation === 'string' ? input.affiliation.trim() : '',
  };
  if (!TITLES.includes(data.title)) errors.title = 'กรุณาเลือกคำนำหน้า';
  if (data.fullName.length < 4 || data.fullName.length > 120 ||
      !/^[\p{L}\p{M}][\p{L}\p{M} .’'()\-]*$/u.test(data.fullName) || data.fullName.split(' ').length < 2) {
    errors.fullName = 'กรุณากรอกชื่อและนามสกุล เว้นวรรคระหว่างชื่อกับนามสกุล (4–120 ตัวอักษร)';
  }
  if (!AFFILIATIONS.includes(data.affiliation)) errors.affiliation = 'กรุณาเลือกสังกัด/คณะจากรายการ';
  return { valid: Object.keys(errors).length === 0, errors, data };
}
