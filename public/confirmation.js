export const EVENT = Object.freeze({
  project: 'โครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์',
  program: 'โครงการ วมว.',
  date: 'วันเสาร์ที่ 21 พฤศจิกายน 2569',
  time: '09.00–16.00 น.',
  venue: 'ห้อง SC1-411 อาคารบริหาร คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร',
  contact: '094-9426428 ธนาภรณ์ รอดฉ่ำ',
});

export async function createConfirmationPng(person) {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 3400;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  const ink = '#173b3c';
  const muted = '#536863';
  const font = '"Leelawadee UI", "Noto Sans Thai", Tahoma, sans-serif';
  ctx.fillStyle = '#f7f7f0'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(42, 42, 1116, canvas.height - 84);
  ctx.fillStyle = ink; ctx.fillRect(42, 42, 1116, 190);
  ctx.fillStyle = '#e6b65a'; ctx.font = `bold 42px ${font}`;
  ctx.fillText('SCiUS NU TRAINING RSVP', 95, 125);
  ctx.fillStyle = '#fff'; ctx.font = `34px ${font}`;
  ctx.fillText('ยืนยันการเข้าร่วมโครงการ · 2569', 95, 185);
  let y = 315;
  function line(text, size = 38, color = ink, bold = false, gap = 19) {
    ctx.fillStyle = color;
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}`;
    const max = 1005;
    const words = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map(item => item.segment)
      : Array.from(text);
    let current = '';
    const flush = () => { ctx.fillText(current.trim(), 95, y); y += size + gap; current = ''; };
    for (const word of words) {
      if (ctx.measureText(current + word).width <= max) { current += word; continue; }
      if (current) flush();
      if (ctx.measureText(word).width <= max) { current = word; continue; }
      // An unusually long email must wrap rather than run outside the image.
      for (const char of Array.from(word)) {
        if (ctx.measureText(current + char).width > max && current) flush();
        current += char;
      }
    }
    if (current) flush();
  }
  line('ลงทะเบียนสำเร็จ', 58, ink, true); y += 26;
  for (const [label, value] of [['ผู้เข้าร่วม', `${person.title} ${person.fullName}`], ['อีเมล', person.email], ['สังกัด/คณะ', person.affiliation]]) {
    line(label, 29, muted); line(value, 39, ink, true); y += 22;
  }
  ctx.strokeStyle = '#dfe4da'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(95, y); ctx.lineTo(1100, y); ctx.stroke(); y += 68;
  line('เข้าร่วมโครงการ', 30, muted);
  line(EVENT.project, 39, ink, true); line(EVENT.program, 39, ink, true); y += 24;
  line(EVENT.date, 37); line(`เวลา ${EVENT.time}`, 37); y += 22;
  line(`ณ ${EVENT.venue}`, 37); y += 34;
  line('สอบถามข้อมูลเพิ่มเติม', 29, muted); line(EVENT.contact, 35);
  // Keep all text even for long names, addresses, and affiliations.
  const output = document.createElement('canvas');
  output.width = 1200; output.height = Math.max(1500, y + 90);
  const out = output.getContext('2d');
  if (!out) throw new Error('Canvas is unavailable');
  out.fillStyle = '#f7f7f0'; out.fillRect(0, 0, output.width, output.height);
  out.fillStyle = '#fff'; out.fillRect(42, 42, 1116, output.height - 84);
  // Most receipts fit the initial canvas; create a taller source for unusually long text.
  if (y + 90 > canvas.height) throw new Error('Receipt is too tall');
  out.drawImage(canvas, 0, 0, 1200, Math.min(canvas.height, output.height), 0, 0, 1200, Math.min(canvas.height, output.height));
  return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed')), 'image/png'));
}
