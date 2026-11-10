const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/core/lifecycle');

function setup() {
  let busy = false, hidden = 0, quit = 0, prevented = 0;
  const guard = create({ isBusy: () => busy, hide: () => hidden++, quit: () => quit++ });
  return { guard, event: { preventDefault: () => prevented++ }, setBusy: (value) => { busy = value; }, counts: () => ({ hidden, quit, prevented }) };
}

test('closing the window during a game hides it and does not queue exit', () => {
  const f = setup(); f.setBusy(true); f.guard.close(f.event);
  assert.deepEqual(f.counts(), { hidden: 1, quit: 0, prevented: 1 });
  assert.equal(f.guard.quitPending, false);
  f.setBusy(false); f.guard.idle();
  assert.equal(f.counts().quit, 0);
});

test('an explicit quit waits until both the game and its backup job have ended', () => {
  const f = setup(); f.setBusy(true); f.guard.beforeQuit(f.event);
  assert.equal(f.guard.quitPending, true);
  f.guard.idle(); assert.equal(f.counts().quit, 0);
  // A finished game with a still-running backup remains busy.
  f.guard.idle(); assert.equal(f.counts().quit, 0);
  f.setBusy(false); f.guard.idle(); f.guard.idle();
  assert.equal(f.counts().quit, 1);
});

test('an idle launcher may close or quit immediately', () => {
  const f = setup(); f.guard.close(f.event); f.guard.beforeQuit(f.event);
  assert.deepEqual(f.counts(), { hidden: 0, quit: 0, prevented: 0 });
});
