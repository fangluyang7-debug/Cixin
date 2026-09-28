import { performance } from 'node:perf_hooks';
import { ModelCompatibility, compatibleModel } from './scheduling-protocol';

export interface PlacementReplica { deviceId: string; readMs: number | null; }
export interface PlacementArtifact { id: string; bytes: number; replicas: PlacementReplica[]; }
export interface PlacementLink { from: string; to: string; bytesPerSecond: number; fixedMs: number; effective: boolean; observedAt: number; ttlMs: number; source: 'REAL' | 'MOCK'; }
export interface PlacementCandidate {
  deviceId: string; executorId: string; capability: string; trusted: boolean; source: 'REAL' | 'MOCK';
  observedAt: number; ttlMs: number; availableSlots: number; availableMemoryBytes: number;
  quality: number | null; computeMs: number | null; queueMs: number | null; coldMs: number | null;
  uncertaintyMs: number; publishMs: number; model?: ModelCompatibility;
}
export interface PlacementNode {
  id: string; capability: string; dependencies: string[]; inputs: string[]; output: { id: string; bytes: number };
  baselineDeviceId: string; memoryBytes: number; minimumQuality: number; model?: ModelCompatibility;
  candidates: PlacementCandidate[];
}
export interface PlacementRequest {
  nodes: PlacementNode[]; artifacts: PlacementArtifact[]; links: PlacementLink[]; remainingBudgetMs: number;
  networkAllowed: boolean; privacy: 'LOCAL_ONLY' | 'AUTHORIZED_REMOTE'; localDeviceId: string;
  now: number; committedNodeIds: string[]; committedArtifacts: PlacementArtifact[];
  finalDestination?: string;
}
export interface PlannerLimits { maxCandidates: number; lookahead: number; beamWidth: number; planningBudgetMs: number; switchCostMs: number; hysteresisMs: number; }
export interface PlannerAssignment { nodeId: string; deviceId: string; executorId: string; inputTransferMs: number; executionMs: number; uncertaintyMs: number; }
export interface PlannerRejection { nodeId: string; deviceId: string; executorId: string; code: string; }
export interface WorkflowPlacementDecision { status: 'ready' | 'blocked'; baseline: PlannerAssignment[] | null; suggestion: PlannerAssignment[] | null;
  baselineMs: number | null; suggestionMs: number | null; rejections: PlannerRejection[]; truncated: number; planningMs: number; reason: string; }
interface Beam { assignments: PlannerAssignment[]; artifacts: Map<string, PlacementArtifact>; cost: number; }

export class WorkflowPlacementPlanner {
  constructor(private readonly limits: PlannerLimits = { maxCandidates: 8, lookahead: 16, beamWidth: 8, planningBudgetMs: 20, switchCostMs: 5, hysteresisMs: 10 },
    private readonly clock: () => number = () => performance.now()) {
    if (![limits.maxCandidates,limits.lookahead,limits.beamWidth].every(n=>Number.isSafeInteger(n)&&n>0&&n<=64) ||
      ![limits.planningBudgetMs,limits.switchCostMs,limits.hysteresisMs].every(n=>Number.isFinite(n)&&n>=0)) throw new Error('PLANNER_CONFIG_INVALID');
  }
  plan(request: PlacementRequest): WorkflowPlacementDecision {
    const started=this.clock(),rejections:PlannerRejection[]=[];let truncated=0;
    const result=(baseline:Beam|null,suggestion:Beam|null,reason:string):WorkflowPlacementDecision=>({status:suggestion?'ready':'blocked',
      baseline:baseline?.assignments??null,suggestion:suggestion?.assignments??null,baselineMs:baseline?.cost??null,suggestionMs:suggestion?.cost??null,
      rejections,truncated,planningMs:Math.max(0,this.clock()-started),reason});
    if(request.nodes.length>64||request.nodes.some(n=>n.candidates.length>64)||request.links.length>4096||request.artifacts.length+request.committedArtifacts.length>4096||!Number.isFinite(request.now))return result(null,null,'REQUEST_LIMIT_OR_CLOCK_INVALID');
    if(!Number.isFinite(request.remainingBudgetMs)||request.remainingBudgetMs<=0)return result(null,null,'BUDGET_EXHAUSTED');
    const pending=request.nodes.filter(n=>!request.committedNodeIds.includes(n.id));
    const known=new Set(request.committedNodeIds);
    for(const node of pending){if(known.has(node.id)||node.dependencies.some(id=>!known.has(id)))return result(null,null,'DEPENDENCY_ORDER_INVALID');known.add(node.id);}
    const initial:Beam={assignments:[],cost:0,artifacts:new Map([...request.artifacts,...request.committedArtifacts].map(a=>[a.id,a]))};
    const legal=new Map<string,PlacementCandidate[]>();
    for(const node of pending){
      const candidates=node.candidates.filter(c=>{const code=this.reject(node,c,request);if(code)rejections.push({nodeId:node.id,deviceId:c.deviceId,executorId:c.executorId,code});return !code;})
        .sort((a,b)=>(a.computeMs!+a.queueMs!+a.coldMs!+a.uncertaintyMs)-(b.computeMs!+b.queueMs!+b.coldMs!+b.uncertaintyMs)||a.deviceId.localeCompare(b.deviceId)||a.executorId.localeCompare(b.executorId));
      const selected=candidates.slice(0,this.limits.maxCandidates);
      const baseline=candidates.find(c=>c.deviceId===node.baselineDeviceId);
      if(baseline&&!selected.includes(baseline))selected[selected.length-1]=baseline;
      truncated+=candidates.length-selected.length;legal.set(node.id,selected);
    }
    let baseline:Beam|null=initial;
    for(const node of pending){const c=legal.get(node.id)!.find(c=>c.deviceId===node.baselineDeviceId);baseline=baseline&&c?this.extend(baseline,node,c,request):null;}
    baseline=this.finish(baseline,pending,request);
    if(pending.length>this.limits.lookahead)return result(baseline,baseline,'LOOKAHEAD_LIMIT_BASELINE');
    let beam=[initial];
    for(const node of pending){
      if(this.clock()-started>=this.limits.planningBudgetMs)return result(baseline,baseline,'PLANNING_BUDGET_BASELINE');
      const next:Beam[]=[];
      for(const state of beam)for(const c of legal.get(node.id)!){const candidate=this.extend(state,node,c,request);if(candidate)next.push(candidate);else rejections.push({nodeId:node.id,deviceId:c.deviceId,executorId:c.executorId,code:'DATA_UNREACHABLE_OR_BUDGET'});}
      beam=next.sort((a,b)=>a.cost-b.cost||JSON.stringify(a.assignments).localeCompare(JSON.stringify(b.assignments))).slice(0,this.limits.beamWidth);
      if(!beam.length)return result(baseline,baseline,baseline?'BASELINE_ONLY':'NO_LEGAL_PLAN');
    }
    const choices=beam.map(b=>this.finish(b,pending,request)).filter((b):b is Beam=>b!==null).sort((a,b)=>a.cost-b.cost);
    const best=choices[0]??baseline;
    if(baseline&&best&&baseline.cost-best.cost<=this.limits.switchCostMs+this.limits.hysteresisMs)return result(baseline,baseline,'INSUFFICIENT_SAVING');
    return result(baseline,best,best?'LEGAL_SUGGESTION':'NO_LEGAL_PLAN');
  }
  private reject(node:PlacementNode,c:PlacementCandidate,r:PlacementRequest):string|null {
    if(!c.trusted||c.source!=='REAL')return 'UNTRUSTED_OR_NON_REAL';
    if(c.capability!==node.capability)return 'CAPABILITY_UNSUPPORTED';
    if(node.model&&(!c.model||!compatibleModel(node.model,c.model)))return 'MODEL_INDEX_MISMATCH';
    if(!Number.isFinite(c.ttlMs)||!Number.isFinite(c.observedAt)||c.observedAt>r.now||r.now-c.observedAt>c.ttlMs||c.ttlMs<=0)return 'OBSERVATION_EXPIRED';
    if(c.deviceId!==r.localDeviceId&&(!r.networkAllowed||r.privacy==='LOCAL_ONLY'))return 'TRANSFER_FORBIDDEN';
    if(!Number.isFinite(node.memoryBytes)||node.memoryBytes<0||!Number.isFinite(c.availableSlots)||!Number.isFinite(c.availableMemoryBytes)||c.availableSlots<1||c.availableMemoryBytes<node.memoryBytes)return 'CAPACITY_UNAVAILABLE';
    if(!Number.isFinite(node.minimumQuality)||c.quality===null||!Number.isFinite(c.quality)||c.quality<node.minimumQuality)return 'QUALITY_UNKNOWN_OR_LOW';
    if([c.computeMs,c.queueMs,c.coldMs,c.uncertaintyMs,c.publishMs].some(n=>n===null||!Number.isFinite(n)||n<0))return 'COST_UNKNOWN';
    return null;
  }
  private transfer(artifact:PlacementArtifact,to:string,r:PlacementRequest):number|null {
    if(!Number.isSafeInteger(artifact.bytes)||artifact.bytes<0)return null;
    const choices=artifact.replicas.map(source=>{
      if(source.readMs===null||!Number.isFinite(source.readMs)||source.readMs<0)return Infinity;
      if(source.deviceId===to)return source.readMs;
      if(!r.networkAllowed||r.privacy==='LOCAL_ONLY')return Infinity;
      const link=r.links.find(l=>l.from===source.deviceId&&l.to===to&&l.source==='REAL'&&l.observedAt<=r.now&&r.now-l.observedAt<=l.ttlMs&&Number.isFinite(l.ttlMs)&&l.ttlMs>0&&
        Number.isFinite(l.bytesPerSecond)&&l.bytesPerSecond>0&&Number.isFinite(l.fixedMs)&&l.fixedMs>=0);
      return link?source.readMs+artifact.bytes/link.bytesPerSecond*1000+(link.effective?0:link.fixedMs):Infinity;
    });
    const value=Math.min(...choices);return Number.isFinite(value)?value:null;
  }
  private extend(state:Beam,node:PlacementNode,c:PlacementCandidate,r:PlacementRequest):Beam|null {
    let transfer=0;
    const artifacts=new Map(state.artifacts);
    for(const id of new Set(node.inputs)){const artifact=state.artifacts.get(id);if(!artifact)return null;const cost=this.transfer(artifact,c.deviceId,r);if(cost===null)return null;transfer+=cost;
      if(!artifact.replicas.some(replica=>replica.deviceId===c.deviceId)) artifacts.set(id,{...artifact,replicas:[...artifact.replicas,{deviceId:c.deviceId,readMs:0}]});
    }
    const execution=c.computeMs!+c.queueMs!+c.coldMs!+c.publishMs;
    const cost=state.cost+transfer+execution+c.uncertaintyMs;if(cost>r.remainingBudgetMs)return null;
    artifacts.set(node.output.id,{id:node.output.id,bytes:node.output.bytes,replicas:[{deviceId:c.deviceId,readMs:0}]});
    return {cost,artifacts,assignments:[...state.assignments,{nodeId:node.id,deviceId:c.deviceId,executorId:c.executorId,inputTransferMs:transfer,executionMs:execution,uncertaintyMs:c.uncertaintyMs}]};
  }
  private finish(state:Beam|null,nodes:PlacementNode[],r:PlacementRequest):Beam|null {
    if(!state||!r.finalDestination||!nodes.length)return state;
    const output=state.artifacts.get(nodes[nodes.length-1].output.id)!;
    const transfer=this.transfer(output,r.finalDestination,r);return transfer===null||state.cost+transfer>r.remainingBudgetMs?null:{...state,cost:state.cost+transfer};
  }
}

export interface PlacementRollout { maximumRecoveryAttempts?:number; mode:'OBSERVE'|'SHADOW'|'CANARY'|'ACTIVE';policyVersion:string;expiresAt:number;killSwitch:boolean;
  allowedDevices:string[];allowedCapabilities:string[];sampleCount:number;minimumSamples:number;qualityPassed:boolean;nonInferiorityPassed:boolean;failureRate:number;maximumFailureRate:number;cohortAllowed:boolean; }
export function authorizePlacement(decision:WorkflowPlacementDecision,config:PlacementRollout,capability:string,now:number):PlannerAssignment[]|null {
  const baseline=decision.baseline;
  if(!Number.isFinite(config.expiresAt)||!Number.isSafeInteger(config.sampleCount)||!Number.isSafeInteger(config.minimumSamples)||config.minimumSamples<1||config.sampleCount<0||!Number.isFinite(config.maximumFailureRate)||config.maximumFailureRate<0||config.maximumFailureRate>1||config.failureRate<0||!Array.isArray(config.allowedDevices)||!Array.isArray(config.allowedCapabilities)||config.killSwitch!==false||config.expiresAt<=now||!config.policyVersion||!['CANARY','ACTIVE'].includes(config.mode)||config.cohortAllowed!==true||
    config.sampleCount<config.minimumSamples||config.qualityPassed!==true||config.nonInferiorityPassed!==true||!Number.isFinite(config.failureRate)||config.failureRate>config.maximumFailureRate||
    !config.allowedCapabilities.includes(capability)||decision.suggestion?.some(a=>!config.allowedDevices.includes(a.deviceId)))return baseline;
  return decision.suggestion;
}
