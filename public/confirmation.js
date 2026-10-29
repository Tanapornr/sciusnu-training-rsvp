export const EVENT = Object.freeze({
  project: 'โครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์',
  program: 'โครงการ วมว.',
  date: 'วันเสาร์ที่ 21 พฤศจิกายน 2569',
  time: '09.00–16.00 น.',
  venue: 'ห้อง SC1-411 อาคารบริหาร คณะวิทยาศาสตร์ มหาวิทยาลัยนเรศวร',
  contact: '094-9426428 ธนาภรณ์ รอดฉ่ำ',
  mapUrl: 'https://maps.app.goo.gl/oaKL7rKsn9W3KA5U8',
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => reject(new Error('Image loading timed out')), 15000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('Image loading failed')); };
    image.src = src;
  });
}

export async function createConfirmationPng(person) {
  // Wait explicitly: a save immediately after registration must use Prompt too.
  await Promise.all([400, 600, 700].map(weight => document.fonts.load(`${weight} 32px Prompt`, 'ผู้เข้าร่วม SCiUS')));
  await document.fonts.ready;
  const [logo, portrait] = await Promise.all([
    loadImage('/images/logo-banner-scius.png'),
    loadImage('/images/speaker-chanadda.png'),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  const ink = '#173b3c', muted = '#61716c', line = '#dfe4da';
  const commands = [];
  let y = 360;
  function text(value, { size = 34, weight = 400, color = ink, x = 95, max = 1010, gap = 15 } = {}) {
    ctx.font = `${weight} ${size}px Prompt, sans-serif`;
    const parts = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('th', { granularity: 'word' }).segment(String(value))].map(item => item.segment)
      : Array.from(String(value));
    let current = '';
    const flush = () => {
      const content = current.trim(), baseline = y;
      commands.push(() => { ctx.fillStyle = color; ctx.font = `${weight} ${size}px Prompt, sans-serif`; ctx.fillText(content, x, baseline); });
      y += size + gap; current = '';
    };
    for (const part of parts) {
      if (ctx.measureText(current + part).width <= max) { current += part; continue; }
      if (current) flush();
      if (ctx.measureText(part).width <= max) { current = part; continue; }
      // Email addresses and exceptionally long words also remain within the card.
      for (const char of Array.from(part)) {
        if (ctx.measureText(current + char).width > max && current) flush();
        current += char;
      }
    }
    if (current) flush();
  }
  function rule() {
    const at = y;
    commands.push(() => { ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(95, at); ctx.lineTo(1105, at); ctx.stroke(); });
    y += 58;
  }
  text('ลงทะเบียนสำเร็จ', { size: 52, weight: 600 }); y += 22;
  for (const [label, value] of [['ผู้เข้าร่วม', `${person.title} ${person.fullName}`], ['อีเมล', person.email], ['สังกัด/คณะ', person.affiliation]]) {
    text(label, { size: 26, color: muted });
    text(value, { size: 36, weight: 600 }); y += 20;
  }
  rule();
  text('เข้าร่วมโครงการ', { size: 27, color: muted });
  text(EVENT.project, { size: 34, weight: 600 });
  text(EVENT.program, { size: 34, weight: 600 }); y += 18;
  text(EVENT.date, { size: 32 }); text(`เวลา ${EVENT.time}`, { size: 32 }); y += 12;
  text(`ณ ${EVENT.venue}`, { size: 32 }); y += 18;
  rule();
  text('กำหนดการและวิทยากร', { size: 36, weight: 600 }); y += 2;

  function session({ period, time, topic, name, roles, morning }) {
    const top = y, backgroundIndex = commands.length;
    const headerFill = morning ? '#e9eee3' : '#f2e8d3';
    y = top + 50;
    text(`${period}  ·  ${time}`, { x: 130, max: 940, size: 28, weight: 500 });
    y = top + 119;
    text('หัวข้อการบรรยาย', { x: 130, size: 24, color: muted });
    text(topic, { x: 130, max: 940, size: 34, weight: 600 }); y += 14;
    const speakerTop = y - 28;
    const speakerX = morning ? 320 : 230;
    if (morning) {
      commands.push(() => {
        ctx.save(); ctx.beginPath(); ctx.roundRect(130, speakerTop, 155, 195, 12); ctx.clip();
        ctx.drawImage(portrait, 130, speakerTop, 155, 195); ctx.restore();
      });
    } else {
      commands.push(() => {
        ctx.fillStyle = '#f0e6d0'; ctx.beginPath(); ctx.arc(162, speakerTop + 32, 32, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8a6930'; ctx.font = '500 28px Prompt'; ctx.fillText('ภ', 151, speakerTop + 43);
      });
    }
    text(name, { x: speakerX, max: 1070 - speakerX, size: 28, weight: 600 });
    for (const role of roles) text(role, { x: speakerX, max: 1070 - speakerX, size: 25, color: muted, gap: 14 });
    y = Math.max(y, speakerTop + (morning ? 195 : 64)) + 32;
    const height = y - top;
    commands.splice(backgroundIndex, 0, () => {
      ctx.save(); ctx.beginPath(); ctx.roundRect(95, top, 1010, height, 18); ctx.clip();
      ctx.fillStyle = '#fcfcf6'; ctx.fillRect(95, top, 1010, height);
      ctx.fillStyle = headerFill; ctx.fillRect(95, top, 1010, 78); ctx.restore();
      ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(95, top, 1010, height, 18); ctx.stroke();
    });
    y += 24;
  }
  session({ period: 'ช่วงเช้า', time: '09.00–12.00 น.', topic: 'จิตวิทยาในการสอน', name: 'ผู้ช่วยศาสตราจารย์ ดร.ชนัดดา ภูหงษ์ทอง', morning: true,
    roles: ['อาจารย์ประจำภาควิชาบริหาร', 'วิจัยและพัฒนานวัตกรรมทางการศึกษา', 'คณะศึกษาศาสตร์ มหาวิทยาลัยนเรศวร'] });
  session({ period: 'ช่วงบ่าย', time: '13.00–16.00 น.', topic: 'เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา', name: 'น.ส.ภัทราภรณ์ ธีระการณ์', morning: false,
    roles: ['นักจิตวิทยาปฏิบัติการ', 'กลุ่มงานจิตเวชและยาเสพติด', 'โรงพยาบาลพุทธชินราช พิษณุโลก'] });
  y += 18;
  text('แผนที่สถานที่จัดโครงการ', { size: 25, color: muted });
  text(EVENT.mapUrl, { size: 27 }); y += 22;
  text('สอบถามข้อมูลเพิ่มเติม', { size: 25, color: muted });
  text(EVENT.contact, { size: 30 });

  // Render only after measuring, so long names never clip the last section.
  canvas.height = Math.ceil(y + 70);
  ctx.fillStyle = '#f7f7f0'; ctx.fillRect(0, 0, 1200, canvas.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(42, 42, 1116, canvas.height - 84);
  ctx.fillStyle = ink; ctx.fillRect(42, 42, 1116, 238);
  const logoWidth = 890, logoHeight = logoWidth * logo.naturalHeight / logo.naturalWidth;
  ctx.drawImage(logo, 95, 62, logoWidth, logoHeight);
  ctx.fillStyle = '#e6b65a'; ctx.font = '500 25px Prompt';
  ctx.fillText('ยืนยันการเข้าร่วมโครงการ · 2569', 95, 255);
  for (const draw of commands) draw();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image export failed')), 'image/png'));
}
