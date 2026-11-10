// Звуки интерфейса: короткие мягкие «пип»/«поп» синтезируются через Web Audio, «мяу» — файл sounds/meow.mp3
(function () {
  let ctx = null;
  let enabled = true;
  let volume = 0.4;
  const meow = new Audio('sounds/meow.mp3');

  const audio = () => (ctx ||= new AudioContext());

  // Один тон с плавной атакой и затуханием; freq можно «проскользить» до freqTo
  function tone({ freq, freqTo, dur = 0.09, type = 'sine', gain = 0.18, delay = 0 }) {
    const a = audio();
    const t = a.currentTime + delay;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    click: () => tone({ freq: 880, freqTo: 1180, dur: 0.06, gain: 0.12 }),
    nav: () => (tone({ freq: 660, freqTo: 990, dur: 0.08, gain: 0.14 }), tone({ freq: 1320, dur: 0.06, gain: 0.06, delay: 0.04 })),
    on: () => (tone({ freq: 740, dur: 0.06, gain: 0.13 }), tone({ freq: 1110, dur: 0.08, gain: 0.13, delay: 0.06 })),
    off: () => (tone({ freq: 1110, dur: 0.06, gain: 0.12 }), tone({ freq: 740, dur: 0.08, gain: 0.12, delay: 0.06 })),
    open: () => tone({ freq: 520, freqTo: 1040, dur: 0.14, type: 'triangle', gain: 0.14 }),
    close: () => tone({ freq: 900, freqTo: 480, dur: 0.12, type: 'triangle', gain: 0.11 }),
    success: () => [1047, 1319, 1568].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'triangle', gain: 0.12, delay: i * 0.07 })),
    error: () => (tone({ freq: 330, freqTo: 220, dur: 0.18, type: 'triangle', gain: 0.16 }), tone({ freq: 247, dur: 0.16, type: 'triangle', gain: 0.1, delay: 0.1 })),
    meow: () => {
      meow.currentTime = 0;
      meow.volume = Math.min(1, volume * 1.6);
      meow.playbackRate = 0.94 + Math.random() * 0.14; // каждый раз чуть разное «мяу»
      meow.play().catch(() => {});
    },
  };

  function play(name) {
    if (!enabled || document.hidden || !SOUNDS[name]) return;
    try {
      SOUNDS[name]();
    } catch {}
  }

  function configure({ on, vol }) {
    if (on !== undefined) enabled = !!on;
    if (vol !== undefined) volume = Math.max(0, Math.min(1, vol / 100));
  }

  // Общий звук клика для кнопок; у кнопки с data-sound свой звук или "none"
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest('button, a, label.toggle, .inst-card, .mascot');
      if (!el || el.disabled) return;
      const name = el.dataset.sound || (el.matches('label.toggle') ? null : el.matches('.nav-btn') ? 'nav' : 'click');
      if (name && name !== 'none') play(name);
    },
    true
  );
  // Переключатели: «вкл» звучит вверх, «выкл» — вниз
  document.addEventListener('change', (e) => {
    if (e.target.matches('label.toggle input, .check input')) play(e.target.checked ? 'on' : 'off');
  });

  window.Sounds = { play, configure };
})();
