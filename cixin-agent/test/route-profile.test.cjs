const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RemoteRouteRegistry, routeStatus } = require('../dist/scheduler/api/RemoteRouteProfile');
const route = () => ({ routeId:'r',backend:'cloud',networkKey:'n', rttMs:10,uplinkMbps:8,downlinkMbps:16,
 cloudQueueMs:2,cloudReachability:true,remoteDependencyHealth:true,observedAt:Date.now(),bandwidthAt:Date.now(),
 dependenciesAt:Date.now(),source:'measured-effective-throughput',estimatedUploadMs:0,estimatedDownloadMs:0,
 estimatedTotalMs:0,costEstimate:null });
const profile = { taskKind:'generic',latencyClass:'interactive',input:{modality:'image',bytes:1000000,requiresUpload:true},estimatedResultBytes:100000,allowCloud:true };
test('shared Harmony and board network policy remains identical', () => {
 const base=path.resolve(__dirname,'../..');
 assert.equal(fs.readFileSync(path.join(base,'cixin-agent/src/scheduler/api/RemoteRouteProfile.ts'),'utf8'),
  fs.readFileSync(path.join(base,'harmony-agent/apps/harmony/scheduler/src/main/ets/api/RemoteRouteProfile.ets'),'utf8'));
});
test('field TTL, realtime TTL, future data and unavailable network reject independently', () => {
 const now=Date.now();
 assert.equal(routeStatus(route(),'interactive',now),'fresh');
 assert.equal(routeStatus({...route(),bandwidthAt:now-61000},'interactive',now),'ROUTE_EXPIRED');
 assert.equal(routeStatus({...route(),dependenciesAt:now-181000},'interactive',now),'ROUTE_EXPIRED');
 assert.equal(routeStatus({...route(),observedAt:now-11000},'realtime',now),'ROUTE_EXPIRED');
 assert.equal(routeStatus({...route(),observedAt:now+10000},'interactive',now),'ROUTE_EXPIRED');
 assert.equal(routeStatus({...route(),uplinkMbps:0}),'ROUTE_METRICS_INVALID');
 assert.equal(routeStatus({...route(),cloudReachability:false}),'REMOTE_UNAVAILABLE');
});
test('payload size drives prediction, fresh cache avoids probes, invalidation forces refresh', async () => {
 let probes=0; const port={probe:async()=>{probes++;return route();}}; const registry=new RemoteRouteRegistry();
 const first=await registry.prepare('r',profile,port,100);
 assert.equal(first.estimatedUploadMs,1000); assert.equal(first.estimatedTotalMs,1162);
 const large=await registry.prepare('r',{...profile,input:{...profile.input,bytes:2000000}},port,100);
 assert.equal(probes,1); assert.equal(large.estimatedUploadMs,2000);
 registry.invalidate('r','UPLOAD_FAILED'); await registry.prepare('r',profile,port,100); assert.equal(probes,2);
 registry.invalidate('r','NETWORK_CHANGED'); await registry.prepare('r',profile,port,100); assert.equal(probes,3);
});
test('server execution feedback learns with missing native transfer timing and stays workload isolated', async () => {
 const registry=new RemoteRouteRegistry(); const port={probe:async()=>route()};
 const first=await registry.prepare('r',profile,port,10000);
 registry.observe('r',first,600,null,null,1000000,100000,500);
 const learned=await registry.prepare('r',profile,port,10000);
 assert.equal(learned.estimatedTotalMs,1562);
 const other=await registry.prepare('r',{...profile,taskKind:'audio'},port,10000);
 assert.equal(other.estimatedTotalMs,11062);
 registry.observe('r',first,1000,null,null,1,1,1500);
 assert.equal((await registry.prepare('r',profile,port,10000)).estimatedTotalMs,1862);
});
