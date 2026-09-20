import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, ''));
const manifest = readJson('migration-manifest.json');
let checked = 0;
let changed = 0;
for (const entry of manifest.files) {
  const target = resolve(root, entry.target);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Path escapes workspace: ${entry.target}`);
  if (entry.disposition === 'omitted_after_copy') continue;
  if (!existsSync(target)) throw new Error(`Missing migrated file: ${entry.target}`);
  if (entry.targetSha256) {
    const hash = createHash('sha256').update(readFileSync(target)).digest('hex');
    if (hash !== entry.targetSha256) changed++;
  }
  checked++;
}
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
if (lock.name !== pkg.name || lock.packages[''].name !== pkg.name) {
  throw new Error('Root package/lock identity mismatch');
}
for (const workspace of pkg.workspaces) {
  const child = readJson(`${workspace}/package.json`);
  if (lock.packages[workspace]?.name !== child.name) throw new Error(`Workspace lock mismatch: ${workspace}`);
  for (const group of ['dependencies', 'devDependencies']) {
    const sort = (value) => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    if (sort(child[group]) !== sort(lock.packages[workspace]?.[group])) throw new Error(`Dependency mismatch: ${workspace}/${group}`);
  }
}
console.log(`Migration verified: ${checked} copied files present; ${changed} changed since migration snapshot.`);
console.log('Independent workspace and lockfile identities verified. This does not validate HarmonyOS device support.');
