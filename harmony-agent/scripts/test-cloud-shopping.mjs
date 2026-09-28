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
    if (name === '@kit.BasicServicesKit') return { systemDateTime: { TimeType: { STARTUP: 0 }, getUptime: () => performance.now() } };
    if (name === '@kit.NetworkKit') return { http, connection: { createNetConnection: () => ({ on: () => {}, register: callback => callback(), unregister: callback => callback() }) } };
    if (name === '@kit.ArkData') return { preferences };
    if (name === '@kit.CoreFileKit') return { fileIo: { OpenMode: { READ_ONLY: 0 }, openSync: () => ({fd: 1}), statSync: () => ({size: 4}), readSync: (fd, b) => { new Uint8Array(b).set([0xff, 0xd8, 1, 2]); return 4; }, closeSync: () => {} } };
    if (name === '@kit.ArkTS') return { util: {} };
    if (name === 'scheduler') return { ...load(path.join(root,'scheduler/src/main/ets/api/ClockPort.ets')), ...load(path.join(root,'scheduler/src/main/ets/api/SchedulerTypes.ets')),
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
calls=[];
replies=[{responseCode:404,result:'{}'}];
await assert.rejects(executor.prepare(input,{networkAllowed:true}),/CLOUD_GUEST_NOT_DEPLOYED/);
assert.equal(calls.length,1,'No probes or uploads when guest setup fails');
CloudApiConfig.setAccessToken('test-access-token');
const { cloudFailureText }=load(path.join(services,'CommercePresentation.ets'));
assert.match(cloudFailureText('CLOUD_GUEST_NOT_DEPLOYED'), /更新/);
assert.match(cloudFailureText('CLOUD_API_NOT_CONFIGURED'), /地址/);
assert.doesNotMatch(cloudFailureText('INTERNAL_ERROR'), /设备状态/);
const probe = data => ({ responseCode:200, result:JSON.stringify({ success:true, data }) });
const readyText=probe({available:false,capabilities:{'shopping.text':{available:true},'shopping.image':{available:false}}});
replies=[probe({available:true}),probe({receivedBytes:8192}),probe({padding:'x'.repeat(32768)}),probe({queueMs:2}),readyText]; calls=[];
const context={networkAllowed:true};
await executor.prepare(input, context, signal);
assert.equal(calls.length,5); assert.ok(calls.slice(0,4).every(call=>call.url.includes('/runtime/probe/')));
assert.ok(calls[4].url.endsWith('/api/v1/health/capabilities'));
assert.equal(context.routeCandidate.remoteDependencyHealth,true,'Image unavailability must not block text search');
assert.ok(context.routeCandidate.uplinkMbps>0); assert.ok(context.routeCandidate.estimatedUploadMs>0);
plan.routeCandidate=context.routeCandidate;
replies=[ok,health]; calls=[];
const phases=[];
const result=await executor.execute(input,plan,signal,undefined,event=>phases.push(event.phase));
assert.equal(result.output.products[0].candidateItemId,'p1'); assert.equal(result.output.products[0].externalId,''); assert.equal(result.telemetry.cloudRunId,'run_test');
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
 replies=[probe({available:true}),probe({receivedBytes:8192}),probe({padding:'x'.repeat(32768)}),probe({queueMs:2}),readyText];
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

CloudApiConfig.logout();
assert.equal(CloudApiConfig.isAuthenticated(), false);
replies = [{ responseCode: 200, result: JSON.stringify({ success: true, data: { accessToken: 'test-user-token' } }) }];
const beforeGuest=calls.length;
await Promise.all([CloudApiConfig.ensureGuest(),CloudApiConfig.ensureGuest()]);
assert.equal(calls.length,beforeGuest+1,'Concurrent searches share guest creation');
assert.equal(CloudApiConfig.requestHeaders().Authorization, 'Bearer test-user-token');
assert.ok(calls.at(-1).url.endsWith('/api/v1/auth/guest'));
assert.equal(calls.at(-1).options.extraData,'{}');
await CloudApiConfig.ensureGuest();
assert.equal(calls.length,beforeGuest+1,'Reuse guest for subsequent searches');
assert.equal([...pref.values()].some(value => String(value).includes('test-password') || String(value).includes('test-user-token')), false);
await CloudApiConfig.save({}, 'https://different.example.test');
assert.equal(CloudApiConfig.isAuthenticated(), false);
assert.equal(CloudApiConfig.requestHeaders().Authorization, undefined);
console.log('PASS automatic guest setup, request coalescing, reuse and origin isolation');

const { decodeShoppingResult } = load(path.join(root,'entry/src/main/ets/models/ShoppingResult.ets'));
const { productKey } = load(path.join(services,'CommercePresentation.ets'));
for (const operation of ['prices','answer','read','profile','subject']) {
 const data={runtimeRunId:'run_fixture',status:'succeeded',session:{sessionId:'session_fixture'},
   assistantMessage:{kind:'catalog_summary',text:'中文回答'},prices:[],
   activeFilter:{priceMax:'123.45',preferences:{brands:['品牌']}},requiredInfo:{fields:['size']}};
 const parsed=decodeShoppingResult(JSON.stringify({success:true,data}),operation,'phone_fixture');
 assert.equal(parsed.products,null,'No candidates is not an empty candidate list');
 assert.deepEqual(JSON.parse(parsed.payloadJson),data,'Transitional snapshot preserves non-card data');
 assert.equal(parsed.sessionId,'session_fixture');
}
const identityData={runtimeRunId:'run_identity',candidates:{items:[{candidateItemId:'candidate_1',externalId:'platform_1',productId:'product_1',
 title:'中文商品',platformName:'shop',price:{amount:'123.4500',currency:'CNY'}}]}};
const identity=decodeShoppingResult(JSON.stringify({success:true,data:identityData}),'text','phone_fixture').products[0];
assert.equal(identity.externalId,'platform_1');assert.equal(identity.candidateItemId,'candidate_1');
assert.equal(identity.price,'123.4500');assert.equal(productKey(identity),'product:product_1');
identityData.candidates.items[0].price.amount='NaN';
assert.throws(()=>decodeShoppingResult(JSON.stringify({success:true,data:identityData}),'text','phone_fixture'),/CLOUD_INVALID_CANDIDATE/);
let mono=0;
const budgetClient=new SchedulerClient({registerExecutor:()=>{},unregisterExecutor:async()=>0,
 submitTask:async()=>{throw Error('Expired prepare must not submit');},signalTask:async()=>{}}, {now:()=>mono,wallNow:()=>100000});
budgetClient.registerTemplate(service.template);
budgetClient.registerExecutor({capability:'product_search',inferenceLocation:types.InferenceLocation.REMOTE_CLOUD,
 supports:()=>true,dispose:async()=>{},execute:async()=>{throw Error('must not execute');},prepare:async()=>{mono=101;}});
const budgetHandle=budgetClient.submit('product_search',{}, {userVisible:true,userWaiting:true,accuracyFloor:types.ModelTier.HIGH_ACCURACY,networkAllowed:true,deadlineMs:100});
assert.equal((await budgetHandle.result).reasonCode,'DEADLINE_EXCEEDED');
await budgetClient.dispose();
console.log('PASS lossless transitional results, independent product identity, decimal prices and post-prepare budget rejection');

const { ShoppingImageUpload } = load(path.join(services, 'ShoppingImageUpload.ets'));
const uploadClock = { now: () => 10, wallNow: () => Date.now() };
cancelled = false; calls = [];
replies = [probe({assetId: 'asset_upload'})];
const uploaded = await ShoppingImageUpload.upload('test.jpg', uploadClock, 1000, signal);
assert.equal(uploaded.assetId, 'asset_upload');
assert.ok(calls[0].options.extraData instanceof ArrayBuffer);
assert.match(calls[0].options.header['Content-Type'], /multipart/);
const multipart = Buffer.from(calls[0].options.extraData);
assert.ok(multipart.includes(Buffer.from([0xff, 0xd8, 1, 2])));
assert.ok(!multipart.includes(Buffer.from('imageBase64')));
calls = [];
await assert.rejects(ShoppingImageUpload.upload('test.jpg', uploadClock, 10, signal), /DEADLINE_EXCEEDED/);
assert.equal(calls.length, 0);
cancelled = true;
await assert.rejects(ShoppingImageUpload.upload('test.jpg', uploadClock, 1000, signal), /CLOUD_CANCELLED/);
cancelled = false;
CloudApiConfig.setAccessToken('test-access-token');
const imageInput = {...input, operation: 'image_upload', photoUri: 'test.jpg', assetId: uploaded.assetId};
replies = [probe({available:true}),probe({receivedBytes:8192}),probe({padding:'x'.repeat(32768)}),probe({queueMs:2}),probe({capabilities:{'shopping.image':{available:true}}})];
calls=[];
const imageExecutor = executor;
await imageExecutor.prepare(imageInput, {networkAllowed:true}, signal);
assert.equal(calls.filter(c=>c.url.endsWith('/api/v1/health/capabilities')).length, 1, 'Image capability is not reused from text health');
assert.equal(calls.filter(c=>c.url.endsWith('/assets/images')).length, 0, 'An already uploaded image is reused');
assert.equal(imageInput.preparedBody.assetId, 'asset_upload');
assert.ok(!JSON.stringify(imageInput.preparedBody).includes('Base64'));
console.log('PASS binary image upload, cancellation/deadline admission and uploaded asset reuse');
