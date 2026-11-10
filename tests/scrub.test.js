const test = require('node:test');
const assert = require('node:assert/strict');
const { src } = require('./helpers');
const scrub = require(src('core/scrub'));

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

test('токен в параметрах запуска игры скрывается, остальные параметры остаются', () => {
  const cmd = `java -Xmx4096M net.minecraft.client.main.Main --username Fox --version 1.21.1 --accessToken ${JWT} --clientId abc123 --xuid 2535 --uuid 0123456789abcdef --userType msa`;
  const out = scrub.text(cmd);
  assert.ok(!out.includes(JWT) && !out.includes('abc123') && !out.includes('2535'));
  assert.match(out, /--accessToken \*\*\* --clientId \*\*\* --xuid \*\*\* --uuid 0123456789abcdef --userType msa/);
  assert.match(out, /--username Fox --version 1.21.1/);
});

test('токены в JSON, в заголовках и в старых логах', () => {
  assert.equal(scrub.text('{"accessToken":"abcdef123456","name":"Fox"}'), '{"accessToken":"***","name":"Fox"}');
  assert.equal(scrub.text('"refresh_token": "M.R3_BAY.xyz123"'), '"refresh_token": "***"');
  assert.equal(scrub.text('Authorization: Bearer abcdefghijkl1234'), 'Authorization: Bearer ***');
  assert.equal(scrub.text(`jwt in text ${JWT} end`), 'jwt in text ***jwt*** end');
  assert.equal(scrub.text('Session ID is token:abcDEF123456:0123abcd-0123-0123-0123-0123456789ab'), 'Session ID is token:***');
  assert.equal(scrub.text('password=hunter2xyz&x=1'), 'password=***&x=1');
});

test('имя пользователя Windows в путях заменяется, сам путь остаётся понятным', () => {
  assert.equal(scrub.text('C:\\Users\\Bart\\AppData\\Roaming\\Femboy Launcher\\java\\21\\bin\\javaw.exe'), 'C:\\Users\\<user>\\AppData\\Roaming\\Femboy Launcher\\java\\21\\bin\\javaw.exe');
  assert.equal(scrub.text('D:/Users/Фокс Иванов/Documents'), 'D:/Users/<user>/Documents'.replace('Фокс Иванов', '<user>').replace('<user>/Documents', '<user>/Documents'));
  assert.equal(scrub.text('/home/fox/.minecraft/mods'), '/home/<user>/.minecraft/mods');
  assert.equal(scrub.text('USERNAME=Bart'), 'USERNAME=<скрыто>');
  assert.equal(scrub.text('C:\\Program Files\\Java\\jdk-21'), 'C:\\Program Files\\Java\\jdk-21', 'пути без имени пользователя не трогаем');
});

test('почта, адреса серверов с портом, логин в адресе прокси, ключ CurseForge', () => {
  assert.equal(scrub.text('mail fox@example.com ok'), 'mail ***@*** ok');
  assert.equal(scrub.text('Connecting to 203.0.113.7:25565'), 'Connecting to ***.***.***.***:порт');
  assert.equal(scrub.text('proxy 127.0.0.1:10809 and 0.0.0.0:80'), 'proxy 127.0.0.1:10809 and 0.0.0.0:80', 'свой компьютер оставляем');
  assert.equal(scrub.text('версия 0.15.11.1 mod'), 'версия 0.15.11.1 mod', 'номер версии не принимаем за адрес');
  assert.equal(scrub.text('http://user:pass123@proxy.local:8080'), 'http://***@proxy.local:8080');
  assert.equal(scrub.text('key $2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab ok'), 'key *** ok');
});

test('длинные настройки authlib-injector в логе сокращаются', () => {
  const b64 = Buffer.from('x'.repeat(300)).toString('base64');
  assert.equal(scrub.text(`-javaagent:a.jar=ely.by -Dauthlibinjector.yggdrasil.prefetched=${b64} -Dx=1`), '-javaagent:a.jar=ely.by -Dauthlibinjector.yggdrasil.prefetched=<…> -Dx=1');
});

test('обычный текст проходит без изменений', () => {
  const normal = '[06:55:12] [main/INFO]: Setting user: Fox\n[06:55:13] [Render thread/INFO]: Loaded 142 mods, java 21.0.4';
  assert.equal(scrub.text(normal), normal);
  assert.equal(scrub.text(null), '');
});

test('настройки для отчёта: без ключа, с обезличенными путями и прокси', () => {
  const s = scrub.settings({ cfApiKey: '$2a$10$secret', javaPath: 'C:\\Users\\Bart\\java\\bin\\javaw.exe', proxy: 'http://u:p@h:1', maxRam: 4096, catPhrases: ['привет'], syncDir: 'D:\\Users\\Bart\\Cloud' });
  assert.equal(s.cfApiKey, '<есть>');
  assert.equal(s.javaPath, 'C:\\Users\\<user>\\java\\bin\\javaw.exe');
  assert.equal(s.proxy, 'http://***@h:1');
  assert.equal(s.syncDir, 'D:\\Users\\<user>\\Cloud');
  assert.equal(s.maxRam, 4096);
  assert.ok(!('catPhrases' in s));
});
