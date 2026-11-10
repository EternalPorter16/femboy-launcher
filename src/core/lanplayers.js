// Кто из друзей сейчас в мире. Сервер игры пишет в лог «<ник> joined the game» и «<ник> left the game» (в новых версиях с приставкой
// «System chat: », у Forge перед двоеточием ещё и название класса). Это строки сервера, по-английски на любом языке игры; слова игроков
// в чате выглядят иначе («<ник> текст»), а «[CHAT]» клиента переведён на язык игры и сюда не подходит. Только показ: ничего не меняет
const { START, STOP } = require('./lansession');

const NICK = '[A-Za-z0-9_]{3,16}';
const line = (what) => new RegExp(`\\[Server thread/INFO\\](?: \\[[^\\]]*\\])?: (?:System chat: )?(${NICK}) ${what} the game\\s*$`);
const JOIN = line('joined');
const LEAVE = line('left');

// Разбирает строки лога игры по одной. changed({ guests, joined?, left? }): гости (все, кроме хозяина мира) изменились; joined и left — кто именно
function watcher({ changed } = {}) {
  let host = null; // кто зашёл в мир первым — хозяин: он сам себе не гость, о его заходе и выходе не говорим
  const guests = [];
  const say = (e) => {
    try {
      changed?.(e);
    } catch {}
  };
  const reset = () => {
    host = null;
    if (!guests.length) return;
    guests.length = 0;
    say({ guests: [] });
  };
  const feed = (text) => {
    const s = String(text);
    let m;
    if (START.test(s) || STOP.test(s)) reset(); // мир начался или закрылся: прежние гости ушли вместе с ним, их «вышел» уже не считаем
    else if ((m = JOIN.exec(s))) {
      if (host === null) host = m[1];
      else if (m[1] !== host && !guests.includes(m[1])) {
        guests.push(m[1]);
        say({ guests: [...guests], joined: m[1] });
      }
    } else if ((m = LEAVE.exec(s))) {
      const i = guests.indexOf(m[1]);
      if (i < 0) return;
      guests.splice(i, 1);
      say({ guests: [...guests], left: m[1] });
    }
  };
  feed.reset = reset; // игра закрылась
  feed.guests = () => [...guests];
  return feed;
}

module.exports = { watcher };
