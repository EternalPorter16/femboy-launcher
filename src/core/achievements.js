// Достижения котика: считаются по сборкам и счётчикам событий (store.stats).
// Открытое достижение запоминается навсегда — даже если потом удалить сборку. Некоторые дарят котику наряд.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const instances = require('./instances');

const H = 3600 * 1000;

// reward — аксессуар котика (см. acc-* в cat.js), который открывается вместе с достижением
const LIST = [
  { id: 'first', icon: '🎮', title: 'Первая катка', desc: 'Запусти игру', need: (c) => [c.stats.launches || 0, 1] },
  { id: 'hour', icon: '⏰', title: 'Час в кубах', desc: 'Наиграй 1 час', need: (c) => [c.hours, 1] },
  { id: 'ten', icon: '🕶️', title: 'Залипательно', desc: 'Наиграй 10 часов', need: (c) => [c.hours, 10], reward: 'glasses' },
  { id: 'fifty', icon: '👑', title: 'Королевский стаж', desc: 'Наиграй 50 часов', need: (c) => [c.hours, 50], reward: 'crown' },
  { id: 'modpack', icon: '📦', title: 'Модпакер', desc: 'Поставь модпак с Modrinth или CurseForge', need: (c) => [c.packs, 1], reward: 'flower' },
  { id: 'collector', icon: '🗂️', title: 'Коллекционер', desc: 'Собери 5 сборок', need: (c) => [c.instances, 5], reward: 'scarf' },
  { id: 'modder', icon: '🧩', title: 'Мододел', desc: 'Поставь 50 модов (во всех сборках вместе)', need: (c) => [c.mods, 50] },
  { id: 'night', icon: '🌙', title: 'Ночная смена', desc: 'Запусти игру между полуночью и пятью утра', need: (c) => [c.stats.nightLaunches || 0, 1] },
  { id: 'friend', icon: '💞', title: 'Вместе веселее', desc: 'Открой мир другу кнопкой «Играть с другом»', need: (c) => [c.stats.friendShares || 0, 1] },
  { id: 'saver', icon: '💾', title: 'Запасливый', desc: 'Сохрани копию мира', need: (c) => [c.stats.backups || 0, 1] },
  { id: 'mover', icon: '🧳', title: 'Переезд', desc: 'Перенеси что-нибудь из другого лаунчера', need: (c) => [Math.max(c.stats.imports || 0, c.imported), 1] },
  { id: 'sharer', icon: '💌', title: 'Делись с друзьями', desc: 'Поделись сборкой', need: (c) => [c.stats.shares || 0, 1] },
];

const REWARD_NAMES = { glasses: 'Сердечные очки', crown: 'Корона', flower: 'Цветочный венок', scarf: 'Шарфик' };

function context() {
  const insts = instances.list();
  let mods = 0;
  for (const i of insts) {
    try {
      mods += fs.readdirSync(path.join(instances.gameDir(i.id), 'mods')).filter((f) => /\.jar(\.disabled)?$/.test(f)).length;
    } catch {}
  }
  return {
    stats: store.get().stats || {},
    hours: insts.reduce((s, i) => s + (i.playtime || 0), 0) / H,
    instances: insts.length,
    packs: insts.filter((i) => i.pack?.projectId).length,
    imported: (store.get().imports || []).length ? 1 : 0,
    mods,
  };
}

// Список для интерфейса; заодно запоминаем только что открытые
function list() {
  const data = store.get();
  data.achievements = data.achievements || {};
  const c = context();
  let changed = false;
  const out = LIST.map((a) => {
    const [cur, max] = a.need(c);
    if (!data.achievements[a.id] && cur >= max) {
      data.achievements[a.id] = Date.now();
      changed = true;
    }
    const at = data.achievements[a.id] || null;
    return { id: a.id, icon: a.icon, title: a.title, desc: a.desc, reward: a.reward || null, rewardName: REWARD_NAMES[a.reward] || null, at, progress: at ? 1 : Math.min(1, cur / max), cur: Math.floor(Math.min(cur, max) * 10) / 10, max };
  });
  if (changed) store.save();
  return out;
}

// Наряды, которые уже открыты
const unlockedRewards = () => list().filter((a) => a.at && a.reward).map((a) => a.reward);

module.exports = { list, unlockedRewards, REWARD_NAMES };
