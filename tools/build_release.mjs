import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO, restore, verifySite } from './unity_release.mjs';

restore();
const build = spawnSync(process.execPath, [path.join(REPO, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: REPO, env: { ...process.env, VITE_COMBAT_ENGINE: 'unity' }, stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status || 1);
console.log(JSON.stringify(verifySite(path.join(REPO, 'dist')), null, 2));
