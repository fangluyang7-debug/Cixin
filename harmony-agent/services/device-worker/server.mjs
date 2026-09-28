import http from 'node:http';
import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { LeaseManager } from './lease-manager.mjs';

const token=process.env.WORKER_TOKEN;
if(!token||token.length<32) throw new Error('WORKER_TOKEN_REQUIRED_MIN_32');
const directory=path.resolve(process.env.WORKER_DATA_DIR??'artifacts/device-worker');
await mkdir(directory,{recursive:true});
let allocatedBytes=0;
for(const name of await readdir(directory)) allocatedBytes+=(await stat(path.join(directory,name))).size;
const maximumBytes=512*1024*1024;
const instanceId=randomUUID(),manager=new LeaseManager(),hash=b=>createHash('sha256').update(b).digest('hex');
const atomically=async(file,bytes)=>{const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,bytes);await rename(temp,file);};
let journal=Promise.resolve();
function persist() {
  const snapshot=JSON.stringify([...manager.leases.values()].map(l=>({...manager.receipt(l),ownerId:l.ownerId,memoryBytes:l.memoryBytes,identity:l.identity,checkpointRef:l.checkpointRef})));
  journal=journal.then(()=>atomically(path.join(directory,'leases.json'),snapshot));return journal;
}
try {
  const previous=JSON.parse(await readFile(path.join(directory,'leases.json'),'utf8'));
  for(const l of previous) {
    // Threads die with their process. Old incomplete attempts are never silently replayed.
    manager.leases.set(l.leaseId,{...l,expiresMono:0,settled:true,state:'SETTLED',stopRequested:l.stopRequested||!l.settled,
      errorCode:l.settled?l.errorCode:'WORKER_RESTARTED',output:l.settled?l.output:null,controller:new AbortController()});
    manager.fence=Math.max(manager.fence,l.fencingToken);
  }
} catch(error) { if(error.code!=='ENOENT') throw error; }
async function put(ownerId,bytes,schemaId,mediaType='application/json') {
  if(allocatedBytes+bytes.length+2048>maximumBytes)throw new Error('STORAGE_CAPACITY_FULL');
  allocatedBytes+=bytes.length+2048; // Reserve before asynchronous writes; failures retain the reservation conservatively.
  const ref={artifactId:'artifact_'+randomUUID(),contentVersion:1,contentHash:hash(bytes),schemaId,schemaVersion:1};
  await atomically(path.join(directory,ref.artifactId+'.bin'),bytes);
  await atomically(path.join(directory,ref.artifactId+'.json'),JSON.stringify({ref,ownerId,mediaType,sizeBytes:bytes.length,state:'COMMITTED'}));return ref;
}
async function resolve(ownerId,ref) {
  if(!ref||!/^artifact_[a-f0-9-]{36}$/.test(ref.artifactId)) throw new Error('ARTIFACT_NOT_FOUND');
  const file=path.join(directory,ref.artifactId+'.bin');
  let manifest;try{manifest=JSON.parse(await readFile(path.join(directory,ref.artifactId+'.json'),'utf8'));}catch{throw new Error('ARTIFACT_NOT_FOUND');}
  if(manifest.ownerId!==ownerId||['artifactId','contentHash','schemaId','schemaVersion','contentVersion'].some(k=>manifest.ref[k]!==ref[k]))throw new Error('ARTIFACT_NOT_FOUND');
  const bytes=await readFile(file);if(bytes.length!==manifest.sizeBytes||hash(bytes)!==ref.contentHash)throw new Error('ARTIFACT_CORRUPT');
  return {file,bytes,manifest};
}
async function compute(ownerId,request,signal) {
  const input=await resolve(ownerId,request.input);
  const chunks=[];let resume=null;
  if(request.checkpoint) {
    const stored=await resolve(ownerId,request.checkpoint);resume=JSON.parse(stored.bytes.toString());
    if(resume.format!=='shopping.normalization.v1'||resume.inputHash!==request.input.contentHash||!Array.isArray(resume.chunks))throw new Error('CHECKPOINT_INCOMPATIBLE');
    let cursor=0;
    for(const ref of resume.chunks) { const chunk=JSON.parse((await resolve(ownerId,ref)).bytes.toString());
      if(chunk.start!==cursor||chunk.cursor!==chunk.start+chunk.norms.length)throw new Error('CHECKPOINT_INVALID');cursor=chunk.cursor;chunks.push(ref); }
    if(cursor!==resume.cursor)throw new Error('CHECKPOINT_INVALID');
  }
  const cancelFlag=new SharedArrayBuffer(4),flag=new Int32Array(cancelFlag);
  const cancel=()=>Atomics.store(flag,0,1);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  return new Promise((resolveResult,reject)=> {
    const worker=new Worker(new URL('./compute.mjs',import.meta.url),{workerData:{path:input.file,inputHash:request.input.contentHash,
      capability:request.capability,parameters:request.parameters??{},cancelFlag,resume},resourceLimits:{maxOldGenerationSizeMb:128}});
    let result,error,checkpointRef=request.checkpoint;let publications=Promise.resolve();
    worker.on('message',message=>{
      publications=publications.then(async()=> {
        if(message.error) { error=new Error(message.error);return; }
        if(message.chunk) {
          const ref=await put(ownerId,Buffer.from(JSON.stringify(message.chunk)),'shopping.normalization-block');chunks.push(ref);
          const checkpoint={format:'shopping.normalization.v1',inputHash:request.input.contentHash,cursor:message.chunk.cursor,chunks,
            indexSnapshotId:message.chunk.indexSnapshotId,modelVersion:message.chunk.modelVersion,dimension:message.chunk.dimension};
          checkpointRef=await put(ownerId,Buffer.from(JSON.stringify(checkpoint)),'shopping.normalization');
          // Publish checkpoint before acknowledging cursor advance. A crash leaves only an orphan block.
          const lease=manager.require(ownerId,request.leaseId);lease.checkpointRef=checkpointRef;await persist();worker.postMessage({ack:true});
        }
        if(message.result) {
          result=message.result;
          if(result.bytes) { const artifact=await put(ownerId,Buffer.from(result.bytes),'shopping.image',result.mediaType);delete result.bytes;result.artifact=artifact; }
          result.checkpointRef=checkpointRef;result.inputHash=request.input.contentHash;result.executorId='cpu-worker';result.instanceId=instanceId;
        }
      }).catch(failure=>{error=failure;cancel();worker.postMessage({ack:false});});
    });
    worker.once('error',failure=>{error=failure;});
    worker.once('exit',async code=>{await publications;signal.removeEventListener('abort',cancel);
      // Physical settlement, not the result message, releases admission.
      if(error||code!==0||!result)reject(error??new Error('WORKER_EXITED'));else resolveResult(result);
    });
  });
}
async function body(req,binary=false) {const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw new Error('BODY_TOO_LARGE');chunks.push(chunk);}const bytes=Buffer.concat(chunks);return binary?bytes:JSON.parse(bytes.toString()||'{}');}
const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try {
    const supplied=String(req.headers.authorization??'').replace(/^Bearer /,'');
    if(!timingSafeEqual(Buffer.from(hash(supplied),'hex'),Buffer.from(hash(token),'hex')))return send(401,{error:'UNAUTHORIZED'});
    const ownerId=String(req.headers['x-owner-id']??'');if(!/^[\w.-]{1,128}$/.test(ownerId))throw new Error('OWNER_REQUIRED');
    const route=req.url;
    if(req.method==='GET'&&route==='/v1/descriptor')return send(200,{protocolVersion:1,deviceId:process.env.WORKER_DEVICE_ID??'cpu-worker',instanceId,adapterVersion:'1',
      source:'REAL',resourceDomain:'cpu-worker-process',capacity:{slots:Math.max(0,manager.slots-[...manager.leases.values()].filter(l=>!l.settled).length),memoryBytes:Math.max(0,manager.memoryBytes-[...manager.leases.values()].filter(l=>!l.settled).reduce((sum,l)=>sum+l.memoryBytes,0))},
      capabilities:['image.crop.v1','vector.normalize.v1'],checkpointFormats:['shopping.normalization.v1'],observedAt:Date.now(),ttlMs:3000});
    if(req.method==='POST'&&route==='/v1/artifacts') {
      const schemaId=req.headers['x-schema-id'];if(!['shopping.image','shopping.normalization-input'].includes(schemaId))throw new Error('SCHEMA_UNSUPPORTED');
      return send(201,await put(ownerId,await body(req,true),schemaId,String(req.headers['content-type']??'application/octet-stream')));
    }
    if(req.method==='POST'&&route==='/v1/artifacts/resolve') {const value=await resolve(ownerId,await body(req));res.writeHead(200,{'Content-Type':value.manifest.mediaType});return res.end(value.bytes);}
    if(req.method==='POST'&&route==='/v1/leases') {const receipt=manager.acquire({...await body(req),ownerId});await persist();return send(201,receipt);}
    if(req.method==='POST'&&route==='/v1/execute') {
      const data=await body(req);
      if(data.privacy!=='AUTHORIZED_REMOTE'||data.networkAllowed!==true)throw new Error('TRANSFER_NOT_AUTHORIZED');
      if(!['image.crop.v1','vector.normalize.v1'].includes(data.capability))throw new Error('CAPABILITY_UNSUPPORTED');
      const lease=manager.require(ownerId,data.leaseId);
      if(lease.memoryBytes<(data.capability==='image.crop.v1'?128:32)*1024*1024)throw new Error('MEMORY_RESERVATION_TOO_SMALL');
      await resolve(ownerId,data.input);
      const identity=hash(JSON.stringify({capability:data.capability,input:data.input,parameters:data.parameters,checkpoint:data.checkpoint}));
      const receipt=manager.execute(ownerId,data.leaseId,data.fencingToken,identity,async signal=>{await persist();return compute(ownerId,data,signal);});
      await persist();return send(202,receipt);
    }
    if(req.method==='POST'&&route==='/v1/query') {const data=await body(req),lease=manager.require(ownerId,data.leaseId);await persist();return send(200,{...manager.receipt(lease),checkpointRef:lease.checkpointRef??null});}
    if(req.method==='POST'&&route==='/v1/cancel') {const data=await body(req),receipt=manager.cancel(ownerId,data.leaseId);await persist();return send(200,receipt);}
    if(req.method==='POST'&&route==='/v1/release') {const data=await body(req);manager.release(ownerId,data.leaseId);await persist();return send(200,{released:true});}
    send(404,{error:'NOT_FOUND'});
  }catch(error){send(409,{error:/^[A-Z0-9_]{1,100}$/.test(error?.message)?error.message:'WORKER_REQUEST_FAILED'});}
});
const sweep=setInterval(()=>{manager.sweep();void persist().catch(()=>{});},1000);sweep.unref();
server.listen(Number(process.env.WORKER_PORT??3020),process.env.WORKER_HOST??'127.0.0.1',()=>console.log(JSON.stringify({ready:true,port:server.address().port,instanceId})));
