// Минимальный клиент DevTools-протокола: выполнить JavaScript в окне лаунчера и собрать ошибки страницы и консоли
async function connect(port) {
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const seen = { exceptions: [], errors: [], warnings: [] };
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d.result ?? d.error);
      pending.delete(d.id);
    }
    if (d.method === 'Runtime.exceptionThrown') seen.exceptions.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) {
      (d.params.type === 'error' ? seen.errors : seen.warnings).push(d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error('DevTools не ответил на ' + method)), 90000); // английский проход — одна длинная проверка, она растёт с каждым новым окном
      pending.set(n, (v) => (clearTimeout(timer), resolve(v)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send('Runtime.enable');
  // Выражение выполняется внутри async-функции: можно писать await, а паузу в миллисекундах делает s(мс)
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));${expr}})()`, awaitPromise: true, returnByValue: true });
    return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 400) : r.result?.value;
  };
  return { ev, seen, close: () => ws.close() };
}

module.exports = { connect };
