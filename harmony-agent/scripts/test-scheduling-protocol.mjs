import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
const fixture = JSON.parse(fs.readFileSync(new URL('contracts/scheduling/v1/fixtures.json', root), 'utf8'));
const files = ['apps/harmony/scheduler/src/main/ets/api/SchedulingProtocol.ets',
  'services/api-server/src/core/runtime/scheduling-protocol.ts'];
assert.equal(fs.readFileSync(new URL(files[0], root),'utf8'), fs.readFileSync(new URL(files[1], root),'utf8'), 'Protocol implementations drifted');
for (const file of files) {
  const source=fs.readFileSync(new URL(file,root),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{exports:module.exports});
  const api=module.exports;
  assert.equal(api.validArtifact(fixture.artifact),true);
  assert.equal(api.validTaskInstance(fixture.task),true);
  for(const mutation of [a=>a.protocolVersion=2,a=>a.sizeBytes=null,a=>a.ref.contentHash='bad',
    a=>a.sizeBytes=-1,a=>a.ref.schemaVersion=2,a=>a.locations[0].locatorId='https://untrusted.invalid',
    a=>a.dependencies=[{...a.ref,contentVersion:0}],a=>a.expiresAt=0]) {
    const changed=structuredClone(fixture.artifact);mutation(changed);assert.equal(api.validArtifact(changed),false);
  }
  for(const mutation of [t=>t.budget.remainingBudgetMs=0,t=>t.budget.remainingBudgetMs=Infinity,
    t=>t.budget.remainingBudgetMs=160000,t=>t.requestRevision=-1,t=>t.inputs=[null]]) {
    const changed=structuredClone(fixture.task);mutation(changed);assert.equal(api.validTaskInstance(changed),false);
  }
  assert.equal(api.compatibleModel(fixture.model,fixture.model),true);
  for(const key of ['modelId','modelVersion','embeddingKind','preprocessVersion','indexSpaceId','dtype','normalization']) {
    assert.equal(api.compatibleModel(fixture.model,{...fixture.model,[key]:'different'}),false);
  }
}
console.log('PASS shared TS/ArkTS v1 fixtures, invalid manifests/budgets, and model/index compatibility');
