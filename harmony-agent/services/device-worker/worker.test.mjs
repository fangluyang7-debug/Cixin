import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { LeaseManager } from './lease-manager.mjs';

test('expired/cancelled noncooperative work retains the physical slot and cannot publish', async()=>{
  let now=0,finish;const manager=new LeaseManager({clock:()=>now});
  const a=manager.acquire({ownerId:'a',attemptId:'attempt_a',memoryBytes:32,remainingBudgetMs:10});
  manager.execute('a',a.leaseId,a.fencingToken,'input',()=>new Promise(resolve=>{finish=resolve;}));
  await Promise.resolve();now=11;manager.sweep();
  assert.equal(manager.require('a',a.leaseId).state,'STOP_REQUESTED');
  assert.throws(()=>manager.acquire({ownerId:'a',attemptId:'attempt_b',memoryBytes:32,remainingBudgetMs:10}),/CAPACITY_FULL/);
  assert.throws(()=>manager.release('a',a.leaseId),/STOP_UNCONFIRMED/);
  finish({late:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(manager.require('a',a.leaseId).output,undefined);
  assert.equal(manager.require('a',a.leaseId).settled,true);
  manager.acquire({ownerId:'a',attemptId:'attempt_b',memoryBytes:32,remainingBudgetMs:10});
});

test('real HTTP CPU worker: admission, binary artifacts, normalization checkpoints and crop parity',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'harmony-worker-test-')),token=randomBytes(32).toString('hex');
  let child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{
    env:{...process.env,WORKER_TOKEN:token,WORKER_PORT:'0',WORKER_DATA_DIR:directory},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let logs='';child.stderr.on('data',b=>logs+=b);
  try {
    const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('worker startup timeout '+logs)),10000);
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('worker exited '+logs));});child.stdout.on('data',b=>{text+=b;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]).port);}});});
    let base='http://127.0.0.1:'+port;
    const request=async(route,value,owner='owner',binary=false,schema='shopping.normalization-input')=>{
      const response=await fetch(base+'/v1/'+route,{method:route==='descriptor'?'GET':'POST',headers:{Authorization:'Bearer '+token,'x-owner-id':owner,
        'Content-Type':binary?'application/octet-stream':'application/json','x-schema-id':schema},body:route==='descriptor'?undefined:binary?value:JSON.stringify(value)});
      const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
    assert.deepEqual((await request('descriptor')).capabilities,['image.crop.v1','vector.normalize.v1']);
    const bytes=Buffer.from(JSON.stringify({indexSnapshotId:'index-1',modelVersion:'test-v1',dimension:2,rows:Array.from({length:600},()=>[3,4])}));
    const input=await request('artifacts',bytes,'owner',true);
    await assert.rejects(request('artifacts/resolve',input,'intruder'),/ARTIFACT_NOT_FOUND/);
    const lease=await request('leases',{attemptId:'normalization-1',memoryBytes:32*1024*1024,remainingBudgetMs:10000});
    await assert.rejects(request('leases',{attemptId:'competitor',memoryBytes:32*1024*1024,remainingBudgetMs:10000}),/CAPACITY_FULL/);
    const execution={leaseId:lease.leaseId,fencingToken:lease.fencingToken,capability:'vector.normalize.v1',input,privacy:'AUTHORIZED_REMOTE',networkAllowed:true};
    await request('execute',execution);await request('execute',execution);
    async function settled(id){for(let i=0;i<500;i++){const r=await request('query',{leaseId:id});if(r.settled)return r;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('settlement timeout');}
    const receipt=await settled(lease.leaseId);assert.equal(receipt.errorCode,null);assert.equal(receipt.output.cursor,600);assert.equal(receipt.output.inputHash,input.contentHash);
    const checkpoint=await request('artifacts/resolve',receipt.checkpointRef);assert.equal(checkpoint.chunks.length,3);
    const first=await request('artifacts/resolve',checkpoint.chunks[0]);assert.equal(first.norms.length,256);assert.ok(first.norms.every(n=>n===5));
    await request('release',{leaseId:lease.leaseId});
    const second=await request('leases',{attemptId:'resume-1',memoryBytes:32*1024*1024,remainingBudgetMs:10000});
    const changed=await request('artifacts',Buffer.from(bytes.toString().replace('[3,4]','[4,3]')),'owner',true);
    await request('execute',{...execution,leaseId:second.leaseId,fencingToken:second.fencingToken,input:changed,checkpoint:receipt.checkpointRef});
    assert.equal((await settled(second.leaseId)).errorCode,'CHECKPOINT_INCOMPATIBLE');await request('release',{leaseId:second.leaseId});
    const image=await sharp({create:{width:64,height:64,channels:3,background:{r:80,g:120,b:40}}}).png().toBuffer();
    const imageRef=await request('artifacts',image,'owner',true,'shopping.image');
    const cropLease=await request('leases',{attemptId:'crop-1',memoryBytes:128*1024*1024,remainingBudgetMs:10000});
    await request('execute',{...execution,leaseId:cropLease.leaseId,fencingToken:cropLease.fencingToken,input:imageRef,capability:'image.crop.v1',parameters:{box:{x:0,y:0,width:1,height:1},paddingRatio:0,targetSize:48,jpegQuality:90}});
    const crop=(await settled(cropLease.leaseId)).output;
    const expected=await sharp(image).extract({left:0,top:0,width:64,height:64}).resize({width:48,height:48,fit:'contain',background:{r:245,g:245,b:245,alpha:1}}).jpeg({quality:90,mozjpeg:true}).toBuffer();
    assert.equal(crop.artifact.contentHash,createHash('sha256').update(expected).digest('hex'));
    await request('release',{leaseId:cropLease.leaseId});
    const duplicate=await request('leases',{attemptId:'crop-1',memoryBytes:128*1024*1024,remainingBudgetMs:10000});
    assert.equal(duplicate.leaseId,cropLease.leaseId);assert.equal(duplicate.settled,true);
    child.kill();await new Promise(resolve=>child.once('exit',resolve));
    child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{env:{...process.env,WORKER_TOKEN:token,WORKER_PORT:'0',WORKER_DATA_DIR:directory},stdio:['ignore','pipe','pipe'],windowsHide:true});
    const nextPort=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('restart timeout')),10000);
      child.stdout.on('data',bytes=>{output+=bytes;if(output.includes('\n')){clearTimeout(timer);resolve(JSON.parse(output.split('\n')[0]).port);}});});
    base='http://127.0.0.1:'+nextPort;
    assert.equal((await request('query',{leaseId:cropLease.leaseId})).output.artifact.contentHash,crop.artifact.contentHash);
    const resume=await request('leases',{attemptId:'resume-after-restart',memoryBytes:32*1024*1024,remainingBudgetMs:10000});
    await request('execute',{...execution,leaseId:resume.leaseId,fencingToken:resume.fencingToken,checkpoint:receipt.checkpointRef});
    const resumed=await settled(resume.leaseId);assert.equal(resumed.errorCode,null);assert.equal(resumed.output.cursor,600);
    assert.equal((await request('artifacts/resolve',resumed.output.checkpointRef)).chunks.length,3);

  } finally {
    child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
    if(path.dirname(path.resolve(directory))===path.resolve(tmpdir())&&path.basename(directory).startsWith('harmony-worker-test-'))await rm(directory,{recursive:true,force:true});
  }
});
