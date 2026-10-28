# คู่มือติดตั้ง SCiUS NU Training RSVP

## 1. สร้าง Google Sheets

1. ลงชื่อเข้าใช้บัญชี Google ของผู้จัด สร้าง Google Sheets ชื่อ `SCiUS NU Training RSVP 2569`
2. คัดลอก Spreadsheet ID จาก URL ระหว่าง `/d/` กับ `/edit` เก็บไว้ใช้ในขั้นตอนถัดไป
3. ตั้งค่าแชร์เป็น **Restricted / จำกัด** และเพิ่มเฉพาะผู้จัดที่จำเป็น ไม่ต้อง Publish to web และไม่เปิด Anyone with the link
4. เปิด **Extensions / ส่วนขยาย → Apps Script** จาก Sheet นี้

## 2. ติดตั้ง Apps Script

1. แทนที่เนื้อหาไฟล์ `Code.gs` ในโปรเจกต์ใหม่ด้วย [Code.gs](../apps-script/Code.gs) จาก repository นี้
2. เปิด **Project Settings → Show "appsscript.json" manifest file in editor** แล้วนำ [appsscript.json](../apps-script/appsscript.json) ไปใส่ ตั้ง runtime เป็น V8 และเขตเวลา `Asia/Bangkok`
3. สร้าง secret สุ่มบนเครื่องของผู้จัด โดยรันคำสั่งนี้ด้วย Node.js แล้วเก็บค่าไว้ในเครื่องมือจัดการรหัสผ่าน:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   ค่าที่ได้เป็น secret จริง ห้ามโพสต์ใน GitHub, แชต หรือ client code

4. ที่ **Project Settings → Script Properties → Add script property** เพิ่ม:

   | Property | ค่า |
   | --- | --- |
   | `SPREADSHEET_ID` | ID ของ Sheet จากข้อ 1 |
   | `SHARED_SECRET` | secret ที่เพิ่งสร้าง (อย่างน้อย 32 ตัวอักษร) |
   | `SHEET_NAME` | `Registrations` |
   | `REGISTRATION_OPEN` | `true` |

5. กลับหน้า Editor เลือกฟังก์ชัน `setupSheet` แล้วกด **Run** อนุญาตสิทธิ์อ่าน/เขียน Sheet ด้วยบัญชีผู้จัด ตรวจสอบว่าเป็นโปรเจกต์ที่ตนเองสร้างก่อนอนุญาต หากบัญชีองค์กรไม่อนุญาต ให้ติดต่อผู้ดูแลระบบ
6. กลับไปดู Sheet จะมีแท็บ `Registrations` และ 14 คอลัมน์ (A–I เดิม และ J–N สำหรับอีเมล):

   | คอลัมน์ | ข้อมูล |
   | --- | --- |
   | A | ลงทะเบียนเมื่อ (Asia/Bangkok) |
   | B | รหัสลงทะเบียน |
   | C | คำนำหน้า |
   | D | ชื่อ-นามสกุล |
   | E | สังกัด/คณะ |
   | F | วันที่จัดโครงการ (`2026-11-21`) |
   | G | Request ID |
   | H | Participant key |
   | I | Payload hash |

`setupSheet` เรียกซ้ำได้โดยไม่ลบข้อมูล หากแท็บเดิมมีหัวคอลัมน์ไม่ตรงกัน ระบบจะหยุดเพื่อป้องกันข้อมูลเสียหาย ให้ใช้ชื่อแท็บใหม่ที่ว่างแทน ห้ามเปลี่ยนลำดับ/ลบคอลัมน์ G–I เพราะใช้ตรวจข้อมูลซ้ำ

## 3. Deploy เป็น Web App

1. ใน Apps Script เลือก **Deploy → New deployment**
2. กดไอคอนรูปเฟือง เลือก **Web app**
3. Description: `SCiUS NU Training RSVP v1`
4. **Execute as: Me / ฉัน** (บัญชีผู้จัดที่มีสิทธิ์แก้ไข Sheet)
5. **Who has access: Anyone / ทุกคน** เพื่อให้ Vercel Function เรียกโดยไม่ต้องมี Google login; ข้อมูลจะเขียนได้เฉพาะคำขอที่ผ่าน HMAC
6. กด Deploy และคัดลอก **Web app URL ที่ลงท้าย `/exec`** ไม่ใช้ `/dev`
7. เปิด URL นี้ในหน้าต่างไม่ระบุตัวตน ควรได้ JSON ที่มี `service: "sciusnu-training-rsvp"` โดยไม่ถามให้ login และไม่แสดงรายชื่อผู้เข้าร่วม

หาก Workspace ไม่มีตัวเลือก Anyone ให้ผู้ดูแลองค์กรอนุญาตการ deploy รูปแบบนี้ หรือปรับสถาปัตยกรรมให้รองรับ OAuth; ห้ามเปลี่ยนไปใช้ `no-cors` เพราะจะไม่ทราบว่าบันทึกสำเร็จจริงหรือไม่

เมื่อแก้ `Code.gs` ต้อง **Deploy → Manage deployments → Edit → Version: New version → Deploy** เพื่ออัปเดต `/exec` ส่วนการแก้ Script Properties ใช้ได้โดยไม่ต้องสร้าง code version ใหม่

## 4. รันบนเครื่อง

ใช้ Node.js **22.x** เปิด terminal ในโฟลเดอร์โปรเจกต์:

```sh
npm ci
```

คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่าผ่าน editor บนเครื่อง:

```dotenv
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
APPS_SCRIPT_SECRET=YOUR_GENERATED_SECRET
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

ข้อความ `YOUR_...` เป็นคำอธิบาย ต้องแทนด้วยค่าจริงที่เก็บไว้เฉพาะในเครื่อง ไม่ต้องใส่เครื่องหมายคำพูดหรือช่องว่างท้ายค่า

```sh
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) เว็บแสดงได้แม้ยังไม่ตั้งค่า แต่การส่งจริงจะตอบว่า “ระบบยังไม่พร้อมรับลงทะเบียน” จนกว่าจะตั้งครบ ไม่มีโหมดแกล้งบันทึกสำเร็จ

## 5. GitHub และ Vercel

ไฟล์โครงการถูกเตรียมให้ใช้กับ GitHub repository `sciusnu-training-rsvp` โดยตรง หากได้รับงานผ่าน branch/PR ให้ตรวจและ merge เข้า `main` ก่อน import สำหรับ production หรือเลือก branch งานสำหรับ preview

### หากต้องอัปโหลดไฟล์ด้วยตนเอง

กรณี GitHub connector ไม่มีสิทธิ์เขียน (403) ให้ใช้ไฟล์ ZIP ที่ส่งมอบ:

1. แตก ZIP แล้วเปิดโฟลเดอร์ `sciusnu-training-rsvp`
2. เปิด repository [Tanapornr/sciusnu-training-rsvp](https://github.com/Tanapornr/sciusnu-training-rsvp) → **Add file → Upload files**
3. ลาก **ไฟล์และโฟลเดอร์ภายใน** โปรเจกต์ทั้งหมดขึ้นไป อย่าอัปโหลด ZIP และอย่าให้มีโฟลเดอร์ `sciusnu-training-rsvp/` ซ้อนเหนือ `package.json` ให้รวมไฟล์ที่ขึ้นต้นด้วยจุด เช่น `.gitignore`, `.env.example`, `.vercelignore` ด้วย
4. เลือก **Create a new branch for this commit and start a pull request** ตั้งชื่อเช่น `setup/training-rsvp` ไม่แก้ทับ `main` ทันที
5. กด Propose changes แล้วตรวจรายการไฟล์และ Create pull request; `README.md` เดิมเป็นหัวเรื่องสั้น ๆ โค้ดชุดนี้คงหัวเรื่องเดิมและเพิ่มคู่มือใน branch ใหม่
6. ตรวจ diff แล้ว merge เมื่อพร้อม ถ้า repository มีงานเพิ่มเข้ามาระหว่างนั้น ให้ตรวจความขัดแย้งก่อน merge

### Deploy บน Vercel

1. เข้า [Vercel](https://vercel.com/) ด้วยบัญชีผู้จัด → **Add New → Project** → Import Git Repository → `sciusnu-training-rsvp`
2. ถ้าไม่พบ repository ให้ตั้งสิทธิ์ GitHub integration ของ Vercel ให้เข้าถึง repository นี้
3. ตั้ง **Framework Preset: Other**, Root Directory เป็นราก repository
4. **Build Command: `npm run build`**, **Output Directory: `dist`**, Install Command ใช้ค่าเริ่มต้น (`npm install`) หรือ `npm ci` โครงการไม่มี dependencies ภายนอก
5. เลือก **Node.js 22.x** ตัว API ใน `api/register.js` จะเป็น Vercel Function โดยอัตโนมัติ ไม่ต้องคัดลอก API ไปไว้ใน `dist`
6. ที่ **Environment Variables** เพิ่มค่าต่อไปนี้ให้ environment **Production**:

   | Name | Value | ชนิดที่แนะนำ |
   | --- | --- | --- |
   | `APPS_SCRIPT_URL` | Web App URL `/exec` ของ production | Secret |
   | `APPS_SCRIPT_SECRET` | ค่าเดียวกับ `SHARED_SECRET` ของ production | Secret |
   | `ALLOWED_ORIGINS` | เช่น `https://sciusnu-training-rsvp.vercel.app` | Config |

   ใช้ domain ที่ Vercel ให้จริง หากชื่อถูกใช้ไปแล้ว domain อาจต่างจากตัวอย่าง หากยังไม่ทราบ domain ให้ deploy เว็บก่อนหนึ่งครั้ง จากนั้นตั้ง `ALLOWED_ORIGINS` ให้ตรงกับ domain และ redeploy ระบบจะไม่รับข้อมูลขณะยังไม่มีค่าที่อนุญาต

7. กด Deploy แล้วเปิด URL ที่ได้ ใน dashboard ตรวจว่า build สำเร็จและมี `/api/register`
8. เมื่อเปลี่ยน env ให้ **Redeploy** เพื่อให้ deployment ใหม่รับค่า ห้ามแก้ชื่อให้ขึ้นต้นด้วย `NEXT_PUBLIC_` หรือ `VITE_`
9. หากเพิ่ม custom domain ให้เพิ่ม exact origin คั่นด้วย comma เช่น `https://example.ac.th,https://www.example.ac.th` โดยไม่มี path, wildcard หรือ trailing slash แล้ว redeploy

### Preview / Development

- สร้าง **Sheet + Apps Script deployment + secret แยกจาก production** แล้วตั้งค่าใน environment Preview / Development แยกกัน เพื่อไม่ให้การทดสอบเพิ่มชื่อในทะเบียนจริง
- `ALLOWED_ORIGINS` สำหรับ preview ต้องเป็น URL ของ preview ที่ใช้จริง เพิ่ม origin นั้นและ redeploy ก่อนทดสอบ ไม่เปิด wildcard `*.vercel.app`
- หากใช้ Vercel CLI ให้ link project/team ให้ถูกก่อน `vercel env pull .env.local` และตรวจชื่อ variables กับ `.env.example`; Secret ของ Production/Preview อาจไม่ถูก pull กลับมา จึงควรมีค่า Development แยกต่างหาก
- ไม่ commit `.env.local`, `.vercel/`, export ของ Sheet หรือไฟล์หลักฐานที่มีรายชื่อผู้เข้าร่วม

## 6. ตรวจรับก่อนเปิดจริง

ใช้ Sheet ทดสอบและชื่อทดสอบก่อน:

- เปิดหน้า desktop และมือถือ ตรวจเนื้อหาไทย คำนำหน้า 7 รายการ สังกัด 7 รายการ และวันที่
- ส่งข้อมูลไม่ครบ → แสดงคำแนะนำใต้ช่อง โดยไม่เพิ่มแถว
- ส่งข้อมูลถูกต้อง → ได้หน้ายืนยัน “ลงทะเบียนสำเร็จ” และรหัส `NU69-...` ตรงกับแถวใน Sheet
- กดส่งซ้ำ/จำลองเครือข่ายขาดระหว่างตอบกลับ แล้วลองส่งข้อมูลเดิม → มีเพียง 1 แถว
- เปิดอีกแท็บแล้วส่งชื่อเดิม แม้เปลี่ยนคำนำหน้า ช่องว่าง หรือสังกัด → แจ้ง “ชื่อของท่านได้ลงทะเบียนแล้ว”
- เปิดพร้อมกันสองแท็บ ส่งชื่อเดียวกัน → เพิ่มเพียง 1 แถว
- ตรวจหน้าสำเร็จมีชื่อ อีเมล สังกัด วันเวลา สถานที่ และเบอร์ติดต่อ ทดสอบดาวน์โหลด PNG ให้มีข้อมูลครบ ไม่มีปุ่มปฏิทิน ทดสอบสังกัดเดียวกัน 30 ชื่อต่างกันได้
- เปลี่ยน `REGISTRATION_OPEN` เป็น `false` → คำขอใหม่ถูกปิดรับ แล้วคืนเป็น `true` เมื่อพร้อม
- ตรวจว่า Sheet ยังแชร์แบบ Restricted และ browser Network มีเพียง `/api/register` ไม่มี Apps Script URL, secret, signature หรือ IP hash

ลบ **ทั้งแถว** ของข้อมูลทดสอบที่ต้องการนำออก (หลังสำรองข้อมูล) อย่าลบเพียงชื่อหรือคีย์บางคอลัมน์ ป้องกันการจับคู่ผิด ห้ามแก้ทะเบียนจริงระหว่างมีผู้ลงทะเบียนโดยไม่วางแผน

## 7. การดูแลและแก้ปัญหา

| อาการ | ตรวจสอบ/แก้ไข |
| --- | --- |
| ระบบยังไม่พร้อมรับลงทะเบียน | ตรวจ `APPS_SCRIPT_URL`, secret ยาวอย่างน้อย 32 ตัว, environment ที่เลือก และ redeploy Vercel |
| ส่งจากหน้าเว็บนี้ไม่ได้ | ตรวจ `ALLOWED_ORIGINS` ให้ตรง scheme + domain + port ของหน้าที่เปิด ไม่มี `/` ท้าย |
| ยังยืนยันผลการบันทึกไม่ได้ | เปิด `/exec` แบบไม่ระบุตัวตน ตรวจ Anyone / Execute as Me / เวอร์ชันล่าสุด / secret ตรงกัน / สิทธิ์ Sheet |
| โค้ดใหม่ไม่ทำงาน | Apps Script ต้อง deploy New version; Vercel ต้อง redeploy หลังเปลี่ยน env |
| Apps Script execution ล้มเหลว | ตรวจ Script Properties, Sheet ID, สิทธิ์บัญชีผู้ deploy, ชื่อแท็บและหัวคอลัมน์เดิม ดู Executions ใน Apps Script โดยไม่เพิ่ม log รายชื่อ/secret |
| ข้อมูลซ้ำแต่เป็นคนละคน | ผู้จัดตรวจสอบด้วยตนเอง เพราะไม่ได้เก็บตัวระบุเฉพาะบุคคล ห้ามให้ผู้ใช้ใส่ข้อมูลปลอมเพื่อหลบการตรวจซ้ำ |
| ส่งจำนวนมาก/ต้องรอ | รอประมาณ 10 นาที ระบบจำกัดแบบ best effort 120 รายการใหม่ต่อ IP hash ต่อช่วง 10 นาที ผู้ใช้เครือข่ายเดียวกันอาจแชร์ IP |
| Sheet quota หรือ lock เต็ม | รอแล้วส่งซ้ำด้วยหน้าเดิม ตรวจ Apps Script quotas และพิจารณาฐานข้อมูลสำหรับงานขนาดใหญ่ |

ปิดรับเมื่อผู้จัดต้องการโดยตั้ง Script Property `REGISTRATION_OPEN=false` ระบบยังคืนหลักฐานเดิมสำหรับ retry ของรายการที่บันทึกไปแล้ว การปิดรับไม่ได้เกิดอัตโนมัติตามวันงาน

## เอกสารทางการ

- [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web)
- [Apps Script Properties](https://developers.google.com/apps-script/guides/properties)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)

## อีเมลเตือนรุ่น 1.2

อ่าน [REMINDERS.th.md](REMINDERS.th.md) ก่อนเปิดใช้ ต้องอัปเดต Code.gs/manifest อนุญาตส่งอีเมลและตั้งเวลา แล้วเรียก setupEmailReminder การตั้งเวลาและ preview ไม่ส่งอีเมลทันที คอลัมน์ J อีเมล, K สถานะเตือน, L เวลาส่ง, M เวลาพยายามส่ง, N หมายเหตุ
