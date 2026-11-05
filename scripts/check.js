import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/config.js';

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith('.js') ? [file] : [];
  });
}
for (const file of ['src', 'scripts', 'test', 'public'].flatMap(dir => files(path.join(ROOT, dir)))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...files(path.join(ROOT, 'test')).filter(file => file.endsWith('.test.js'))], { stdio: 'inherit' });
process.exit(result.status || 0);
