import { chooseRecovery } from './recovery-policy';
import { PerformanceRegistryService } from './performance-registry.service';
import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RuntimeWorkScope } from './runtime-work-scope';
import { WorkflowPlacementPlanner, PlacementCandidate, PlacementRollout, authorizePlacement } from './workflow-placement-planner';
import { ArtifactRef } from './scheduling-protocol';
import { QueryImageCropResult } from '../../modules/sessions/application/query-image-content-adapter.interface';

interface DeviceConfiguration { deviceId:string;endpoint:string;tokenEnv:string;enabled:boolean;qualityVerified:boolean;cropPriorMs:number; }
interface Descriptor {protocolVersion:number;deviceId:string;instanceId:string;adapterVersion:string;capabilities:string[];capacity:{slots:number;memoryBytes:number};}
interface Receipt {leaseId:string;fencingToken:number;state:string;settled:boolean;stopRequested:boolean;executionMs:number|null;errorCode:string|null;
  output:null|{artifact:ArtifactRef;metadata:QueryImageCropResult['metadata'];cropRegionPx:QueryImageCropResult['cropRegionPx'];strategy:string;inputHash:string;};}
interface Sample {bytes?:number;count:number;mean:number;deviation:number;failures:number;observedAt:number;}

@Injectable()
export class DeviceDispatchService {
  constructor(@Optional() private readonly performanceRegistry?: PerformanceRegistryService) {}
  private readonly samples=new Map<string,Sample>();
  private readonly planner=new WorkflowPlacementPlanner();
  private readonly circuits=new Map<string,{failures:number;retryAt:number}>();
  private readonly decisions:unknown[]=[];
  recentDecisions():unknown[]{return this.decisions.slice();}
  private devices():DeviceConfiguration[] {
    const values=JSON.parse(process.env.RUNTIME_DEVICES_JSON??'[]') as DeviceConfiguration[];
    if(!Array.isArray(values)||values.length>32)throw new Error('DEVICE_CONFIG_INVALID');
    const seen=new Set<string>();
    return values.filter(value=>value.enabled).map(value=>{
      const url=new URL(value.endpoint);
      if(!/^[\w.-]{1,128}$/.test(value.deviceId)||seen.has(value.deviceId)||!/^\w{1,128}$/.test(value.tokenEnv)||
        (url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash||
        !Number.isFinite(value.cropPriorMs)||value.cropPriorMs<=0)throw new Error('DEVICE_CONFIG_INVALID');
      seen.add(value.deviceId);return {...value,endpoint:value.endpoint.replace(/\/$/,'')};
    });
  }
  private async call<T>(device:DeviceConfiguration,ownerId:string,path:string,body:unknown,signal:AbortSignal,binary=false):Promise<T> {
    const token=process.env[device.tokenEnv];if(!token||token.length<32)throw new Error('DEVICE_CREDENTIAL_MISSING');
    const response=await fetch(device.endpoint+'/v1/'+path,{method:path==='descriptor'?'GET':'POST',redirect:'error',signal,
      headers:{Authorization:'Bearer '+token,'x-owner-id':ownerId,'Content-Type':binary?'application/octet-stream':'application/json','x-schema-id':'shopping.image'},
      body:path==='descriptor'?undefined:binary?new Uint8Array(body as Uint8Array).buffer:JSON.stringify(body)});
    if(!response.ok){const failure=await response.json() as {error?:string};throw new Error(failure.error&&/^[A-Z0-9_]{1,100}$/.test(failure.error)?failure.error:'DEVICE_HTTP_FAILED');}
    return (path==='artifacts/resolve'?Buffer.from(await response.arrayBuffer()):await response.json()) as T;
  }
  private key(deviceId:string,bytes:number,parameters:unknown):string{return `crop:v1:${deviceId}:${Math.floor(Math.log2(Math.max(1,bytes)))}:${createHash('sha256').update(JSON.stringify(parameters)).digest('hex').slice(0,16)}`;}
  private observe(key:string,ms:number,success:boolean,bytes?:number):void {
    if(!Number.isFinite(ms)||ms<0)return;
    const old=this.samples.get(key)??{count:0,mean:ms,deviation:0,failures:0,observedAt:Date.now()};
    if(success){old.deviation=.75*old.deviation+.25*Math.abs(ms-old.mean);old.mean=.75*old.mean+.25*ms;old.count++;}else old.failures++;
    if(bytes!==undefined) old.bytes=bytes;
    old.observedAt=Date.now();this.samples.set(key,old);if(this.samples.size>256)this.samples.delete(this.samples.keys().next().value!);
  }
  async crop<T extends QueryImageCropResult>(bytes:Buffer,parameters:{box:{x:number;y:number;width:number;height:number};paddingRatio:number;targetSize:number;jpegQuality:number},
    local:()=>Promise<T>):Promise<QueryImageCropResult> {
    parameters = { box: parameters.box, paddingRatio: parameters.paddingRatio, targetSize: parameters.targetSize, jpegQuality: parameters.jpegQuality };
    const devices=this.devices(),ownerId=RuntimeWorkScope.ownerId();
    const baseline=async()=>{const start=performance.now();try{const value=await local();this.observe(this.key('cloud-runtime',bytes.length,parameters),performance.now()-start,true);return value;}
      catch(error){this.observe(this.key('cloud-runtime',bytes.length,parameters),performance.now()-start,false);throw error;}};
    if(!ownerId||!devices.length)return baseline();
    const budget = RuntimeWorkScope.remainingBudget(60000);
    if (budget <= 0) throw new Error('DEADLINE_EXCEEDED');
    const signal=RuntimeWorkScope.signal(Math.max(1,Math.ceil(budget))),now=Date.now();
    const config:PlacementRollout=JSON.parse(process.env.PLACEMENT_POLICY_JSON??JSON.stringify({mode:'OBSERVE',policyVersion:'placement-v1',expiresAt:0,killSwitch:true,
      allowedDevices:[],allowedCapabilities:[],sampleCount:0,minimumSamples:30,qualityPassed:false,nonInferiorityPassed:false,failureRate:0,maximumFailureRate:0.05,cohortAllowed:false}));
    const localSample=this.samples.get(this.key('cloud-runtime',bytes.length,parameters));
    if(!localSample||localSample.count<3) { RuntimeWorkScope.recordPlacement({actualDeviceId:'cloud-runtime',reason:'BASELINE_COST_CALIBRATION',mode:config.mode}); return baseline(); }
    const candidates:PlacementCandidate[]=[{deviceId:'cloud-runtime',executorId:'zeabur-shopping-workflow',capability:'image.crop.v1',trusted:true,source:'REAL',observedAt:now,ttlMs:3000,
      availableSlots:1,availableMemoryBytes:256*1024*1024,quality:1,computeMs:localSample?.mean??60000,queueMs:0,coldMs:0,uncertaintyMs:localSample?2*localSample.deviation:0,publishMs:0}];
    const links:Parameters<WorkflowPlacementPlanner['plan']>[0]['links']=[];
    for(const device of devices){
      const circuit=this.circuits.get(device.deviceId);
      if(circuit&&circuit.failures>=3&&now<circuit.retryAt)continue;
      try {
        const before=performance.now(),descriptor=await this.call<Descriptor>(device,ownerId,'descriptor',null,AbortSignal.any([signal,AbortSignal.timeout(1500)]));
        const rtt=performance.now()-before;
        this.circuits.delete(device.deviceId);
        if(descriptor.protocolVersion!==1||descriptor.deviceId!==device.deviceId||descriptor.adapterVersion!=='1'||!descriptor.capabilities.includes('image.crop.v1'))continue;
        const sample=this.samples.get(this.key(device.deviceId,bytes.length,parameters));
        candidates.push({deviceId:device.deviceId,executorId:'cpu-worker',capability:'image.crop.v1',trusted:true,source:'REAL',observedAt:now,ttlMs:3000,
          availableSlots:descriptor.capacity.slots,availableMemoryBytes:descriptor.capacity.memoryBytes,quality:device.qualityVerified?1:null,
          computeMs:sample?.mean??device.cropPriorMs,queueMs:0,coldMs:0,uncertaintyMs:sample?sample.deviation*2:device.cropPriorMs,publishMs:0});
        // No bandwidth is inferred from a small handshake. Only confirmed transfer samples authorize a route.
        const transfer=this.samples.get(this.key(device.deviceId+':transfer',bytes.length,parameters));
        if(transfer&&transfer.count>=3&&now-transfer.observedAt<30000){
          links.push({from:'cloud-runtime',to:device.deviceId,bytesPerSecond:bytes.length/Math.max(1,transfer.mean)*1000,fixedMs:rtt,effective:true,source:'REAL',observedAt:transfer.observedAt,ttlMs:30000});
          const download=this.samples.get(this.key(device.deviceId+':download',bytes.length,parameters));
          if(download&&download.count>=3)links.push({from:device.deviceId,to:'cloud-runtime',bytesPerSecond:(download.bytes??bytes.length)/Math.max(1,download.mean)*1000,fixedMs:rtt,effective:true,source:'REAL',observedAt:download.observedAt,ttlMs:30000});
        }
      }catch{this.circuits.set(device.deviceId,{failures:(this.circuits.get(device.deviceId)?.failures??0)+1,retryAt:now+30000});}
    }
    const nodes: Parameters<WorkflowPlacementPlanner['plan']>[0]['nodes']=[{id:'crop',capability:'image.crop.v1',dependencies:[],inputs:['image'],
      output:{id:'crop-image',bytes:parameters.targetSize*parameters.targetSize*4+65536},baselineDeviceId:'cloud-runtime',memoryBytes:128*1024*1024,minimumQuality:1,candidates}];
    // The current image graph is serial. Keep the committed prefix fixed and price the entire remaining suffix.
    // Downstream costs must come from confirmed executions, never the crop's timing or a handshake.
    let downstreamKnown=true,previous='crop',previousOutput='crop-image';
    for (const stage of ['category','product-profile','embedding','vector-search','price-stock','rank','answer','result']) {
      const sample=this.performanceRegistry?.get('shopping.stage.'+stage,'zeabur-shopping-workflow');
      if(!sample||sample.sampleCount<3||sample.p95LatencyMs===null||Date.now()-Date.parse(sample.measuredAt)>300000){downstreamKnown=false;break;}
      nodes.push({id:stage,capability:'shopping.stage.'+stage,dependencies:[previous],inputs:[previousOutput],output:{id:stage+'-output',bytes:1024*1024},
        baselineDeviceId:'cloud-runtime',memoryBytes:0,minimumQuality:0,candidates:[{...candidates[0],capability:'shopping.stage.'+stage,computeMs:sample.p95LatencyMs,uncertaintyMs:sample.p95LatencyMs*.15}]});
      previous=stage;previousOutput=stage+'-output';
    }
    const decision=this.planner.plan({nodes,artifacts:[{id:'image',bytes:bytes.length,replicas:[{deviceId:'cloud-runtime',readMs:0}]}],
      links,remainingBudgetMs:RuntimeWorkScope.remainingBudget(60000),networkAllowed:true,privacy:'AUTHORIZED_REMOTE',localDeviceId:'cloud-runtime',now,
      committedNodeIds:[],committedArtifacts:[],finalDestination:'cloud-runtime'});
    const gated=downstreamKnown?config:{...config,mode:'SHADOW' as const};
    const actual=authorizePlacement(decision,gated,'image.crop.v1',now)?.[0];
    RuntimeWorkScope.recordPlacement({decision,actualDeviceId:actual?.deviceId??null,policyVersion:config.policyVersion,mode:config.mode,
      dispatchBlockedReason:downstreamKnown?null:'SUFFIX_COST_SAMPLES_MISSING',outputSizeSource:'schema-and-crop-upper-bound'});
    this.decisions.push({decision,actualDeviceId:actual?.deviceId??null,policyVersion:config.policyVersion,mode:config.mode});if(this.decisions.length>64)this.decisions.shift();
    if(!actual)throw new Error('NO_LEGAL_PLACEMENT');
    if(actual.deviceId==='cloud-runtime')return baseline();
    const device=devices.find(d=>d.deviceId===actual.deviceId)!;
    try { return await this.executeCrop(device,ownerId,bytes,parameters,signal); }
    catch (error) {
      signal.throwIfAborted();
      if ((error as Error).message === 'CAPACITY_FULL') return baseline();
      if (process.env.WORKFLOW_RECOVERY_ENABLED !== 'true') throw error;
      const recovery=chooseRecovery({committed:false,cancelled:signal.aborted,remainingBudgetMs:RuntimeWorkScope.remainingBudget(0),attempts:0,
        maximumAttempts:config.maximumRecoveryAttempts??0,options:[{action:'RECOMPUTE',checkpointAvailable:false,compatible:true,replaySafe:true,additionalMs:0,
          placement:{...decision,status:decision.baseline?'ready':'blocked',suggestion:decision.baseline,suggestionMs:decision.baselineMs}}]});
      RuntimeWorkScope.recordPlacement({recovery,capability:'image.crop.v1',oldReservation:'target retains until physical settlement'});
      if(recovery.action==='RECOMPUTE')return baseline();
      throw error;
    }
  }
  // Explicit calibration uses real work but cannot update business state. Called by an operator/test harness.
  async calibrate(deviceId:string,ownerId:string,bytes:Buffer,parameters:Parameters<DeviceDispatchService['crop']>[1],signal:AbortSignal):Promise<QueryImageCropResult>{
    const device=this.devices().find(d=>d.deviceId===deviceId);if(!device)throw new Error('DEVICE_NOT_REGISTERED');
    return this.executeCrop(device,ownerId,bytes,parameters,signal);
  }
  private async executeCrop(device:DeviceConfiguration,ownerId:string,bytes:Buffer,parameters:Parameters<DeviceDispatchService['crop']>[1],signal:AbortSignal):Promise<QueryImageCropResult>{
    const budget=RuntimeWorkScope.remainingBudget(60000),began=performance.now();let lease:Receipt|undefined,settled=false;
    try {
      const start=performance.now(),input=await this.call<ArtifactRef>(device,ownerId,'artifacts',bytes,signal,true);
      if(input.contentHash!==createHash('sha256').update(bytes).digest('hex'))throw new Error('INPUT_HASH_MISMATCH');
      this.observe(this.key(device.deviceId+':transfer',bytes.length,parameters),performance.now()-start,true);
      lease=await this.call<Receipt>(device,ownerId,'leases',{attemptId:'attempt_'+randomUUID(),memoryBytes:128*1024*1024,remainingBudgetMs:Math.max(0,budget-(performance.now()-began))},signal);
      await this.call(device,ownerId,'execute',{leaseId:lease.leaseId,fencingToken:lease.fencingToken,capability:'image.crop.v1',input,parameters,privacy:'AUTHORIZED_REMOTE',networkAllowed:true},signal);
      while(performance.now()-began<budget){
        if (!this.devices().some(d=>d.deviceId===device.deviceId&&d.endpoint===device.endpoint&&d.tokenEnv===device.tokenEnv)) throw new Error('DEVICE_REVOKED');
        const receipt=await this.call<Receipt>(device,ownerId,'query',{leaseId:lease.leaseId},signal);
        if(receipt.settled){settled=true;if(receipt.errorCode||receipt.stopRequested||!receipt.output)throw new Error(receipt.errorCode??'WORKER_STOPPED');
          const downloadAt=performance.now(),output=await this.call<Buffer>(device,ownerId,'artifacts/resolve',receipt.output.artifact,signal);
          if(createHash('sha256').update(output).digest('hex')!==receipt.output.artifact.contentHash||receipt.output.inputHash!==input.contentHash)throw new Error('OUTPUT_HASH_MISMATCH');
          // Size-specific sample, never a simulated latency label.
          this.observe(this.key(device.deviceId+':download',bytes.length,parameters),performance.now()-downloadAt,true,output.length);
          this.observe(this.key(device.deviceId,bytes.length,parameters),receipt.executionMs??performance.now()-began,true);
          return {buffer:output,metadata:receipt.output.metadata,cropRegionPx:receipt.output.cropRegionPx,strategy:receipt.output.strategy};}
        await new Promise(resolve=>setTimeout(resolve,20));signal.throwIfAborted();
      }throw new Error('WORKER_STOP_UNCONFIRMED');
    }catch(error){this.observe(this.key(device.deviceId,bytes.length,parameters),performance.now()-began,false);throw error;}
    finally {
      if(lease){const cleanup=AbortSignal.timeout(3000);try{if(!settled)await this.call(device,ownerId,'cancel',{leaseId:lease.leaseId},cleanup);
        else await this.call(device,ownerId,'release',{leaseId:lease.leaseId},cleanup);}catch{/* Keep unconfirmed reservations at the target; never claim they were released. */}}
    }
  }
}
