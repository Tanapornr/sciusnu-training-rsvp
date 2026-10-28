import { cp, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('public/index.html', root), 'utf8');
for (const required of ['lang="th"', '2026-11-21', 'registration-form', '/app.js']) {
  if (!html.includes(required)) throw new Error(`Missing required page content: ${required}`);
}
await mkdir(new URL('dist/', root), { recursive: true });
await cp(new URL('public/', root), new URL('dist/', root), { recursive: true });
console.log(`Built static site: ${fileURLToPath(new URL('dist/', root))}`);
