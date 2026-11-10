// Котик-бойкиссер из лаунчера (src/renderer/cat.js): тот же контур, глаза, «:3», румянец и сердечко,
// из аксессуаров только бантик (как на главном экране лаунчера). crop = 'head' — только голова.
export function catSvg(crop) {
  const viewBox = crop === 'head' ? '22 8 166 172' : '0 0 206 236';
  return `<svg class="cat" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <g class="cat-body"><path class="ln" fill="#fff" d="M 72 160 C 70 178 68 190 67 198 L 82 203 L 67 210 C 65 222 64 232 63 244 L 147 244 C 146 214 143 188 138 160 Z"/></g>
  <g class="cat-head">
    <path class="ln" fill="#fff" d="M 58 114 C 50 86 40 54 36 18 C 58 28 78 42 90 56 C 92 40 108 28 130 31 C 119 36 114 44 117 55 C 134 42 152 28 172 18 C 168 54 160 86 152 112 C 156 120 160 128 162 134 L 178 138 L 162 146 L 174 154 L 152 158 C 136 172 72 172 56 160 L 32 158 L 46 150 L 30 140 L 48 136 C 50 128 54 120 58 114 Z"/>
    <path class="ln thin" d="M 46 36 C 52 56 56 74 62 90 M 162 36 C 156 56 152 74 146 90"/>
    <g class="cat-eyes">
      <path d="M 75 106 L 94 106 C 95 118 91 127 84.5 127 C 78 127 74 118 75 106 Z" fill="#231a29"/>
      <path d="M 114 106 L 133 106 C 134 118 130 127 123.5 127 C 117 127 113 118 114 106 Z" fill="#231a29"/>
    </g>
    <path class="ln" d="M 72 106 L 97 105 M 111 105 L 136 106"/>
    <path class="ln" d="M 102 132 L 106 132 M 94 135 C 96 141 102 141 104 135 C 106 141 112 141 114 135"/>
    <g class="acc-bow">
      <path class="ln" fill="#ff5fa8" d="M 148 56 C 136 44 122 48 125 59 C 127 68 140 66 148 56 Z"/>
      <path class="ln" fill="#ff5fa8" d="M 148 56 C 160 44 174 48 171 59 C 169 68 156 66 148 56 Z"/>
      <circle class="ln" fill="#ff8fc7" cx="148" cy="56" r="4.5"/>
    </g>
    <g class="cat-blush">
      <path d="M 57 133 L 65 129 L 62 137 L 70 133" fill="none" stroke="#e5304d" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 139 133 L 147 129 L 144 137 L 152 133" fill="none" stroke="#e5304d" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>
  ${crop === 'head' ? '' : '<path class="cat-heart" d="M184 34 c-2.6 -5 -10 -3.6 -10 1.8 c0 4.6 10 10 10 10 s10 -5.4 10 -10 c0 -5.4 -7.4 -6.8 -10 -1.8 z" fill="#ff5fa8"/>'}
</svg>`;
}
