// Неожиданные ошибки главного процесса. Раньше Electron показывал сырое окно «A JavaScript error occurred in the main process»,
// а сама ошибка нигде не оставалась. Теперь она пишется в лог, а человеку показывается понятное окно с кнопкой «Собрать
// отчёт». Окно не чаще раза в полминуты, чтобы повторяющаяся ошибка не заваливала окнами; необработанные ошибки в фоне
// (promise) не такие громкие: запись в лог и не чаще раза в минуту всплывающее сообщение
function createHandlers({ log, showDialog, notify, now = Date.now, dialogEveryMs = 30000, notifyEveryMs = 60000 }) {
  let lastDialog = -Infinity;
  let lastNotify = -Infinity;
  return {
    onException(err) {
      log.error('Неожиданная ошибка в главном процессе:', err);
      const t = now();
      if (t - lastDialog < dialogEveryMs) return false;
      lastDialog = t;
      try {
        showDialog(err);
      } catch {}
      return true;
    },
    onRejection(reason) {
      log.error('Необработанная ошибка в фоне:', reason);
      const t = now();
      if (t - lastNotify < notifyEveryMs) return false;
      lastNotify = t;
      try {
        notify(reason);
      } catch {}
      return true;
    },
  };
}

module.exports = { createHandlers };
