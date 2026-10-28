# sciusnu-training-rsvp

**SCiUS NU Training RSVP** — ระบบลงทะเบียนเข้าร่วมโครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์ โครงการ วมว. วันเสาร์ที่ **21 พฤศจิกายน 2569 (2026)** เวลา **09.00–16.00 น.**

เว็บภาษาไทย responsive ใช้ HTML/CSS/JavaScript และ **Vercel Node.js Function** เป็นตัวกลางส่งข้อมูลที่มีลายเซ็น HMAC ไปยัง **Google Apps Script Web App → Google Sheets** ไม่มี dependencies ภายนอก และไม่ต้องใช้ service-account credentials ในเว็บ

> โค้ดพร้อมติดตั้ง แต่ต้องสร้าง Sheet, deploy Apps Script และตั้งค่า environment variables ก่อนรับข้อมูลจริง ระบบจะไม่แสดงผลสำเร็จหากยังไม่ได้ตั้งค่าหรือยังยืนยันการบันทึกไม่ได้

## เริ่มใช้งาน

1. ทำตาม [คู่มือตั้งค่า Google Sheets / Apps Script / Vercel](docs/SETUP.th.md)
2. ใช้ Node.js 22 และรัน:

   ```sh
   npm ci
   npm run dev
   ```

3. เปิด [http://localhost:3000](http://localhost:3000) เพื่อดูเว็บ ตั้งค่าฝั่ง server ใน `.env.local` ตาม `.env.example` หากต้องการบันทึกจริง
4. ตรวจสอบโค้ดและเตรียมไฟล์เผยแพร่:

   ```sh
   npm run check
   npm run build
   ```

## ข้อมูลที่เก็บ

- คำนำหน้า: ศ.ดร., รศ.ดร., ผศ.ดร., ดร., นาย, นาง, นางสาว
- ชื่อ-นามสกุล (ไม่รวมคำนำหน้า)
- สังกัด/คณะ: โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร, คณะวิทยาศาสตร์, คณะวิทยาศาสตร์การแพทย์, คณะเภสัชศาสตร์, คณะโลจิสติกส์และดิจิทัลซัพพลายเชน, คณะสหเวชศาสตร์, คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติ และสิ่งแวดล้อม
- เวลาลงทะเบียน, รหัสลงทะเบียน และคีย์ที่ใช้ป้องกันรายการซ้ำ

**ไม่มีตัวเลือกเข้าร่วม/ไม่เข้าร่วม** ทุกคนที่ส่งข้อมูลสำเร็จถือว่ายืนยันเข้าร่วม

## กำหนดการ

| เวลา | หัวข้อ | วิทยากร |
| --- | --- | --- |
| 09.00–12.00 น. | จิตวิทยาในการสอน | ผู้ช่วยศาสตราจารย์ ดร.ชนัดดา ภูหงษ์ทอง — อาจารย์ประจำภาควิชาบริหาร วิจัยและพัฒนานวัตกรรมทางการศึกษา |
| 13.00–16.00 น. | เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา | น.ส.ภัทราภรณ์ ธีระการณ์ — นักจิตวิทยาปฏิบัติการ กลุ่มงานจิตเวชและยาเสพติด โรงพยาบาลพุทธชินราช พิษณุโลก |

ไม่ได้ระบุสถานที่จัดงาน เนื่องจากยังไม่ได้รับข้อมูลสถานที่

## โครงสร้าง

```text
public/                  หน้าเว็บและไฟล์ที่เผยแพร่ได้
  index.html             หน้าเว็บภาษาไทย
  styles.css             responsive / accessibility / print
  app.js                 ฟอร์ม การตรวจข้อมูล ผลสำเร็จ และการลองส่งซ้ำ
  validation.js          รายการตัวเลือกและ validation ที่ใช้ร่วมกับ server
  calendar.js            เลือกเปิดปฏิทินตามอุปกรณ์
  event.ics              ปฏิทินกิจกรรม (เวลาไทย)
api/register.js          Vercel Function — validation, origin check, HMAC
apps-script/Code.gs      backend เขียนข้อมูล ตรวจซ้ำ และ lock
apps-script/appsscript.json
scripts/                 local server และ static build
test/                    API + รัน Code.gs จริงกับ Google service adapters จำลอง
docs/SETUP.th.md          คู่มือติดตั้งและแก้ปัญหา
docs/SECURITY.th.md       ขอบเขตและข้อจำกัดความปลอดภัย
docs/VERIFICATION.th.md   ผลตรวจสอบก่อนส่งมอบ
vercel.json              deployment และ security headers
.env.example             ชื่อ environment variables เท่านั้น
```

## ป้องกันรายการซ้ำ

- ตรวจชื่อที่ปรับรูปแบบแล้ว + วันจัดโครงการ โดยชื่อเดียวกันเปลี่ยนสังกัดก็ลงซ้ำไม่ได้ สังกัดเดียวกันลงได้หลายคน ไม่มีโควตาต่อสังกัด โดยไม่ใช้คำนำหน้าเป็นตัวตัดสิน ไม่แยกตัวพิมพ์ใหญ่/เล็ก และไม่สนช่องว่างในชื่อ
- ใช้ `LockService.getScriptLock()` ครอบการตรวจและเขียนข้อมูล ป้องกันคำขอพร้อมกันแทรกรายการซ้ำ
- ส่งซ้ำด้วย `requestId` เดิมและข้อมูลเดิมจะได้รับรหัสเดิม ไม่เพิ่มแถว แม้ครั้งแรกบันทึกสำเร็จแต่เครือข่ายขัดข้อง
- เปลี่ยนข้อมูลระหว่างลองใหม่จะใช้ request ID ใหม่; ใช้ ID เดิมกับข้อมูลต่างกันจะถูกปฏิเสธ
- กรณีบุคคลชื่อและนามสกุลเหมือนกัน ต้องให้ผู้จัดตรวจสอบ เนื่องจากระบบไม่ได้เก็บอีเมล/เบอร์โทร/เลขประจำตัว จึงระบุตัวบุคคลที่แน่นอนไม่ได้

## Environment variables (เฉพาะ server)

| ชื่อ | ค่า |
| --- | --- |
| `APPS_SCRIPT_URL` | URL ของ Web App ลงท้าย `/exec` เช่น `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` |
| `APPS_SCRIPT_SECRET` | secret สุ่มอย่างน้อย 32 ตัวอักษร ตรงกับ `SHARED_SECRET` ใน Script Properties |
| `ALLOWED_ORIGINS` | ต้นทางเว็บที่อนุญาต คั่นด้วย comma เช่น `https://sciusnu-training-rsvp.vercel.app` |

อย่าใช้ prefix `NEXT_PUBLIC_` หรือ `VITE_` สำหรับค่าเหล่านี้ และอย่าใส่ลงในไฟล์ใต้ `public/` ดูรายละเอียดใน [คู่มือตั้งค่า](docs/SETUP.th.md) และ [ความปลอดภัย](docs/SECURITY.th.md)

## ทดสอบ

`npm test` ครอบคลุม validation, origin, JSON/ขนาดคำขอ, การตรวจ HMAC และ timestamp, การบันทึกจริงผ่าน Code.gs ในสภาพแวดล้อมจำลอง, การส่งซ้ำ, ชื่อซ้ำ, lock, schema เดิม, การปิดรับ และอัตราการส่ง ข้อมูลทดสอบอยู่ในหน่วยความจำ ไม่เขียน Google Sheets จริง

ก่อนเปิดรับจริง ต้องทดสอบ deployment ด้วย Sheet ทดสอบตาม checklist ในคู่มือ แล้วลบข้อมูลทดสอบผ่านผู้จัด ข้อมูลจริงและ credentials ไม่ควรอยู่ใน GitHub

## เอกสารทางการ

- [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Google Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [Google LockService](https://developers.google.com/apps-script/reference/lock/lock-service)

## หน้าสำเร็จและปฏิทิน

แสดงเฉพาะชื่อผู้เข้าร่วมและสังกัด/คณะ ไม่แสดงรหัส ไม่แสดงข้อความหลักฐานหรือปุ่มลงทะเบียนให้ท่านอื่น รหัสภายในยังเก็บใน Sheet เพื่อยืนยันผลและรองรับการลองส่งซ้ำ สังกัดเดียวกันลง 20–30 คนหรือมากกว่าได้หากชื่อต่างกัน ชื่อซ้ำแสดง “ชื่อของท่านได้ลงทะเบียนแล้ว”

คอมพิวเตอร์เปิด https://outlook.cloud.microsoft/calendar/view/workweek ตามที่กำหนด (เปิดหน้าปฏิทิน ยังไม่สร้างนัดหมายให้อัตโนมัติ) Android ใช้ลิงก์เปิด Google Calendar พร้อมรายละเอียดและมีหน้าเว็บสำรอง iPhone/iPad เปิดไฟล์กิจกรรม .ics โดยไม่บังคับดาวน์โหลด การเปิดแอปขึ้นกับแอปและเบราว์เซอร์ในเครื่อง ผู้ใช้ยังต้องยืนยันเพิ่มกิจกรรมเอง ไม่ส่งชื่อผู้เข้าร่วมไปในลิงก์
