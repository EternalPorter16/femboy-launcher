// Достижения котика

/* ---------- достижения котика ---------- */
function renderAchievements() {
  const list = state.achievements || [];
  $('#achGrid').innerHTML = list
    .map(
      (a) => `
    <div class="ach ${a.at ? 'done' : ''}" title="${esc(a.desc)}">
      <span class="ach-ico">${a.at ? a.icon : '🔒'}</span>
      <div class="ach-text"><b>${esc(a.title)}</b><span>${esc(a.desc)}</span>
        ${a.at ? '' : `<i class="ach-bar"><i style="width:${Math.round(a.progress * 100)}%"></i></i>`}
        ${a.rewardName ? `<small class="ach-reward">🎁 ${esc(a.rewardName)}</small>` : ''}</div>
    </div>`
    )
    .join('');
  // Наряды за достижения: пока не открыты — недоступны
  const open = new Set(list.filter((a) => a.at && a.reward).map((a) => a.reward));
  $('#outfitCount').textContent = `${$$('#accSeg .oc').length - $$('#accSeg [data-reward]').length + open.size} из ${$$('#accSeg .oc').length} открыто`;
  $$('#accSeg [data-reward]').forEach((b) => {
    const a = list.find((x) => x.reward === b.dataset.v);
    b.disabled = !open.has(b.dataset.v);
    b.title = b.disabled && a ? `Открывается достижением «${a.title}»` : '';
  });
}

/* ---------- время в игре ---------- */
// Данные приходят от главного процесса (core/playlog.js): неделя по дням, сборки за 30 дней, всего, самая долгая игра
const fmtDur = (ms) => {
  const m = Math.round((ms || 0) / 60000);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
};
function renderPlayStats(s) {
  const body = $('#psBody');
  if (!body) return;
  const lang = I18N.lang === 'en' ? 'en-US' : 'ru-RU';
  $('#psSince').textContent = s.since ? `считаю с ${new Date(s.since).toLocaleDateString(lang, { day: 'numeric', month: 'long' })}` : '';
  if (!s.sessions) {
    body.innerHTML = '<p class="hint">Пока нет данных: статистика начнётся со следующей игры ♡</p>';
    return;
  }
  const max = Math.max(...s.week.map((d) => d.ms), 1);
  const days = s.week
    .map((d, i) => `<div class="ps-day ${i === s.week.length - 1 ? 'today' : ''}" title="${esc(fmtDur(d.ms))}"><i style="height:${Math.round((d.ms / max) * 100)}%"></i><span>${esc(new Date(d.at).toLocaleDateString(lang, { weekday: 'short' }))}</span></div>`)
    .join('');
  const top = s.byInstance.slice(0, 5);
  const topMax = top[0]?.ms || 1;
  const rows = top
    .map((x) => `<div class="ps-row"><span class="ps-name">${esc(x.name || 'Удалённая сборка')}</span><i class="ps-bar"><i style="width:${Math.max(3, Math.round((x.ms / topMax) * 100))}%"></i></i><b>${esc(fmtDur(x.ms))}</b></div>`)
    .join('');
  body.innerHTML = `
    <p class="ps-sum"><b>${esc(fmtDur(s.weekTotal))}</b> за неделю · всего <b>${esc(fmtDur(s.total))}</b> · самая долгая игра <b>${esc(fmtDur(s.longest))}</b></p>
    <div class="ps-week">${days}</div>
    ${top.length ? `<h4 class="ps-h">Сборки за 30 дней</h4><div class="ps-list">${rows}</div>` : ''}
    <div class="ps-actions"><button class="btn soft" data-act="recap" title="Картинка с итогами за неделю или месяц: можно сохранить или скопировать">🖼️ Итоги недели и месяца</button></div>`;
}
async function loadPlayStats() {
  try {
    renderPlayStats(await call('game:playStats'));
  } catch {}
}

// Только что открытые достижения — поздравляем (один раз)
function announceAchievements() {
  let seen;
  try {
    seen = JSON.parse(localStorage.getItem('achSeen') || 'null');
  } catch {
    return;
  }
  const done = (state.achievements || []).filter((a) => a.at);
  try {
    localStorage.setItem('achSeen', JSON.stringify(done.map((a) => a.id)));
  } catch {}
  if (!seen) return; // первый запуск этой версии: старое не объявляем
  const fresh = done.filter((a) => !seen.includes(a.id));
  for (const a of fresh) toast(`Достижение: ${a.icon} ${a.title}${a.rewardName ? ` — котику открыт наряд «${a.rewardName}»` : ''} ♡`);
  if (fresh.length) (say(fresh.some((a) => a.reward) ? 'у меня новый наряд! примеришь в настройках? 😳' : 'ура, достижение! ✨', 6000), hearts(10));
}
