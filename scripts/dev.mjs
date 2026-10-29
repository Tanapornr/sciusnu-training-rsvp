import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handleRegistration } from '../api/register.js';
const files = new Map([
  ['/email-example.html', ['email-example.html', 'text/html; charset=utf-8']],
  ['/email-example.css', ['email-example.css', 'text/css; charset=utf-8']],
  ['/images/training-hero-reference.png', ['images/training-hero-reference.png', 'image/png']],
  ['/fonts/Prompt-Regular.ttf', ['fonts/Prompt-Regular.ttf', 'font/ttf']],
  ['/fonts/Prompt-Medium.ttf', ['fonts/Prompt-Medium.ttf', 'font/ttf']],
  ['/fonts/Prompt-SemiBold.ttf', ['fonts/Prompt-SemiBold.ttf', 'font/ttf']],
  ['/fonts/Prompt-Bold.ttf', ['fonts/Prompt-Bold.ttf', 'font/ttf']],
  ['/fonts/Prompt-ExtraBold.ttf', ['fonts/Prompt-ExtraBold.ttf', 'font/ttf']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/template-1', ['template-1/index.html', 'text/html; charset=utf-8']],
  ['/template-1/', ['template-1/index.html', 'text/html; charset=utf-8']],
  ['/template-2', ['template-2/index.html', 'text/html; charset=utf-8']],
  ['/template-2/', ['template-2/index.html', 'text/html; charset=utf-8']],
  ['/template-2/styles.css', ['template-2/styles.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/readable.css', ['readable.css', 'text/css; charset=utf-8']],
  ['/confirmation.js', ['confirmation.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/validation.js', ['validation.js', 'text/javascript; charset=utf-8']],
  ['/calendar.js', ['calendar.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/favicon-scius.svg', ['favicon-scius.svg', 'image/svg+xml']],
  ['/images/logo-banner-scius.png', ['images/logo-banner-scius.png', 'image/png']],
  ['/images/speaker-chanadda.png', ['images/speaker-chanadda.png', 'image/png']],
  ['/event.ics', ['event.ics', 'text/calendar; charset=utf-8']],
]);
const headers = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')).headers[0].headers;
const server = http.createServer(async (req, res) => {
  for (const { key, value } of headers) res.setHeader(key, value);
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/register') {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const request = new Request('http://localhost:3000/api/register', {
        method: req.method, headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      const response = await handleRegistration(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const file = files.get(pathname);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    res.setHeader('Content-Type', file[1]);
    res.end(req.method === 'HEAD' ? undefined : await readFile(new URL('../public/' + file[0], import.meta.url)));
  } catch { res.writeHead(500).end('Server error'); }
});
server.listen(3000, '127.0.0.1', () => console.log('Local: http://localhost:3000 — real backend only; configure .env.local to register.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
