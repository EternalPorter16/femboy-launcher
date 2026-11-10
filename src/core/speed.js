// «Помощник по скорости»: смотрит на сборку, настройки и железо и подсказывает, что поправить, чтобы игра шла быстрее.
// Возвращает не готовые фразы, а данные (id + параметры): тексты и кнопки рисует интерфейс, чтобы их можно было перевести
const fs = require('fs');
const path = require('path');
const store = require('./store');
const instances = require('./instances');
const mods = require('./mods');
const hardware = require('./hardware');
const graphics = require('./graphics');
const gpu = require('./gpu');
const optimize = require('./optimize');

// Конфиги Iris (Fabric/NeoForge) и Oculus (Forge): включены ли шейдеры
const SHADER_CONFIGS = ['iris.properties', 'oculus.properties'];
function shaderConfig(instId) {
  for (const f of SHADER_CONFIGS) {
    const p = path.join(instances.gameDir(instId), 'config', f);
    try {
      const t = fs.readFileSync(p, 'utf8');
      if (/^enableShaders\s*=\s*true/im.test(t) && /^shaderPack\s*=\s*\S+/im.test(t)) return p;
    } catch {}
  }
  return null;
}

async function check(instId, { battery = false } = {}) {
  const inst = instances.get(instId);
  const { settings } = store.get();
  const hw = await hardware.info();
  const modded = inst.loader !== 'vanilla';
  const max = inst.maxRam || settings.maxRam;
  const tips = [];
  const add = (id, params = {}) => tips.push({ id, ...params });

  // Ноутбук с двумя видеокартами: игра может идти на встроенной (на настольном ПК картинка обычно выводится через мощную)
  if (hw.hybrid && hw.laptop && !settings.gpuHigh) {
    const g = await gpu.state();
    if (!(g.paths && g.high === g.paths)) add('gpu', { integrated: hw.integratedGpu, discrete: hw.discreteGpu });
  }
  // Память: слишком мало для модов, или столько, что не хватит самой Windows (тогда подкачка и подвисания)
  if (modded && max < 3072 && hw.maxRam > max) add('ramLow', { max, rec: hw.maxRam });
  else if (max > hw.ramMb * 0.6 || (!modded && max > 6144)) add('ramHigh', { max, total: hw.ramMb, rec: hw.maxRam });
  // Моды для скорости
  if (modded) {
    const missing = optimize.coreMissing(instId);
    if (missing.length >= 3) add('optimize', { names: missing.slice(0, 3), more: Math.max(0, missing.length - 3) });
  }
  // Дальность прорисовки из настроек игры (если уже запускали)
  const g = graphics.state(instId);
  const rd = Number(g.current.renderDistance);
  if (g.exists && rd && ((hw.tier === 'weak' && rd > 12) || (hw.tier === 'mid' && rd > 20) || rd > 32)) add('distance', { rd, profile: hw.tier === 'weak' ? 'eco' : 'mid' });
  // Шейдеры на скромном компьютере
  if (hw.tier === 'weak' && shaderConfig(instId)) add('shaders');
  // Тяжёлые ресурспаки
  const packMb = Math.round(mods.list(instId, 'resourcepack').reduce((s, p) => s + (p.size || 0), 0) / 1048576);
  if (packMb > 250 && hw.tier !== 'strong') add('packs', { mb: packMb });
  // Ноутбук от батареи
  if (battery && hw.laptop) add('battery');
  return tips;
}

// Исправления, которые делаются без участия интерфейса (остальные — настройки и окна, их зовёт сам интерфейс)
function fix(instId, what) {
  if (what === 'shadersOff') {
    const p = shaderConfig(instId);
    if (!p) return false;
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^(enableShaders\s*=\s*)true/im, '$1false'));
    return true;
  }
  throw new Error('Не знаю такого исправления');
}

module.exports = { check, fix };
