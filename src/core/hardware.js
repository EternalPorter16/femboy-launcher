// Подбор настроек под компьютер: память, видеокарта, процессор → сколько памяти дать игре и какие шейдеры потянет
const os = require('os');
const { execFile } = require('child_process');

let cached = null;

// Названия видеокарт и тип корпуса (ноутбук или настольный) одним запуском PowerShell
function probe() {
  const script =
    '$g = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }); $c = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes); [pscustomobject]@{ gpus = $g; chassis = $c } | ConvertTo-Json -Compress';
  return new Promise((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, out) => {
      try {
        const j = JSON.parse(String(out));
        resolve({ gpus: [].concat(j.gpus || []).map((s) => String(s).trim()).filter(Boolean), chassis: [].concat(j.chassis || []).map(Number) });
      } catch {
        resolve({ gpus: [], chassis: [] });
      }
    })
  );
}

// Встроенная графика — Intel UHD/Iris, Radeon Vega и «Radeon(TM) Graphics» в процессорах AMD
const DISCRETE = /nvidia|geforce|quadro|\brtx\b|\bgtx\b|radeon\s+(rx|pro)|\barc\s+a\d/i;
const STRONG_GPU = /\brtx\b|radeon\s+rx\s*[6-9]\d{3}|\barc\s+a7/i;
// Типы корпуса по SMBIOS: портативный, ноутбук, «ноутбук» (Notebook), мини-ноутбук, планшет, трансформер, съёмный планшет
const PORTABLE = [8, 9, 10, 14, 30, 31, 32];

async function info() {
  if (cached) return cached;
  const ramMb = Math.round(os.totalmem() / 1048576);
  const { gpus, chassis } = await probe();
  const cards = gpus.filter((n) => !/basic display|remote|virtual|parsec|meta/i.test(n));
  const discreteCards = cards.filter((n) => DISCRETE.test(n));
  const integratedCards = cards.filter((n) => !DISCRETE.test(n));
  const discrete = discreteCards.length > 0;
  const strongGpu = cards.some((n) => STRONG_GPU.test(n));
  const cores = os.cpus().length;
  const tier = ramMb < 7500 || (!discrete && ramMb < 15000) || cores < 4 ? 'weak' : strongGpu && ramMb >= 15000 && cores >= 8 ? 'strong' : 'mid';
  const half = Math.floor(ramMb / 2 / 512) * 512;
  const maxRam = Math.max(2048, Math.min(half, { weak: 3072, mid: 4096, strong: ramMb >= 30000 ? 8192 : 6144 }[tier]));
  cached = {
    ramMb,
    cores,
    cpu: (os.cpus()[0]?.model || '').replace(/\s+/g, ' ').trim(),
    gpus: cards,
    // Две видеокарты сразу (встроенная и мощная): Windows сама решает, на какой запускать игру, и нередко ошибается
    hybrid: discrete && integratedCards.length > 0,
    laptop: chassis.some((c) => PORTABLE.includes(c)),
    discreteGpu: discreteCards[0] || '',
    integratedGpu: integratedCards[0] || '',
    tier,
    maxRam,
    // Шейдеры с Modrinth: на слабом ПК — никаких, на среднем — лёгкие, на мощном — красивые
    shader: { weak: null, mid: { slug: 'makeup-ultra-fast-shaders', name: 'MakeUp Ultra Fast' }, strong: { slug: 'complementary-reimagined', name: 'Complementary Reimagined' } }[tier],
  };
  return cached;
}

module.exports = { info };
