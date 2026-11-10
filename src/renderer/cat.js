// Бойкиссер — белый контурный котик: вихор, хитрые полуприкрытые глаза, «:3» и красные штрихи румянца.
// data-cat="head" — только голова (для заголовка окна), без значения — по пояс.
function boykisser(crop) {
  const viewBox = crop === 'head' ? '22 8 166 172' : '0 0 206 236';
  return `
<svg class="cat" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="cat-body">
    <path class="ln" fill="#fff" d="M 72 160 C 70 178 68 190 67 198 L 82 203 L 67 210 C 65 222 64 232 63 244 L 147 244 C 146 214 143 188 138 160 Z"/>
  </g>
  <g class="cat-head">
    <path class="ln" fill="#fff" d="
      M 58 114 C 50 86 40 54 36 18
      C 58 28 78 42 90 56
      C 92 40 108 28 130 31
      C 119 36 114 44 117 55
      C 134 42 152 28 172 18
      C 168 54 160 86 152 112
      C 156 120 160 128 162 134 L 178 138 L 162 146 L 174 154 L 152 158
      C 136 172 72 172 56 160
      L 32 158 L 46 150 L 30 140 L 48 136
      C 50 128 54 120 58 114 Z"/>
    <path class="ln thin" d="M 46 36 C 52 56 56 74 62 90 M 162 36 C 156 56 152 74 146 90"/>
    <g class="cat-eyes">
      <path d="M 75 106 L 94 106 C 95 118 91 127 84.5 127 C 78 127 74 118 75 106 Z" fill="#231a29"/>
      <path d="M 114 106 L 133 106 C 134 118 130 127 123.5 127 C 117 127 113 118 114 106 Z" fill="#231a29"/>
    </g>
    <path class="ln" d="M 72 106 L 97 105 M 111 105 L 136 106"/>
    <path class="ln" d="M 102 132 L 106 132 M 94 135 C 96 141 102 141 104 135 C 106 141 112 141 114 135"/>
    <g class="acc acc-hat">
      <path class="ln" fill="#c9b6ff" d="M 66 70 C 66 34 142 34 142 70 Z"/>
      <path class="ln" fill="#ffb1d0" d="M 62 64 Q 104 54 146 64 L 146 74 Q 104 64 62 74 Z"/>
      <circle class="ln" fill="#ffb1d0" cx="104" cy="32" r="8"/>
    </g>
    <g class="acc acc-phones">
      <path d="M 44 96 C 36 26 172 26 164 96" fill="none" stroke="#231a29" stroke-width="9" stroke-linecap="round"/>
      <path d="M 44 96 C 36 26 172 26 164 96" fill="none" stroke="#c9b6ff" stroke-width="4" stroke-linecap="round"/>
      <rect class="ln" fill="#ff8fc7" x="30" y="84" width="20" height="32" rx="9"/>
      <rect class="ln" fill="#ff8fc7" x="158" y="84" width="20" height="32" rx="9"/>
    </g>
    <g class="acc acc-halloween">
      <path class="ln" fill="#4b2a6b" d="M 66 64 L 116 4 Q 120 2 121 7 L 142 64 Z"/>
      <path class="ln" fill="#ff9a3c" d="M 76 52 L 136 52 L 139 62 L 72 62 Z"/>
      <ellipse class="ln" fill="#4b2a6b" cx="104" cy="66" rx="56" ry="9"/>
      <path fill="#ffd978" d="M 104 34 l 2.5 5 5.5 0.8 -4 3.9 0.9 5.5 -4.9 -2.6 -4.9 2.6 0.9 -5.5 -4 -3.9 5.5 -0.8 z"/>
    </g>
    <g class="acc acc-winter">
      <path class="ln" fill="#8ec9ff" d="M 74 151 Q 104 163 134 151 L 134 163 Q 104 177 74 163 Z"/>
      <path class="ln" fill="#8ec9ff" d="M 118 164 L 135 160 L 141 185 L 123 189 Z"/>
      <path fill="none" stroke="#fff" stroke-width="3" d="M 123 174 L 137 170 M 125 182 L 139 178"/>
    </g>
    <g class="acc acc-newyear">
      <path class="ln" fill="#e5304d" d="M 68 64 C 72 30 122 18 156 40 C 166 47 166 58 160 62 C 140 52 118 48 68 64 Z"/>
      <ellipse class="ln" fill="#fff" cx="108" cy="64" rx="46" ry="9"/>
      <circle class="ln" fill="#fff" cx="162" cy="60" r="9"/>
    </g>
    <g class="acc acc-bow">
      <path class="ln" fill="#ff5fa8" d="M 148 56 C 136 44 122 48 125 59 C 127 68 140 66 148 56 Z"/>
      <path class="ln" fill="#ff5fa8" d="M 148 56 C 160 44 174 48 171 59 C 169 68 156 66 148 56 Z"/>
      <circle class="ln" fill="#ff8fc7" cx="148" cy="56" r="4.5"/>
    </g>
    <g class="acc acc-glasses">
      ${[84.5, 123.5].map((x) => `<path class="ln" fill="rgba(255,95,168,0.5)" d="M ${x} 126 C ${x - 17} 115 ${x - 16} 101 ${x - 8} 101 C ${x - 4} 101 ${x} 104 ${x} 107 C ${x} 104 ${x + 4} 101 ${x + 8} 101 C ${x + 16} 101 ${x + 17} 115 ${x} 126 Z"/>`).join('')}
      <path class="ln" d="M 96 108 Q 104 103 112 108 M 70 108 L 54 103 M 138 108 L 154 103"/>
    </g>
    <g class="acc acc-crown">
      <path class="ln" fill="#ffd978" d="M 76 68 L 73 38 L 90 53 L 104 30 L 118 53 L 135 38 L 132 68 Z"/>
      <circle class="ln" fill="#ff5fa8" cx="104" cy="56" r="4.5"/>
      <circle class="ln thin" fill="#8ec9ff" cx="87" cy="61" r="3"/>
      <circle class="ln thin" fill="#c9b6ff" cx="121" cy="61" r="3"/>
    </g>
    <g class="acc acc-flower">
      ${[[64, 76, '#ffb1d0'], [80, 65, '#fff'], [97, 60, '#c9b6ff'], [113, 60, '#ffb1d0'], [130, 65, '#fff'], [145, 76, '#c9b6ff']]
        .map(([x, y, c]) => [0, 72, 144, 216, 288].map((a) => `<circle class="ln thin" fill="${c}" cx="${(x + 5.5 * Math.cos((a * Math.PI) / 180)).toFixed(1)}" cy="${(y + 5.5 * Math.sin((a * Math.PI) / 180)).toFixed(1)}" r="4"/>`).join('') + `<circle fill="#ffd978" cx="${x}" cy="${y}" r="3"/>`)
        .join('')}
    </g>
    <g class="acc acc-scarf">
      <path class="ln" fill="#8ec9ff" d="M 120 176 L 134 214 L 117 219 L 108 180 Z"/>
      <path class="ln" fill="#8ec9ff" d="M 60 160 C 82 178 126 178 148 158 L 152 171 C 128 192 80 192 56 173 Z"/>
      <path class="ln thin" d="M 78 172 L 82 183 M 100 176 L 101 187 M 124 174 L 122 185 M 122 196 L 132 193"/>
    </g>
    <g class="cat-blush">
      <path d="M 57 133 L 65 129 L 62 137 L 70 133" fill="none" stroke="#e5304d" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M 139 133 L 147 129 L 144 137 L 152 133" fill="none" stroke="#e5304d" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>
  <path class="cat-heart" d="M184 34 c-2.6 -5 -10 -3.6 -10 1.8 c0 4.6 10 10 10 10 s10 -5.4 10 -10 c0 -5.4 -7.4 -6.8 -10 -1.8 z" fill="#ff5fa8"/>
</svg>`;
}

function drawCats(el = document) {
  el.querySelectorAll('[data-cat]').forEach((c) => (c.innerHTML = boykisser(c.dataset.cat)));
}
drawCats();
