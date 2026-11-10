'use strict';
const fs = require('node:fs');
const path = require('node:path');
try {
  const file = path.join(__dirname, 'website-hosting.json');
  const provider = JSON.parse(fs.readFileSync(file, 'utf8')).activeProvider;
  if (provider === 'spaceweb') process.exitCode = 0;
  else if (provider === 'firebase') process.exitCode = 1;
  else throw new Error('unknown provider');
} catch {
  console.error('Website hosting configuration is invalid; no deployment started.');
  process.exitCode = 2;
}
