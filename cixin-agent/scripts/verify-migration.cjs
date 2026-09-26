const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const repo = path.dirname(root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'migration-manifest.json'), 'utf8').replace(/^\uFEFF/u, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
execFileSync('git', ['cat-file', '-e', `${manifest.sourceCommit}^{commit}`], { cwd: repo });
execFileSync('git', ['diff', '--exit-code', manifest.sourceCommit, '--', 'harmony-agent', 'shopping-assistant'], { cwd: repo });
for (const file of manifest.files) {
  if (sha(path.join(repo, file.source)) !== file.sourceSha256) throw new Error(`Source modified: ${file.source}`);
  if (!fs.existsSync(path.join(root, file.target))) throw new Error(`Missing migrated file: ${file.target}`);
}
const schedulerTypes = fs.readFileSync(path.join(root, 'src/scheduler/api/SchedulerTypes.ts'), 'utf8');
const semanticPolicy = fs.readFileSync(path.join(root, 'src/scheduler/policy/SemanticPolicy.ts'), 'utf8');
const runtimeContracts = fs.readFileSync(path.join(root, 'src/contracts/cixin.ts'), 'utf8');
for (const required of ['CloudClientTiming', 'cloudRunId', 'cloudTaskId']) {
  if (!schedulerTypes.includes(required)) throw new Error(`Shared scheduler type missing: ${required}`);
}
if (!semanticPolicy.includes('if (!remote && constrained') || !semanticPolicy.includes('if (!remote && unknown')) {
  throw new Error('Shared remote scheduling semantics are stale');
}
for (const required of ['CloudRouteObservation', 'CloudExecutionFeedback', 'deviceProfile', 'networkProfile']) {
  if (!runtimeContracts.includes(required)) throw new Error(`Shared runtime contract missing: ${required}`);
}
console.log(`Verified ${manifest.files.length} source files and the shared cloud scheduling contract; Harmony source projects are unchanged.`);
