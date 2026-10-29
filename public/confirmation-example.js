import { createConfirmationPng } from './confirmation.js?v=prompt-agenda';
try {
  const blob = await createConfirmationPng({ title: 'นางสาว', fullName: 'ตัวอย่าง ผู้เข้าร่วม', email: 'participant@example.com', affiliation: 'คณะวิทยาศาสตร์' });
  const url = URL.createObjectURL(blob);
  const image = document.querySelector('#example-image');
  image.src = url; image.hidden = false;
  const download = document.querySelector('#example-download');
  download.href = url; download.hidden = false;
  document.querySelector('#example-status').textContent = 'ภาพนี้แสดงรูปแบบเดียวกับที่ผู้ลงทะเบียนบันทึกได้';
} catch {
  document.querySelector('#example-status').textContent = 'ยังสร้างตัวอย่างรูปไม่ได้ กรุณาโหลดหน้าเว็บอีกครั้ง';
}
