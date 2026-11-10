// Значки загрузчиков для Discord-активности: пастельный круг, белая эмблема с кошачьими ушками, сердечко и искорки.
// Всё помещается в круг — Discord обрезает маленькую картинку по кругу.
const EARS = (x1, x2, y, h = 44, w = 40) =>
  `<path d="M${x1 - w / 2} ${y} L${x1 - w / 4} ${y - h} Q${x1} ${y - h - 4} ${x1 + w / 2} ${y} Z M${x2 + w / 2} ${y} L${x2 + w / 4} ${y - h} Q${x2} ${y - h - 4} ${x2 - w / 2} ${y} Z" fill="#fff"/>
   <path d="M${x1 - w / 6} ${y - 4} L${x1 - w / 10} ${y - h * 0.62} L${x1 + w / 5} ${y - 4} Z M${x2 + w / 6} ${y - 4} L${x2 + w / 10} ${y - h * 0.62} L${x2 - w / 5} ${y - 4} Z" fill="#ffb3d4"/>`;

const HEART = (x, y, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s}) rotate(-12)"><path d="M0 18 C-30 -4 -22 -32 0 -16 C22 -32 30 -4 0 18 Z" fill="#ff5fa8" stroke="#fff" stroke-width="7" stroke-linejoin="round"/><ellipse cx="-9" cy="-12" rx="5" ry="3.5" fill="#fff" opacity=".8" transform="rotate(-30 -9 -12)"/></g>`;

const SPARK = (x, y, r, o = 1) => `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="#fff" opacity="${o}"/>`;

const PAW = (x, y, s, o) =>
  `<g transform="translate(${x} ${y}) scale(${s}) rotate(-18)" fill="#fff" opacity="${o}"><ellipse cx="0" cy="10" rx="16" ry="13"/><circle cx="-17" cy="-8" r="6.5"/><circle cx="-6" cy="-17" r="6.5"/><circle cx="7" cy="-17" r="6.5"/><circle cx="18" cy="-8" r="6.5"/></g>`;

// Где у каждого значка сердечко, чтобы не наезжало на эмблему
const HEART_AT = { fabric: [116, 300], forge: [404, 296], neoforge: [404, 296], quilt: [414, 330], vanilla: [110, 152] };

function badge(id, [c1, c2, deep], emblem) {
  const [hx, hy] = HEART_AT[id];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <radialGradient id="shine" cx=".32" cy=".25" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="${deep}" flood-opacity=".45"/></filter>
  </defs>
  <circle cx="256" cy="256" r="248" fill="url(#g)"/>
  <circle cx="256" cy="256" r="248" fill="url(#shine)"/>
  ${PAW(110, 395, 1.5, 0.16)}${PAW(408, 300, 1.1, 0.13)}${PAW(150, 120, 0.9, 0.12)}
  <circle cx="256" cy="256" r="232" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="9" stroke-dasharray="2 22" stroke-linecap="round"/>
  <g filter="url(#sh)">${emblem(deep)}</g>
  ${SPARK(392, 140, 26)}${SPARK(122, 232, 14, 0.85)}${SPARK(372, 402, 12, 0.8)}
  ${HEART(hx, hy, 1.1)}
</svg>`;
}

const BADGES = {
  // Fabric — катушка ниток с иголкой
  fabric: badge('fabric', ['#ffe0b8', '#ff9ec7', '#c0627e'], (d) => `
    ${EARS(196, 316, 158)}
    <rect x="160" y="150" width="192" height="40" rx="18" fill="#fff"/>
    <rect x="160" y="330" width="192" height="40" rx="18" fill="#fff"/>
    <rect x="192" y="186" width="128" height="148" rx="10" fill="#fff"/>
    <g stroke="${d}" stroke-opacity=".35" stroke-width="9" stroke-linecap="round">
      <path d="M200 214 L312 196"/><path d="M200 246 L312 228"/><path d="M200 278 L312 260"/><path d="M200 310 L312 292"/>
    </g>
    <path d="M312 300 C360 300 360 360 410 340" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    <path d="M392 352 L430 300" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
    <ellipse cx="428" cy="303" rx="4" ry="8" fill="${d}" opacity=".5" transform="rotate(36 428 303)"/>`),

  // Forge — наковальня
  forge: badge('forge', ['#b9a7e8', '#5b4a86', '#2a1f45'], (d) => `
    ${EARS(232, 340, 186, 46, 40)}
    <path d="M106 190 Q150 192 170 180 L404 180 L404 236 L350 236 Q306 252 302 290 L340 318 L340 350 L172 350 L172 318 L210 290 Q206 252 166 236 L146 236 Q114 224 106 190 Z" fill="#fff"/>
    <path d="M176 202 L390 202" stroke="${d}" stroke-opacity=".18" stroke-width="10" stroke-linecap="round"/>
    <circle cx="232" cy="214" r="7" fill="${d}" opacity=".35"/><circle cx="340" cy="214" r="7" fill="${d}" opacity=".35"/>
    <path d="M226 228 Q232 236 238 228 M334 228 Q340 236 346 228" stroke="${d}" stroke-opacity=".35" stroke-width="5" fill="none" stroke-linecap="round"/>`),

  // NeoForge — наковальня с искрой и ушками лисички
  neoforge: badge('neoforge', ['#ffc58a', '#ff6f91', '#b23d55'], (d) => `
    ${EARS(232, 340, 186, 54, 46)}
    <path d="M106 190 Q150 192 170 180 L404 180 L404 236 L350 236 Q306 252 302 290 L340 318 L340 350 L172 350 L172 318 L210 290 Q206 252 166 236 L146 236 Q114 224 106 190 Z" fill="#fff"/>
    <path d="M256 222 Q262 260 296 266 Q262 272 256 310 Q250 272 216 266 Q250 260 256 222 Z" fill="${d}" opacity=".55"/>
    <path d="M150 154 L134 128 M178 144 L176 112 M122 176 L94 166" stroke="#fff" stroke-width="9" stroke-linecap="round"/>`),

  // Quilt — лоскутки, один из них сердечко
  quilt: badge('quilt', ['#e6c8ff', '#9a6cf0', '#4e2c8f'], (d) => `
    ${EARS(198, 314, 156, 44, 40)}
    <g fill="#fff">
      <rect x="146" y="150" width="104" height="104" rx="22"/><rect x="262" y="150" width="104" height="104" rx="22"/>
      <rect x="146" y="266" width="104" height="104" rx="22"/>
    </g>
    <g fill="none" stroke="${d}" stroke-opacity=".4" stroke-width="6" stroke-dasharray="12 10" stroke-linecap="round">
      <rect x="162" y="166" width="72" height="72" rx="12"/><rect x="278" y="166" width="72" height="72" rx="12"/><rect x="162" y="282" width="72" height="72" rx="12"/>
    </g>
    <path d="M314 360 C258 322 262 270 314 296 C366 270 370 322 314 360 Z" fill="#fff"/>
    <path d="M314 342 C278 318 282 288 314 306 C346 288 350 318 314 342 Z" fill="none" stroke="${d}" stroke-opacity=".4" stroke-width="6" stroke-dasharray="10 9"/>`),

  // Ванилла — блок травы с ушками
  vanilla: badge('vanilla', ['#c8f5b4', '#59c39a', '#24704f'], (d) => `
    ${EARS(184, 328, 172, 46, 40)}
    <path d="M256 128 L388 196 L256 264 L124 196 Z" fill="#fff"/>
    <path d="M124 196 L256 264 L256 400 L124 332 Z" fill="#fff" opacity=".9"/>
    <path d="M388 196 L256 264 L256 400 L388 332 Z" fill="#fff" opacity=".78"/>
    <path d="M256 140 L372 198 L256 256 L140 198 Z" fill="#8fe07a"/>
    <path d="M124 196 L256 264 L388 196 L388 222 L356 238 L340 222 L310 252 L290 236 L256 264 L222 240 L200 254 L172 226 L150 240 L124 222 Z" fill="#8fe07a"/>
    <g fill="${d}" opacity=".22"><rect x="160" y="282" width="16" height="16"/><rect x="204" y="318" width="16" height="16"/><rect x="176" y="338" width="16" height="16"/><rect x="300" y="300" width="16" height="16"/><rect x="336" y="276" width="16" height="16"/><rect x="320" y="340" width="16" height="16"/></g>
    <g fill="#fff" opacity=".9"><rect x="220" y="178" width="16" height="16"/><rect x="284" y="196" width="16" height="16"/><rect x="250" y="160" width="12" height="12"/></g>`),
};

module.exports = BADGES;
