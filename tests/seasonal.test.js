const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const look = fs.readFileSync(path.join(__dirname, '../src/renderer/app/look.js'), 'utf8');
const fn = look.match(/function season\(d = new Date\(\)\) \{[\s\S]*?\n\}/)[0];
const seasonalDate = vm.runInNewContext('(' + fn + ')');
for (const [date, expected] of Object.entries({ '2026-10-19': '', '2026-10-20': 'halloween', '2026-11-03': 'halloween', '2026-11-04': '', '2026-11-09': '', '2026-11-30': '', '2026-12-01': 'winter', '2026-12-14': 'winter', '2026-12-15': 'newyear', '2027-01-10': 'newyear', '2027-01-11': 'winter', '2027-02-10': 'valentine', '2027-02-16': 'winter', '2027-02-28': 'winter', '2028-02-29': 'winter', '2027-03-01': '' })) {
  test('Seasonal calendar: ' + date, () => assert.equal(seasonalDate(new Date(date + 'T12:00:00')), expected));
}
