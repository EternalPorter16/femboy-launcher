// Значки сайта из логотипа лаунчера (src/assets/logo.png): favicon.ico (16 и 32), 192 px, apple-touch-icon.
// Запуск: node scripts/make-icons.mjs — файлы ложатся в public/. Нужен только при смене логотипа.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const src = fileURLToPath(new URL('../src/assets/logo.png', import.meta.url));
const out = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const png = (size) => sharp(src).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();

// ICO с PNG внутри (так умеют все современные браузеры и Windows)
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(images[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});
writeFileSync(out('favicon.ico'), Buffer.concat([header, ...images]));
writeFileSync(out('icon-192.png'), await png(192));
writeFileSync(out('icon-512.png'), await png(512));
// apple-touch-icon: на светло-розовом фоне, без прозрачности
const logo180 = await sharp(src).resize(150, 150).png().toBuffer();
await sharp({ create: { width: 180, height: 180, channels: 4, background: '#fdeef4' } })
  .composite([{ input: logo180, left: 15, top: 15 }])
  .png()
  .toFile(out('apple-touch-icon.png'));
console.log('ok: favicon.ico, icon-192.png, icon-512.png, apple-touch-icon.png');
