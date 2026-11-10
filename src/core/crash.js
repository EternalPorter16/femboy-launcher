// Разбор вылетов: ищем в логе и crash-report понятную причину и что с ней делать
const fs = require('fs');
const path = require('path');

const FABRIC_API = { source: 'modrinth', id: 'P7dR8mSH', name: 'Fabric API' };

// [регулярка, функция → { reason, hints, fix? }]; первая сработавшая побеждает
const RULES = [
  [
    /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i,
    () => ({
      reason: 'Игре не хватило памяти.',
      hints: ['Увеличь память для этой сборки (✏️ на карточке) или в Настройках — для модпаков обычно нужно 4–8 ГБ.'],
      fix: { type: 'settings' },
    }),
  ],
  [
    /Could not reserve enough space|Invalid maximum heap size|Initial heap size set to a larger value/i,
    () => ({
      reason: 'Java не смогла выделить столько памяти.',
      hints: ['Уменьши память в настройках — указано больше, чем есть свободной ОЗУ.'],
      fix: { type: 'settings' },
    }),
  ],
  [
    /UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime|requires Java \d+/i,
    () => ({
      reason: 'Неподходящая версия Java.',
      hints: ['Очисти поле «Путь к java» в Настройках — лаунчер сам скачает правильную Java для этой версии игры.'],
      fix: { type: 'settings' },
    }),
  ],
  [
    /requires (?:any version|version [^ ]+|.*?) of (?:'?Fabric API'?|fabric-api|fabric)\b/i,
    (log) => ({
      reason: 'Модам нужен Fabric API, а его нет или он не той версии.',
      hints: modLines(log, /requires .*?(?:Fabric API|fabric-api)/i),
      fix: { type: 'install', mod: FABRIC_API },
    }),
  ],
  [
    /Incompatible mods? found|incompatible mod set|Mod resolution failed/i,
    (log) => ({
      reason: 'Набор модов несовместим (Fabric/Quilt).',
      hints: modLines(log, /^\s*-\s*(?:Mod|Replace|Remove|Install) .*|requires .* of /i).concat(['Обычно помогает обновить моды (вкладка «Моды» → «Проверить обновления») или убрать мод из списка выше.']),
    }),
  ],
  [
    /Missing or unsupported mandatory dependencies|Missing mods? dependencies|mandatory dependencies/i,
    (log) => ({
      reason: 'Каким-то модам не хватает других модов (Forge/NeoForge).',
      hints: modLines(log, /Mod ID: '.*?', Requested by: '.*?'|requires .* /i),
    }),
  ],
  [
    /DuplicateModsFoundException|Duplicate mods? found|Found duplicate mods|has been loaded multiple times/i,
    (log) => ({
      reason: 'Один и тот же мод установлен дважды.',
      hints: modLines(log, /duplicate|multiple times/i).concat(['Открой «Моды» → «Установленные» и удали лишнюю копию.']),
    }),
  ],
  [
    /Mixin apply (?:for mod (\S+) )?failed|MixinApplyError|InvalidInjectionException|InvalidMixinException/i,
    (log, m) => ({
      reason: `Конфликт модов${m?.[1] ? ` (виноват, скорее всего, «${m[1]}»)` : ''}.`,
      hints: ['Мод несовместим с этой версией игры или с другим модом. Попробуй обновить моды или выключить последний добавленный.'],
    }),
  ],
  [
    /Pixel format not accelerated|GLFW error 65542|WGL: The driver does not appear to support OpenGL|Couldn't set pixel format|No OpenGL context/i,
    () => ({
      reason: 'Проблема с видеокартой или её драйвером.',
      hints: ['Обнови драйвер видеокарты с сайта NVIDIA/AMD/Intel. На ноутбуке проверь, что игра запускается на дискретной видеокарте.'],
    }),
  ],
  [
    /EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected by the Java Runtime/i,
    () => ({
      reason: 'Java аварийно упала (ошибка драйвера или нативной библиотеки).',
      hints: ['Чаще всего виноват драйвер видеокарты или мод с нативным кодом. Обнови драйвер, попробуй без шейдеров.'],
    }),
  ],
  [
    /NoClassDefFoundError|ClassNotFoundException|NoSuchMethodError|NoSuchFieldError/i,
    () => ({
      reason: 'Мод несовместим с этой версией игры или загрузчика.',
      hints: ['Проверь, что все моды подходят под версию сборки, и обнови их.'],
    }),
  ],
];

// Строки лога, где упоминаются моды — коротко, без дублей
function modLines(log, re) {
  const seen = new Set();
  return log
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[[^\]]*\]\s*(\[[^\]]*\]\s*)*:?\s*/, '').trim())
    .filter((l) => re.test(l) && !seen.has(l) && seen.add(l))
    .slice(0, 6);
}

function newestFile(dir, filter, since) {
  try {
    return fs
      .readdirSync(dir)
      .filter(filter)
      .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= since - 2000)
      .sort((a, b) => b.t - a.t)[0]?.f;
  } catch {
    return null;
  }
}

function analyze({ gameDir, startedAt, logTail, code }) {
  const report =
    newestFile(path.join(gameDir, 'crash-reports'), (f) => f.endsWith('.txt'), startedAt) ||
    newestFile(gameDir, (f) => /^hs_err_pid\d+\.log$/.test(f), startedAt);
  let text = logTail.join('\n');
  if (report) {
    try {
      text += '\n' + fs.readFileSync(report, 'utf8').slice(0, 200000);
    } catch {}
  }
  for (const [re, make] of RULES) {
    const m = re.exec(text);
    if (m) return { code, report, ...make(text, m) };
  }
  // 0xC0000005 без отчёта Java: падение в нативном коде (драйвер, оверлей, нативная библиотека)
  if (code === 3221225477 || code === -1073741819) {
    return {
      code,
      report,
      reason: 'Игра аварийно упала в нативном коде (ошибка доступа к памяти).',
      hints: [
        'Обнови драйвер видеокарты.',
        'Выключи оверлеи, которые встраиваются в игры: Discord, MSI Afterburner / RivaTuner, OBS, GeForce Experience.',
        'Если ставил свою Java в настройках — очисти поле, лаунчер скачает подходящую сам.',
      ],
    };
  }
  return {
    code,
    report,
    reason: `Игра закрылась с ошибкой (код ${code}).`,
    hints: [report ? 'Подробности — в отчёте о вылете.' : 'Подробности — во вкладке «Консоль».', 'Если недавно ставил моды, попробуй выключить последние добавленные.'],
  };
}

module.exports = { analyze };
