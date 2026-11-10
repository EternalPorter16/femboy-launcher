import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const history = JSON.parse(readFileSync(new URL('../src/data/releases.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../src/config/downloads.json', import.meta.url), 'utf8'));
test('история сайта согласована с опубликованным выпуском и не содержит повторов', () => {
  assert.ok(history.length > 0);
  assert.equal(history[0].version, config.release.version);
  assert.equal(history[0].date, config.release.date);
  assert.equal(new Set(history.map((entry) => entry.version)).size, history.length);
  for (const entry of history) {
    assert.match(entry.version, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
    assert.ok(Array.isArray(entry.items));
    for (const item of entry.items) {
      assert.equal(typeof item.icon, 'string');
      assert.equal(typeof item.title, 'string');
      assert.equal(typeof item.text, 'string');
      assert.ok(item.title.trim());
    }
  }
});
