// Рисует картинки установщика из build/art/installer-art.js и сохраняет их в build/*.bmp (24 бита без сжатия — так хочет NSIS).
// Запуск из папки проекта: npx electron build/art/render.js [--png=папка]   (--png кладёт туда увеличенные PNG для просмотра)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const art = require('./installer-art.js');
const pngDir = process.argv.find((a) => a.startsWith('--png='))?.slice(6);
const SCALE = 3; // рисуем втрое крупнее и уменьшаем: края получаются гладкими

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-art-')));
app.on('window-all-closed', () => {});

// BGRA из картинки → BMP: 24 бита, строки снизу вверх, каждая выровнена до 4 байт
function bmp24(img) {
  const { width: w, height: h } = img.getSize();
  const src = img.toBitmap();
  const row = (w * 3 + 3) & ~3;
  const out = Buffer.alloc(54 + row * h);
  out.write('BM', 0, 'latin1');
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(row * h, 34);
  out.writeInt32LE(2835, 38);
  out.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = 54 + (h - 1 - y) * row + x * 3;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
    }
  }
  return out;
}

app.whenReady().then(async () => {
  const catJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'cat.js'), 'utf8');
  const scenesJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'scenes.js'), 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'femboy-art-html-'));
  for (const [name, { w, h, html }] of Object.entries(art)) {
    const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
    win.webContents.setZoomFactor(1);
    // Scenes и cat.js нужны до скрипта, который рисует пейзаж: вставляем их сразу после <body>
    const full = html.replace('<body>', `<body><script>${scenesJs}</script>`).replace('</body>', `<script>${catJs}</script></body>`);
    const file = path.join(tmp, name + '.html');
    fs.writeFileSync(file, full);
    await win.loadFile(file);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
    await new Promise((r) => setTimeout(r, 600));
    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: SCALE } });
    const big = nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(path.join(root, 'build', name + '.bmp'), bmp24(big.resize({ width: w, height: h, quality: 'best' })));
    if (pngDir) (fs.mkdirSync(pngDir, { recursive: true }), fs.writeFileSync(path.join(pngDir, name + '.png'), big.toPNG()));
    console.log('saved', name + '.bmp', `${w}×${h}`);
    win.destroy();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
});
