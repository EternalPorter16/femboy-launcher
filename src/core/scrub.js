// Убирает из текста то, что нельзя показывать посторонним: токены входа, пароли, ключи, имя пользователя Windows в путях,
// почту и адреса серверов с портом. Нужен и отчёту для поддержки, и отправке лога на mclo.gs
const RULES = [
  // Параметры запуска игры: движок запуска печатает их в отладочный лог вместе с токеном
  [/(--(?:accessToken|session|clientId|xuid|password))\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\S+)/gi, '$1 ***'],
  // "accessToken": "…", token=…, password: "…"
  [/("?(?:access_?token|refresh_?token|client_?token|id_?token|session_?token|token|password|passwd|secret|api_?key|authorization)"?\s*[:=]\s*)"([^"\r\n]{4,})"/gi, '$1"***"'],
  [/(['"]?(?:access_?token|refresh_?token|client_?token|id_?token|session_?token|token|password|passwd|secret|api_?key|authorization)['"]?\s*[:=]\s*)'[^'\r\n]{4,}'/gi, "$1'***'"],
  [/((?:access_?token|refresh_?token|password|passwd|secret|api_?key)\s*=\s*)[^\s"',;&]{4,}/gi, '$1***'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1***'],
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, '***jwt***'],
  // Старые версии игры пишут в лог «Session ID is token:<токен>:<uuid>»
  [/(\btoken:)[A-Za-z0-9._-]{6,}(?::[0-9a-f-]{8,})?/gi, '$1***'],
  // Ключ CurseForge (bcrypt-подобная строка)
  [/\$2[aby]\$\d\d\$[./A-Za-z0-9]{40,}/g, '***'],
  // Логин и пароль в адресе прокси: http://user:pass@host:port
  [/(:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***@'],
  // Имя пользователя в путях: C:\Users\Bart\… → C:\Users\<user>\…
  [/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\r\n"'<>|:*?]+/gi, '$1<user>'],
  [/(\/(?:home|Users)\/)[^/\s"']+/g, '$1<user>'],
  [/(?:USERNAME|USERPROFILE|COMPUTERNAME)=\S+/g, (m) => m.split('=')[0] + '=<скрыто>'],
  // Почта
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '***@***'],
  // Адреса серверов с портом (свой компьютер оставляем: он нужен для разбора скинов и прокси)
  [/\b(?!127\.0\.0\.1\b|0\.0\.0\.0\b|localhost\b)(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\b/g, '***.***.***.***:порт'],
  [/\[(?!::1\])(?=[^\]]*:)[0-9a-f:.]+(?:%[\w.-]+)?\]:\d{2,5}\b/gi, '[***]:порт'],
  // Настройки authlib-injector приходят длинной base64-строкой — в логе она только мешает
  [/(-Dauthlibinjector\.yggdrasil\.prefetched=)\S{40,}/g, '$1<…>'],
];

function text(s) {
  let out = String(s ?? '');
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

// Настройки лаунчера для отчёта: без ключа CurseForge, с обезличенными путями и прокси
function settings(obj) {
  const copy = JSON.parse(JSON.stringify(obj || {}));
  if (copy.cfApiKey) copy.cfApiKey = '<есть>';
  for (const k of ['javaPath', 'syncDir', 'proxy', 'jvmArgs', 'background']) if (typeof copy[k] === 'string') copy[k] = text(copy[k]);
  delete copy.catPhrases; // свои фразы котика к делу не относятся
  return copy;
}

module.exports = { text, settings };
