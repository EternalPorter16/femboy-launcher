// Скины: раскладка текстуры 64×64, пресеты, 3D-превью (skinview3d) и пиксельный редактор
(function () {
  const SIZE = 64;
  const ZOOM = 8;

  // [название, u, v, ширина, высота, глубина, слой (0 — основной, 1 — второй), рука?]
  const BOXES = [
    ['Голова', 0, 0, 8, 8, 8, 0],
    ['Шапка', 32, 0, 8, 8, 8, 1],
    ['Тело', 16, 16, 8, 12, 4, 0],
    ['Куртка', 16, 32, 8, 12, 4, 1],
    ['Правая рука', 40, 16, 4, 12, 4, 0, true],
    ['Правый рукав', 40, 32, 4, 12, 4, 1, true],
    ['Левая рука', 32, 48, 4, 12, 4, 0, true],
    ['Левый рукав', 48, 48, 4, 12, 4, 1, true],
    ['Правая нога', 0, 16, 4, 12, 4, 0],
    ['Правая штанина', 0, 32, 4, 12, 4, 1],
    ['Левая нога', 16, 48, 4, 12, 4, 0],
    ['Левая штанина', 0, 48, 4, 12, 4, 1],
  ];
  const SIDES = { top: 'верх', bottom: 'низ', right: 'правый бок', front: 'перед', left: 'левый бок', back: 'спина' };

  function faces(model) {
    const out = [];
    for (const [name, u, v, w0, h, d, layer, arm] of BOXES) {
      const w = arm && model === 'slim' ? 3 : w0;
      const rects = {
        top: [u + d, v, w, d],
        bottom: [u + d + w, v, w, d],
        right: [u, v + d, d, h],
        front: [u + d, v + d, w, h],
        left: [u + d + w, v + d, d, h],
        back: [u + 2 * d + w, v + d, w, h],
      };
      for (const [side, [x, y, fw, fh]] of Object.entries(rects)) out.push({ box: name, side, layer, x, y, w: fw, h: fh });
    }
    return out;
  }
  const faceAt = (list, x, y) => list.find((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);

  const newCanvas = (w = SIZE, h = SIZE) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось открыть картинку'));
      img.src = src;
    });
  }

  // Старые скины 64×32: левые рука и нога зеркалятся с правых, как это делает игра
  async function toCanvas(src) {
    const img = await loadImage(src);
    if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) throw new Error(`Скин должен быть 64×64, а этот ${img.width}×${img.height}`);
    const c = newCanvas();
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    if (img.height === 32) {
      const copy = (sx, sy, w, h, dx, dy) => {
        ctx.save();
        ctx.translate(dx + w, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
        ctx.restore();
      };
      for (const [fromU, fromV, toU, toV] of [
        [0, 16, 16, 48],
        [40, 16, 32, 48],
      ]) {
        copy(fromU + 4, fromV, 4, 4, toU + 4, toV); // верх
        copy(fromU + 8, fromV, 4, 4, toU + 8, toV); // низ
        copy(fromU + 8, fromV + 4, 4, 12, toU, toV + 4); // бока меняются местами
        copy(fromU + 4, fromV + 4, 4, 12, toU + 4, toV + 4); // перед
        copy(fromU, fromV + 4, 4, 12, toU + 8, toV + 4);
        copy(fromU + 12, fromV + 4, 4, 12, toU + 12, toV + 4); // спина
      }
    }
    return c;
  }

  // Голова для аватарки: лицо + второй слой, увеличенные без размытия
  async function headDataUrl(src) {
    const img = await loadImage(src);
    const c = newCanvas(64, 64);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
    return c.toDataURL();
  }

  /* ---------- пресеты (нарисованы кодом, без чужих текстур) ---------- */
  function paintBox(ctx, model, boxName, color) {
    for (const f of faces(model).filter((f) => f.box === boxName)) {
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const c = typeof color === 'function' ? color(f, x, y) : color;
          if (!c) continue;
          ctx.fillStyle = c;
          ctx.fillRect(f.x + x, f.y + y, 1, 1);
        }
      }
    }
  }
  const px = (ctx, x, y, c) => ((ctx.fillStyle = c), ctx.fillRect(x, y, 1, 1));

  function presetFemboy(model) {
    const c = newCanvas();
    const ctx = c.getContext('2d');
    const skin = '#f7d9c8';
    const hair = '#ff8fc7';
    const hoodie = '#ffc2df';
    const hoodieDark = '#ff9ccb';
    const sock = (f, x, y) => (y >= 11 ? '#ff5fa8' : y >= 4 ? (y % 2 ? '#ffffff' : '#ff8fc7') : null);
    paintBox(ctx, model, 'Голова', (f, x, y) => (f.side === 'top' || f.side === 'back' ? hair : (f.side === 'left' || f.side === 'right') && y < 5 ? hair : skin));
    // лицо: чёлка, глаза, румянец, улыбка
    for (let x = 8; x < 16; x++) px(ctx, x, 8, hair), px(ctx, x, 9, x % 3 ? hair : skin);
    [[9, 12, '#ffffff'], [10, 12, '#5b3760'], [13, 12, '#5b3760'], [14, 12, '#ffffff'], [9, 13, '#5b3760'], [10, 13, '#5b3760'], [13, 13, '#5b3760'], [14, 13, '#5b3760']].forEach(([x, y, col]) => px(ctx, x, y, col));
    [[9, 14], [14, 14]].forEach(([x, y]) => px(ctx, x, y, '#ff9cc4'));
    px(ctx, 11, 14, '#e2729c'), px(ctx, 12, 14, '#e2729c');
    paintBox(ctx, model, 'Тело', (f, x, y) => (f.side === 'front' && y >= 7 && y <= 9 && x >= 1 && x <= 6 ? hoodieDark : hoodie));
    for (const arm of ['Правая рука', 'Левая рука']) paintBox(ctx, model, arm, (f, x, y) => (y >= 10 ? skin : y >= 8 ? hoodieDark : hoodie));
    for (const leg of ['Правая нога', 'Левая нога']) paintBox(ctx, model, leg, (f, x, y) => (y < 3 ? '#3a2a41' : sock(f, x, y) || skin));
    // юбка в складку на втором слое
    for (const leg of ['Правая штанина', 'Левая штанина']) paintBox(ctx, model, leg, (f, x, y) => (y < 3 ? (x % 2 ? '#4a3553' : '#3a2a41') : null));
    // ушки-бантик из второго слоя головы
    paintBox(ctx, model, 'Шапка', (f, x, y) => (f.side === 'front' && y === 0 && (x === 1 || x === 6) ? '#ff5fa8' : f.side === 'top' && (x === 1 || x === 6) && y < 2 ? '#ff5fa8' : null));
    return c;
  }

  function presetBoykisser(model) {
    const c = newCanvas();
    const ctx = c.getContext('2d');
    const fur = '#ffffff';
    const shade = '#ece7ef';
    const ink = '#231a29';
    for (const box of ['Голова', 'Тело', 'Правая рука', 'Левая рука', 'Правая нога', 'Левая нога']) {
      paintBox(ctx, model, box, (f, x, y) => (f.side === 'bottom' || f.side === 'back' ? shade : fur));
    }
    // полуприкрытые глаза, «:3» и красные штрихи румянца
    for (let x = 9; x <= 10; x++) px(ctx, x, 12, ink), px(ctx, x, 13, ink);
    for (let x = 13; x <= 14; x++) px(ctx, x, 12, ink), px(ctx, x, 13, ink);
    px(ctx, 8, 11, ink), px(ctx, 15, 11, ink);
    px(ctx, 9, 15, '#e5304d'), px(ctx, 14, 15, '#e5304d');
    px(ctx, 11, 15, ink), px(ctx, 12, 15, ink);
    // пушок на груди
    [[21, 20], [22, 21], [23, 20], [24, 21], [25, 20]].forEach(([x, y]) => px(ctx, x, y, shade));
    // кончики ушей на втором слое головы
    paintBox(ctx, model, 'Шапка', (f, x, y) => (f.side === 'front' && y === 0 && (x === 0 || x === 7) ? fur : null));
    return c;
  }

  function presetBlank(model) {
    const c = newCanvas();
    const ctx = c.getContext('2d');
    for (const box of ['Голова', 'Тело', 'Правая рука', 'Левая рука', 'Правая нога', 'Левая нога']) paintBox(ctx, model, box, '#d9d0de');
    return c;
  }

  const PRESETS = [
    { id: 'femboy', name: 'Фембой', make: presetFemboy, model: 'slim' },
    { id: 'boykisser', name: 'Бойкиссер', make: presetBoykisser, model: 'classic' },
    { id: 'blank', name: 'Чистый лист', make: presetBlank, model: 'classic' },
  ];

  /* ---------- 3D-превью ---------- */
  function createViewer(canvas, width, height) {
    if (!window.skinview3d) return null;
    const viewer = new skinview3d.SkinViewer({ canvas, width, height });
    viewer.background = null;
    viewer.zoom = 0.82;
    viewer.fov = 50;
    viewer.controls.enableZoom = false;
    viewer.animation = new skinview3d.IdleAnimation();
    return viewer;
  }

  function showSkin(viewer, src, model) {
    if (!viewer) return;
    viewer.loadSkin(src, { model: model === 'slim' ? 'slim' : 'default' });
  }

  /* ---------- редактор ---------- */
  const PALETTE = [
    '#ffffff', '#d9d0de', '#8c7b93', '#3a2a41', '#231a29', '#000000',
    '#f7d9c8', '#e8b89c', '#c98c6a', '#8a5a3c', '#5a3a28', '#2e1d14',
    '#ff5fa8', '#ff8fc7', '#ffc2df', '#e5304d', '#ff9cc4', '#c13584',
    '#9d7bff', '#c9b6ff', '#3fa9f5', '#8ec9ff', '#26c08e', '#ffd978',
  ];

  function openEditor({ src, model = 'classic', title, openModal, closeModal, onSave, fromName, toast }) {
    const box = openModal(`
      <div class="sk-head"><h2>${title || 'Редактор скина'} 🎨</h2>
        <div class="row">
          <select id="skPreset"><option value="">Пресет…</option>${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
          <button class="btn ghost sm" id="skUpload">Загрузить PNG</button>
          <form class="sk-byname" id="skByNameForm"><input id="skName" placeholder="Скин по нику…" maxlength="16" spellcheck="false"><button class="btn ghost sm" type="submit">Взять</button></form>
          <button class="btn ghost sm" id="skExport" title="Сохранить PNG на компьютер">⬇ PNG</button>
        </div>
      </div>
      <div class="sk-body">
        <div class="sk-left">
          <div class="sk-tools">
            <div class="seg small" id="skTool">
              <button data-v="pencil" title="Карандаш (B)">✏️</button>
              <button data-v="eraser" title="Ластик (E, правая кнопка мыши)">🧽</button>
              <button data-v="fill" title="Заливка грани (G)">🪣</button>
              <button data-v="picker" title="Пипетка (I)">💧</button>
            </div>
            <div class="seg small" id="skLayer">
              <button data-v="both" title="Рисовать на обоих слоях">Оба слоя</button>
              <button data-v="0" title="Только основной слой">Основной</button>
              <button data-v="1" title="Только второй слой (шапка, куртка…)">Второй</button>
            </div>
            <button class="btn ghost sm" id="skUndo" title="Отменить (Ctrl+Z)">↶</button>
            <button class="btn ghost sm" id="skRedo" title="Повторить (Ctrl+Y)">↷</button>
            <label class="check"><input type="checkbox" id="skGrid" checked> сетка</label>
          </div>
          <div class="sk-canvas-wrap"><canvas id="skCanvas" width="${SIZE * ZOOM}" height="${SIZE * ZOOM}"></canvas></div>
          <div class="sk-hint" id="skHint">Наведи на текстуру — подскажу, что за часть тела ♡</div>
        </div>
        <div class="sk-right">
          <canvas id="skView" class="sk-view"></canvas>
          <div class="seg small" id="skModel"><button data-v="classic">Classic</button><button data-v="slim">Slim (тонкие руки)</button></div>
          <div class="sk-colors">
            <input type="color" id="skColor" value="#ff5fa8">
            <div class="sk-palette" id="skPalette">${PALETTE.map((c) => `<button data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
          </div>
          <div class="modal-actions">
            <button class="btn ghost" id="skCancel">Отмена</button>
            <button class="btn primary" id="skSave">Сохранить скин ♡</button>
          </div>
        </div>
      </div>
      <input type="file" id="skFile" accept="image/png" hidden>`);
    box.classList.add('wide');

    const tex = newCanvas();
    const tctx = tex.getContext('2d', { willReadFrequently: true });
    const view = box.querySelector('#skCanvas');
    const vctx = view.getContext('2d');
    const st = { tool: 'pencil', layer: 'both', color: '#ff5fa8', model, grid: true, hover: null, drawing: false, last: null, dirty: false };
    let faceList = faces(st.model);
    const undo = [];
    const redo = [];

    const viewer = createViewer(box.querySelector('#skView'), 240, 300);
    const unwatch = Calm.watch((asleep) => viewer && (viewer.renderPaused = asleep)); // пока лаунчер спит, 3D-превью не крутится
    let pending3d = false;
    const update3d = () => {
      if (pending3d) return;
      pending3d = true;
      requestAnimationFrame(() => {
        pending3d = false;
        showSkin(viewer, tex, st.model);
      });
    };

    // шахматка под прозрачными пикселями
    const checker = newCanvas(SIZE * ZOOM, SIZE * ZOOM);
    const cctx = checker.getContext('2d');
    for (let y = 0; y < SIZE * 2; y++) for (let x = 0; x < SIZE * 2; x++) ((cctx.fillStyle = (x + y) % 2 ? '#ece6ef' : '#f8f5f9'), cctx.fillRect(x * 4, y * 4, 4, 4));

    function render() {
      vctx.imageSmoothingEnabled = false;
      vctx.clearRect(0, 0, view.width, view.height);
      vctx.drawImage(checker, 0, 0);
      // неиспользуемые области текстуры затемняем
      vctx.fillStyle = 'rgba(58, 42, 65, 0.5)';
      vctx.fillRect(0, 0, view.width, view.height);
      for (const f of faceList) {
        const off = st.layer !== 'both' && String(f.layer) !== st.layer;
        vctx.drawImage(checker, f.x * ZOOM, f.y * ZOOM, f.w * ZOOM, f.h * ZOOM, f.x * ZOOM, f.y * ZOOM, f.w * ZOOM, f.h * ZOOM);
        if (off) ((vctx.fillStyle = 'rgba(58, 42, 65, 0.35)'), vctx.fillRect(f.x * ZOOM, f.y * ZOOM, f.w * ZOOM, f.h * ZOOM));
      }
      vctx.drawImage(tex, 0, 0, view.width, view.height);
      if (st.grid) {
        vctx.strokeStyle = 'rgba(120, 90, 130, 0.18)';
        vctx.lineWidth = 1;
        vctx.beginPath();
        for (let i = 0; i <= SIZE; i++) {
          vctx.moveTo(i * ZOOM + 0.5, 0), vctx.lineTo(i * ZOOM + 0.5, view.height);
          vctx.moveTo(0, i * ZOOM + 0.5), vctx.lineTo(view.width, i * ZOOM + 0.5);
        }
        vctx.stroke();
      }
      vctx.strokeStyle = 'rgba(255, 95, 168, 0.55)';
      for (const f of faceList) vctx.strokeRect(f.x * ZOOM + 0.5, f.y * ZOOM + 0.5, f.w * ZOOM - 1, f.h * ZOOM - 1);
      if (st.hover) {
        const f = st.hover.face;
        if (f) ((vctx.strokeStyle = '#ff5fa8'), (vctx.lineWidth = 2), vctx.strokeRect(f.x * ZOOM + 1, f.y * ZOOM + 1, f.w * ZOOM - 2, f.h * ZOOM - 2));
        vctx.lineWidth = 2;
        vctx.strokeStyle = '#231a29';
        vctx.strokeRect(st.hover.x * ZOOM + 1, st.hover.y * ZOOM + 1, ZOOM - 2, ZOOM - 2);
      }
    }

    const changed = () => {
      st.dirty = true;
      render();
      update3d();
    };
    const snapshot = () => {
      undo.push(tctx.getImageData(0, 0, SIZE, SIZE));
      if (undo.length > 60) undo.shift();
      redo.length = 0;
    };
    const canPaint = (f) => f && (st.layer === 'both' || String(f.layer) === st.layer);

    function setPixel(x, y, erase) {
      const f = faceAt(faceList, x, y);
      if (!canPaint(f)) return;
      if (erase) tctx.clearRect(x, y, 1, 1);
      else ((tctx.fillStyle = st.color), tctx.fillRect(x, y, 1, 1));
    }

    function line(x0, y0, x1, y1, erase) {
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        setPixel(x0, y0, erase);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) ((err += dy), (x0 += sx));
        if (e2 <= dx) ((err += dx), (y0 += sy));
      }
    }

    // Заливка не выходит за пределы грани, чтобы не протекать на соседние части тела
    function fill(x, y) {
      const f = faceAt(faceList, x, y);
      if (!canPaint(f)) return;
      const img = tctx.getImageData(0, 0, SIZE, SIZE);
      const d = img.data;
      const at = (px, py) => (py * SIZE + px) * 4;
      const target = d.slice(at(x, y), at(x, y) + 4).join();
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(st.color.slice(i, i + 2), 16));
      if (target === [r, g, b, 255].join()) return;
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < f.x || cy < f.y || cx >= f.x + f.w || cy >= f.y + f.h) continue;
        const i = at(cx, cy);
        if (d.slice(i, i + 4).join() !== target) continue;
        d.set([r, g, b, 255], i);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      tctx.putImageData(img, 0, 0);
    }

    function pick(x, y) {
      const [r, g, b, a] = tctx.getImageData(x, y, 1, 1).data;
      if (!a) return;
      setColor('#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
      setTool('pencil');
    }

    const cell = (e) => {
      const r = view.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE);
      const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
      return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null;
    };

    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('mousedown', (e) => {
      const c = cell(e);
      if (!c) return;
      const erase = e.button === 2 || st.tool === 'eraser';
      if (st.tool === 'picker' && e.button === 0) return pick(c.x, c.y);
      snapshot();
      if (st.tool === 'fill' && e.button === 0) {
        fill(c.x, c.y);
        return changed();
      }
      st.drawing = { erase };
      st.last = c;
      setPixel(c.x, c.y, erase);
      changed();
    });
    view.addEventListener('mousemove', (e) => {
      const c = cell(e);
      st.hover = c && { ...c, face: faceAt(faceList, c.x, c.y) };
      const f = st.hover?.face;
      box.querySelector('#skHint').textContent = f
        ? `${f.box} — ${SIDES[f.side]} · ${f.layer ? 'второй слой' : 'основной слой'} · ${c.x}, ${c.y}`
        : c ? 'Эта область игрой не используется' : '';
      if (st.drawing && c) {
        line(st.last.x, st.last.y, c.x, c.y, st.drawing.erase);
        st.last = c;
        changed();
      } else render();
    });
    const stop = () => (st.drawing = false);
    window.addEventListener('mouseup', stop);
    view.addEventListener('mouseleave', () => ((st.hover = null), render()));

    function setTool(t) {
      st.tool = t;
      box.querySelectorAll('#skTool button').forEach((b) => b.classList.toggle('on', b.dataset.v === t));
      view.dataset.tool = t;
    }
    function setColor(c) {
      st.color = c;
      box.querySelector('#skColor').value = c;
      box.querySelectorAll('#skPalette button').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
    }
    function setLayer(l) {
      st.layer = l;
      box.querySelectorAll('#skLayer button').forEach((b) => b.classList.toggle('on', b.dataset.v === l));
      render();
    }
    function setModel(m) {
      st.model = m;
      faceList = faces(m);
      box.querySelectorAll('#skModel button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
      render();
      update3d();
    }
    function doUndo(from, to) {
      if (!from.length) return;
      to.push(tctx.getImageData(0, 0, SIZE, SIZE));
      tctx.putImageData(from.pop(), 0, 0);
      changed();
    }
    async function load(srcOrCanvas, m) {
      const c = typeof srcOrCanvas === 'string' ? await toCanvas(srcOrCanvas) : srcOrCanvas;
      snapshot();
      tctx.clearRect(0, 0, SIZE, SIZE);
      tctx.drawImage(c, 0, 0);
      if (m) setModel(m);
      changed();
    }

    box.querySelector('#skTool').onclick = (e) => e.target.dataset.v && setTool(e.target.dataset.v);
    box.querySelector('#skLayer').onclick = (e) => e.target.dataset.v && setLayer(e.target.dataset.v);
    box.querySelector('#skModel').onclick = (e) => e.target.dataset.v && setModel(e.target.dataset.v);
    box.querySelector('#skPalette').onclick = (e) => e.target.dataset.c && (setColor(e.target.dataset.c), st.tool === 'eraser' && setTool('pencil'));
    box.querySelector('#skColor').oninput = (e) => setColor(e.target.value);
    box.querySelector('#skGrid').onchange = (e) => ((st.grid = e.target.checked), render());
    box.querySelector('#skUndo').onclick = () => doUndo(undo, redo);
    box.querySelector('#skRedo').onclick = () => doUndo(redo, undo);
    box.querySelector('#skPreset').onchange = (e) => {
      const p = PRESETS.find((x) => x.id === e.target.value);
      e.target.value = '';
      if (p) load(p.make(p.model), p.model);
    };
    box.querySelector('#skUpload').onclick = () => box.querySelector('#skFile').click();
    box.querySelector('#skFile').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => load(reader.result).catch((err) => toast(err.message, 'err'));
      reader.readAsDataURL(file);
      e.target.value = '';
    };
    box.querySelector('#skByNameForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = box.querySelector('#skName').value.trim();
      if (!name) return;
      try {
        const r = await fromName(name);
        await load(r.data, r.model);
        toast(`Скин «${name}» загружен с ${r.source} ✧`);
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    box.querySelector('#skExport').onclick = () => {
      const a = document.createElement('a');
      a.href = tex.toDataURL('image/png');
      a.download = 'skin.png';
      a.click();
    };
    box.querySelector('#skCancel').onclick = () => (!st.dirty || confirm('Выйти без сохранения?')) && close();
    box.querySelector('#skSave').onclick = async () => {
      try {
        await onSave(tex.toDataURL('image/png'), st.model);
        st.dirty = false;
        close();
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && (k === 'z' || k === 'я')) (e.preventDefault(), e.shiftKey ? doUndo(redo, undo) : doUndo(undo, redo));
      else if (e.ctrlKey && (k === 'y' || k === 'н')) (e.preventDefault(), doUndo(redo, undo));
      else if (!e.ctrlKey) {
        const map = { b: 'pencil', и: 'pencil', e: 'eraser', у: 'eraser', g: 'fill', п: 'fill', i: 'picker', ш: 'picker' };
        if (map[k]) setTool(map[k]);
      }
    };
    document.addEventListener('keydown', onKey);
    function close() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', stop);
      unwatch();
      viewer?.dispose();
      closeModal();
    }
    box.isDirty = () => st.dirty;
    box.dispose = () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', stop);
      unwatch();
      viewer?.dispose();
    };

    setTool('pencil');
    setColor(st.color);
    setLayer('both');
    setModel(model);
    const p = PRESETS[0];
    (src ? load(src, model) : load(p.make(p.model), p.model)).then(() => {
      undo.length = 0;
      st.dirty = false;
    }).catch((err) => toast(err.message, 'err'));
  }

  window.Skins = { createViewer, showSkin, openEditor, headDataUrl, PRESETS };
})();
