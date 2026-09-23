const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const repo = path.dirname(root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'migration-manifest.json'), 'utf8').replace(/^\uFEFF/u, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ref = execFileSync('git', ['rev-parse', manifest.sourceBranch], { cwd: repo, encoding: 'utf8' }).trim();
if (ref !== manifest.sourceCommit) throw new Error('Source branch reference has changed since migration');
execFileSync('git', ['diff', '--exit-code', manifest.sourceCommit, '--', 'harmony-agent', 'shopping-assistant'], { cwd: repo });
for (const file of manifest.files) {
  if (sha(path.join(repo, file.source)) !== file.sourceSha256) throw new Error(`Source modified: ${file.source}`);
  if (!fs.existsSync(path.join(root, file.target))) throw new Error(`Missing migrated file: ${file.target}`);
}
console.log(`Verified ${manifest.files.length} migrated core files; original branch and both source projects are unchanged.`);
