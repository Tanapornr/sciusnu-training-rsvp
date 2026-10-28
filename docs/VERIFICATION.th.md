# ผลตรวจสอบก่อนส่งมอบ

ตรวจวันที่ 28 ตุลาคม 2569

## เส้นทางที่ทดสอบ

ผู้ใช้กรอกแบบฟอร์ม → ตรวจข้อมูลใน browser → `/api/register` → HMAC → รัน `Code.gs` → เขียนทะเบียน → ยืนยันผลแล้วแสดงชื่อผู้เข้าร่วมและสังกัด/คณะ

| ขอบเขต | ผล |
| --- | --- |
| JavaScript syntax check | ผ่าน |
| Automated tests | ผ่าน 15 กรณี |
| Static build | ผ่าน |
| Vercel Preview build (Node.js 22) | READY |
| Browser rendering | ตรวจหน้า desktop และมือถือ 390 / 320 px ไม่มี horizontal overflow |
| รายการตัวเลือก | 7 คำนำหน้าและ 7 สังกัด (ไม่รวม placeholder) |
| Browser validation | ส่งแบบว่างแล้วแสดงข้อผิดพลาด 3 ช่อง และย้าย focus ไปช่องแรก |
| API → Apps Script → Sheet adapters | ผ่าน โดยรัน Code.gs ต้นฉบับกับ Google services จำลอง |
| ซ้ำ / retry / ID conflict / lock | ผ่านในชุดทดสอบ การเขียนและ flush ต้องถือ lock |
| ลายเซ็นผิด / หมดอายุ / schema เดิม | ปฏิเสธโดยไม่เขียนทับข้อมูล |
| Calendar | วันที่/เวลาไทยถูกต้อง, CRLF และพับบรรทัดตามขนาด UTF-8 |
| Google Sheets จริง | ยังไม่ได้เชื่อมต่อ ต้องตั้งค่าและตรวจรับตาม SETUP.th.md |
| Upload GitHub | อ่าน repository ได้ แต่สร้าง branch ถูกปฏิเสธ 403 จึงไม่มีไฟล์เดิมถูกเปลี่ยน |

## ข้อจำกัดของผลตรวจ

- การทดสอบในเครื่องใช้ Node.js 24.14.0; deployment ตั้ง Node.js 22.x และ build บน Vercel สำเร็จ
- Google service adapters ใช้หน่วยความจำเพื่อทดสอบ logic ไม่ใช่การพิสูจน์สิทธิ์หรือโควตาของบัญชี Google จริง และไม่ใช่การทดสอบโหลดพร้อมกันบน Google infrastructure
- หน้าผลสำเร็จมีโค้ดและข้อมูลหลักฐานครบ แต่ยังไม่ได้ทดสอบการลงทะเบียนสำเร็จผ่าน browser ไปยัง Google Sheets จริง เพราะยังไม่มี Apps Script URL/secret ที่ใช้งานได้
- การเข้าถึง localhost จากเครื่องมือในเซสชันถูกจำกัด จึงตรวจหน้าจอผ่าน Vercel Preview แทน
- Preview ใช้ Deployment Protection และลิงก์แชร์ชั่วคราว ไม่ใช่การเปิดรับ production
- ยังไม่ได้แก้ environment variables ของ Vercel: connector ปฏิเสธการอ่านรายการด้วย 403 และไม่มี CLI ที่พร้อมใช้ จึงต้องตั้งค่าใน dashboard ตามคู่มือ

## ก่อนเปิดรับจริง

ทำ checklist ใน [คู่มือติดตั้ง](SETUP.th.md#6-ตรวจรับก่อนเปิดจริง) กับ Sheet ทดสอบ แล้วค่อยกำหนด production ใช้ Sheet/secret ของงานจริง
