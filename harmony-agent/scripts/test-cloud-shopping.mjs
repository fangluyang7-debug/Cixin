import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(import.meta.dirname, '../apps/harmony');
const cache = new Map();
let replies = [], calls = [], destroyed = 0;
const http = { RequestMethod: { GET: 'GET', POST: 'POST' }, createHttp: () => ({
  request: async (url, options) => { calls.push({ url, options }); const next = replies.shift();
    if (next instanceof Error) throw next; if (typeof next === 'function') return next(); return next; },
  on: () => {}, off: () => {}, destroy: () => { destroyed++; }
}) };
const pref = new Map();
const preferences = { getPreferences: async () => ({ get: async (k, d) => pref.get(k) ?? d,
  put: async (k,v) => pref.set(k,v), flush: async () => {} }) };
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const source = fs.readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020 }, fileName: file }).outputText;
  const module = { exports: {} }; cache.set(file,module);
  const localRequire = name => {
    if (name === '@kit.NetworkKit') return { http };
    if (name === '@kit.ArkData') return { preferences };
    if (name === '@kit.CoreFileKit') return { fileIo: {} };
    if (name === '@kit.ArkTS') return { util: {} };
    if (name === 'scheduler') return { ...load(path.join(root,'scheduler/src/main/ets/api/SchedulerTypes.ets')),
      ...load(path.join(root,'scheduler/src/main/ets/api/SchedulerClient.ets')) };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name+'.ets'));
    throw new Error('Unexpected dependency '+name);
  };
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})', {filename:file})(localRequire,module,module.exports);
  return module.exports;
}
const services=path.join(root,'entry/src/main/ets/services');
const { CloudApiConfig }=load(path.join(services,'CloudApiConfig.ets'));
const { CloudShoppingExecutor }=load(path.join(services,'CloudShoppingExecutor.ets'));
const { ShoppingTaskService }=load(path.join(services,'ShoppingTaskService.ets'));
const types=load(path.join(root,'scheduler/src/main/ets/api/SchedulerTypes.ets'));
const plan={ inferenceLocation:types.InferenceLocation.REMOTE_CLOUD, provider:'cloud-shopping-api',
  allowLocalFallback:false, maxRetries:1, timeoutMs:1000 };
let cancelled=false, listeners=[];
const signal={get isCancellationRequested(){return cancelled;},onCancelled(fn){listeners.push(fn);return ()=>{listeners=listeners.filter(x=>x!==fn);};}};
const input={taskId:'phone_test',operation:'text',query:'shoes',deviceProfile:{batteryPercent:70},context:{},template:{}};
const ok={responseCode:200,result:JSON.stringify({success:true,data:{runtimeRunId:'run_test',candidates:{items:[{
  candidateItemId:'p1',title:'shoe',platformName:'shop',price:{amount:12,currency:'CNY'},coverImageUrl:'https://image.invalid/p'
}]}}})};
const health={responseCode:200,result:'{}'};
const executor=new CloudShoppingExecutor();
await assert.rejects(executor.execute(input,plan,signal),/CLOUD_API_NOT_CONFIGURED/);
await assert.rejects(CloudApiConfig.save({},'http://127.0.0.1:3010'),/HTTPS/);
await CloudApiConfig.save({},'https://shopping.invalid');
replies=[health,ok,health]; calls=[];
const result=await executor.execute(input,plan,signal);
assert.equal(result.output[0].externalId,'p1'); assert.equal(result.telemetry.cloudRunId,'run_test');
const payload=JSON.parse(calls[1].options.extraData);
assert.equal(payload.taskId,'phone_test'); assert.equal(payload.deviceProfile.batteryPercent,70);
assert.equal(payload.executionPlan.allowLocalFallback,false); assert.equal(payload.taskProfile.allowCloud,true);
replies=[new Error('timeout'),health,ok,health]; calls=[];
await executor.execute(input,plan,signal); assert.equal(calls.length,4);
replies=[health,{responseCode:503,result:'unavailable'}];calls=[];
await assert.rejects(executor.execute(input,plan,signal),/CLOUD_HTTP_503/); assert.equal(calls.length,2);
replies=[health,new Error('timeout')];calls=[];
await assert.rejects(executor.execute(input,plan,signal),/timeout/); assert.equal(calls.length,2);
cancelled=true; calls=[];
await assert.rejects(executor.execute(input,plan,signal),/CLOUD_CANCELLED/);assert.equal(calls.length,0);
cancelled=false;
replies=[()=>{cancelled=true;listeners.slice().forEach(fn=>fn());return health;}];calls=[];
await assert.rejects(executor.execute(input,plan,signal),/CLOUD_CANCELLED/);assert.equal(listeners.length,0);
cancelled=false;
let registered=[];
const service=ShoppingTaskService.getInstance();
service.initialize({registerExecutor:e=>registered.push(e),getDeviceState:()=>({batteryPercent:80}),unregisterExecutor:async()=>0});
assert.equal(registered.length,1);assert.equal(registered[0].inferenceLocation,'REMOTE_CLOUD');
for(const file of ['services/ShoppingTaskService.ets','entryability/EntryAbility.ets','pages/Index.ets']) {
 const source=fs.readFileSync(path.join(root,'entry/src/main/ets',file),'utf8');
 assert.doesNotMatch(source,/DataInitService|NeuralEmbeddingIndex|StoreManager/);
}
assert.ok(destroyed>0);
console.log('PASS cloud HTTP success, readiness retry, failure, timeout, cancellation, remote registration and no local database path');
