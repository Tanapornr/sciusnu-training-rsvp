import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAppsScriptHarness, sign } from './helpers/apps-script.mjs';
const data=()=>({title:'นางสาว',fullName:'ตัวอย่าง ผู้เข้าร่วม',email:'participant@example.com',affiliation:'คณะวิทยาศาสตร์',requestId:randomUUID(),clientKey:'a'.repeat(64),eventDate:'2026-11-21',schemaVersion:2});
test('a saved registration sends one personal confirmation; retries and duplicates send nothing more',()=>{
 const h=createAppsScriptHarness(),input=data();
 const result=h.post(sign(input)); assert.equal(result.code,'CREATED'); assert.equal(result.confirmationEmailStatus,'SENT');
 assert.equal(h.rows.length,2); assert.equal(h.rows[1][14],'SENT'); assert.equal(h.outbox.length,1);
 assert.equal(h.outbox[0].to,input.email); assert.equal(h.outbox[0].cc,undefined); assert.equal(h.outbox[0].bcc,undefined);
 for(const text of ['ลงทะเบียนสำเร็จ','SC1-411','21 พฤศจิกายน 2569','ธนาภรณ์ รอดฉ่ำ','https://maps.app.goo.gl/oaKL7rKsn9W3KA5U8']) assert.ok(h.outbox[0].body.includes(text));
 for(const text of ['กำหนดการ','วิทยากร','จิตวิทยาในการสอน','ภัทราภรณ์']) { assert.equal(h.outbox[0].body.includes(text),false); assert.equal(h.outbox[0].htmlBody.includes(text),false); }
 assert.equal(h.post(sign(input)).confirmationEmailStatus,'SENT');
 assert.equal(h.post(sign({...input,requestId:randomUUID()})).code,'DUPLICATE'); assert.equal(h.outbox.length,1);
});
test('quota exhaustion preserves registration and queues exactly one later confirmation',()=>{
 const h=createAppsScriptHarness();h.setQuota(0);assert.equal(h.post(sign(data())).confirmationEmailStatus,'PENDING');
 assert.equal(h.rows.length,2);assert.equal(h.outbox.length,0);assert.equal(h.rows[1][14],'PENDING');
 h.context.setupConfirmationEmails();h.context.setupConfirmationEmails();assert.equal(h.triggers.length,1);assert.equal(h.outbox.length,0);
 h.setQuota(10);assert.equal(h.context.sendPendingConfirmations().sent,1);assert.equal(h.context.sendPendingConfirmations().sent,0);assert.equal(h.outbox.length,1);
});
test('an ambiguous provider failure never erases a registration or sends it again automatically',()=>{
 const h=createAppsScriptHarness();h.setMailFailure(true);const input=data();
 assert.equal(h.post(sign(input)).confirmationEmailStatus,'ERROR');assert.equal(h.rows.length,2);assert.equal(h.rows[1][14],'ERROR');assert.equal(h.outbox.length,1);
 h.setMailFailure(false);assert.equal(h.context.sendPendingConfirmations().sent,0);assert.equal(h.post(sign(input)).confirmationEmailStatus,'ERROR');assert.equal(h.outbox.length,1);
});
test('confirmation setup does not mail historical rows or disturb the dated reminders',()=>{
 const h=createAppsScriptHarness();h.setup();h.rows.push(['2026-10-28 12:00:00','NU69-1234567890ABCDEF','นาย','ผู้เข้าร่วม เดิม','คณะวิทยาศาสตร์','2026-11-21','old-request','old-key','old-hash','old@example.com','PENDING','','','']);
 h.context.setupEmailReminder();h.context.setupConfirmationEmails();assert.equal(h.triggers.length,3);assert.equal(h.context.sendPendingConfirmations().sent,0);assert.equal(h.outbox.length,0);assert.equal(h.rows[1][10],'PENDING');
});
test('the email preview escapes participant text without sending messages',()=>{
 const h=createAppsScriptHarness();h.context.previewConfirmationEmail();const mail=h.context.rsvpConfirmationMessage_({title:'นาย',fullName:'<img src=x>',email:'a@example.com',affiliation:'A & B'});
 assert.ok(mail.htmlBody.includes('&lt;img src=x&gt;'));assert.ok(mail.htmlBody.includes('A &amp; B'));assert.equal(h.outbox.length,0);
});

test('the reminder includes every eligible registration, including legacy late markers, without repeat delivery',()=>{
 const h=createAppsScriptHarness();
 for(let i=0;i<3;i++) h.post(sign({...data(),fullName:'ผู้เข้าร่วม '+String.fromCharCode(65+i),email:'person'+i+'@example.com'}));
 h.rows[2][10]='LATE'; h.rows[3][10]='MISSING_EMAIL';
 h.context.setupEmailReminder();h.outbox.length=0;
 h.setNow('2026-11-20T09:30:00+07:00');
 assert.equal(h.context.sendScheduledReminders().sent,3);assert.equal(h.outbox.length,3);
 assert.ok(h.outbox.every(mail=>mail.subject.startsWith('แจ้งเตือน')));
 for(const mail of h.outbox){assert.ok(mail.body.includes('จิตวิทยาในการสอน'));assert.ok(mail.htmlBody.includes('กำหนดการและวิทยากร'));assert.equal(mail.cc,undefined);assert.equal(mail.bcc,undefined);}
 assert.equal(h.context.sendScheduledReminders().sent,0);assert.equal(h.outbox.length,3);
});

test('the existing five-minute worker catches later registrations on reminder day, without sending reminders early',()=>{
 const h=createAppsScriptHarness();h.context.setupEmailReminder();h.context.setupConfirmationEmails();
 h.context.sendPendingConfirmations();assert.equal(h.outbox.length,0);
 h.setNow('2026-11-20T10:00:00+07:00');
 const input=data();h.post(sign(input,undefined,String(h.context.Date.now())));
 assert.equal(h.outbox.length,1);assert.equal(h.rows[1][10],'PENDING');
 h.context.sendPendingConfirmations();assert.equal(h.outbox.length,2);assert.equal(h.rows[1][10],'SENT');
 h.context.sendPendingConfirmations();assert.equal(h.outbox.length,2);
});
