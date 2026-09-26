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
    if (name === '@kit.NetworkKit') return { http, connection: { createNetConnection: () => ({ on: () => {}, register: callback => callback(), unregister: callback => callback() }) } };
    if (name === '@kit.ArkData') return { preferences };
    if (name === '@kit.CoreFileKit') return { fileIo: {} };
    if (name === '@kit.ArkTS') return { util: {} };
    if (name === 'scheduler') return { ...load(path.join(root,'scheduler/src/main/ets/api/SchedulerTypes.ets')),
      ...load(path.join(root,'scheduler/src/main/ets/api/SchedulerClient.ets')),
      ...load(path.join(root,'scheduler/src/main/ets/api/RemoteRouteProfile.ets')),
      ...load(path.join(root,'scheduler/src/main/ets/network/HttpRouteProbe.ets')) };
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
await assert.rejects(executor.execute(input,plan,signal),/REMOTE_ROUTE_EXPIRED_OR_MISSING/);
await assert.rejects(executor.prepare(input,{networkAllowed:true}),/CLOUD_API_NOT_CONFIGURED/);
await assert.rejects(CloudApiConfig.save({},'http://127.0.0.1:3010'),/HTTPS/);
await CloudApiConfig.save({},'https://shopping.invalid');
const probe = data => ({ responseCode:200, result:JSON.stringify({ success:true, data }) });
replies=[probe({available:true}),probe({receivedBytes:32768}),probe({padding:'x'.repeat(32768)}),probe({queueMs:2}),probe({available:true})]; calls=[];
const context={networkAllowed:true};
await executor.prepare(input, context, signal);
assert.equal(calls.length,5); assert.ok(calls.every(call=>call.url.includes('/runtime/probe/')));
assert.ok(context.routeCandidate.uplinkMbps>0); assert.ok(context.routeCandidate.estimatedUploadMs>0);
plan.routeCandidate=context.routeCandidate;
replies=[ok,health]; calls=[];
const phases=[];
const result=await executor.execute(input,plan,signal,undefined,event=>phases.push(event.phase));
assert.equal(result.output[0].externalId,'p1'); assert.equal(result.telemetry.cloudRunId,'run_test');
const payload=JSON.parse(calls[0].options.extraData);
assert.equal(payload.taskId,'phone_test'); assert.equal(payload.deviceProfile.batteryPercent,70);
assert.equal(payload.executionPlan.allowLocalFallback,false); assert.equal(payload.taskProfile.allowCloud,true);
assert.equal(payload.networkProfile.source,'measured'); assert.ok(payload.networkProfile.uploadMbps>0);
assert.ok(phases.includes('download') && phases.includes('complete'));
assert.equal(calls.filter(call=>call.url.endsWith('/shopping/tasks')).length,1);
replies=[{responseCode:503,result:'unavailable'}];calls=[];
await assert.rejects(executor.execute(input,plan,signal),/CLOUD_HTTP_503/); assert.equal(calls.length,1);
await assert.rejects(executor.execute(input,plan,signal),/REMOTE_ROUTE_EXPIRED_OR_MISSING/);
async function refreshRoute() {
 replies=[probe({available:true}),probe({receivedBytes:32768}),probe({padding:'x'.repeat(32768)}),probe({queueMs:2}),probe({available:true})];
 await executor.prepare(input,context,signal); plan.routeCandidate=context.routeCandidate;
}
await refreshRoute();
replies=[new Error('timeout')];calls=[];
await assert.rejects(executor.execute(input,plan,signal),/timeout/); assert.equal(calls.length,1);
await refreshRoute();
cancelled=true; calls=[];
await assert.rejects(executor.execute(input,plan,signal),/CLOUD_CANCELLED/);assert.equal(calls.length,0);
cancelled=false;
await refreshRoute();
replies=[()=>{cancelled=true;listeners.slice().forEach(fn=>fn());return health;}];calls=[];
await assert.rejects(executor.execute(input,plan,signal),/CLOUD_CANCELLED/);assert.equal(listeners.length,0);
cancelled=false;
const expired={...plan,routeCandidate:{...plan.routeCandidate,observedAt:Date.now()-31000}};
await assert.rejects(executor.execute(input,expired,signal),/REMOTE_ROUTE_EXPIRED_OR_MISSING/);
await executor.dispose();
let registered=[];
const service=ShoppingTaskService.getInstance();
service.initialize({registerExecutor:e=>registered.push(e),getDeviceState:()=>({batteryPercent:80}),unregisterExecutor:async()=>0});
assert.equal(registered.length,1);assert.equal(registered[0].inferenceLocation,'REMOTE_CLOUD');
for(const file of ['services/ShoppingTaskService.ets','entryability/EntryAbility.ets','pages/Index.ets']) {
 const source=fs.readFileSync(path.join(root,'entry/src/main/ets',file),'utf8');
 assert.doesNotMatch(source,/DataInitService|NeuralEmbeddingIndex|StoreManager/);
}
assert.ok(destroyed>0);
console.log('PASS cloud HTTP success, pre-plan probe, measured routing, failure, timeout, cancellation, remote registration and no local database path');

const { SchedulerClient } = load(path.join(root,'scheduler/src/main/ets/api/SchedulerClient.ets'));
let submissions=0, phantomSignals=0, preparing;
const gate=new Promise(resolve=>{preparing=resolve;});
const prepClient=new SchedulerClient({ registerExecutor:()=>{},unregisterExecutor:async()=>0,
  submitTask:async()=>{submissions++;throw Error('should not submit');},signalTask:async()=>{phantomSignals++;} });
prepClient.registerTemplate(service.template);
prepClient.registerExecutor({capability:'product_search',inferenceLocation:types.InferenceLocation.REMOTE_CLOUD,
  supports:()=>true,dispose:async()=>{},execute:async()=>{throw Error('should not execute');},
  prepare:async(input,context,signal)=>{preparing();await new Promise(resolve=>signal.onCancelled(resolve));throw Error('CLOUD_CANCELLED');}});
const preparingHandle=prepClient.submit('product_search',{}, {userVisible:true,userWaiting:true,accuracyFloor:types.ModelTier.HIGH_ACCURACY,networkAllowed:true});
await gate; assert.equal(await preparingHandle.cancel(),true);
assert.equal((await preparingHandle.result).status,types.TaskStatus.CANCELLED);
assert.equal(submissions,0);assert.equal(phantomSignals,0);
await prepClient.dispose();
console.log('PASS cancellation during pre-plan probing prevents submission without signalling nonexistent tasks');
