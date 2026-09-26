import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../apps/harmony/monitor/server.mjs',import.meta.url),'utf8');
const input={schemaVersion:1,connected:true,state:{},metrics:{},activeTasks:[],events:[{
 taskId:'task-1',executionPlan:{routeCandidate:{routeId:'cloud-api',networkKey:'secret-network-address',
 rttMs:20,uplinkMbps:8,downlinkMbps:16,observedAt:1,estimatedUploadMs:100,estimatedTotalMs:200,source:'measured-effective-throughput'}},
 telemetry:{actual:{cloudRunId:'run_test',cloudTiming:{requestMs:190,uploadMs:null},routeEvents:[{phase:'upload',timestamp:10,token:'secret-token'}]}}
}]};
const result=vm.runInNewContext(source.slice(source.indexOf('function pick('),source.indexOf('const server ='))+';cleanSnapshot(input)',{input});
assert.equal(result.events[0].executionPlan.routeCandidate.uplinkMbps,8);
assert.equal(result.events[0].telemetry.actual.cloudTiming.requestMs,190);
assert.equal(result.events[0].telemetry.actual.cloudTiming.uploadMs,null);
assert.equal(result.events[0].telemetry.actual.routeEvents[0].phase,'upload');
assert.ok(!JSON.stringify(result).includes('secret-'));
console.log('PASS monitor retains route predictions and actual timing while stripping network identity and arbitrary event fields');
