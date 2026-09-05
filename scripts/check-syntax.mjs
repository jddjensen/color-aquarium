import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['public', 'netlify/functions', 'scripts'];
const files = [];

function collect(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    const stat = statSync(file);
    if (stat.isDirectory()) collect(file);
    else if (/\.(?:js|mjs)$/.test(name)) files.push(file);
  }
}

for (const root of roots) collect(resolve(root));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
