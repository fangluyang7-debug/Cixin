import { WorkflowPlacementPlanner, PlacementCandidate, PlacementRequest, authorizePlacement, PlacementRollout } from '../../src/core/runtime/workflow-placement-planner';
const now=10000;
const candidate=(deviceId:string,computeMs:number):PlacementCandidate=>({deviceId,executorId:deviceId,capability:'crop',trusted:true,source:'REAL',
  observedAt:now,ttlMs:3000,availableSlots:1,availableMemoryBytes:100,quality:1,computeMs,queueMs:0,coldMs:0,publishMs:0,uncertaintyMs:0});
function fixture():PlacementRequest{return {nodes:[{id:'a',capability:'crop',dependencies:[],inputs:['input'],output:{id:'out-a',bytes:1000},baselineDeviceId:'cloud',memoryBytes:10,minimumQuality:1,candidates:[candidate('cloud',100),candidate('pc',1)]},
  {id:'b',capability:'crop',dependencies:['a'],inputs:['out-a'],output:{id:'out-b',bytes:10},baselineDeviceId:'cloud',memoryBytes:10,minimumQuality:1,candidates:[candidate('cloud',100),candidate('pc',1)]}],
  artifacts:[{id:'input',bytes:100,replicas:[{deviceId:'cloud',readMs:0}]}],links:[{from:'cloud',to:'pc',bytesPerSecond:1000,fixedMs:0,effective:true,source:'REAL',observedAt:now,ttlMs:3000},
    {from:'pc',to:'cloud',bytesPerSecond:100,fixedMs:0,effective:true,source:'REAL',observedAt:now,ttlMs:3000}],remainingBudgetMs:1000,networkAllowed:true,privacy:'AUTHORIZED_REMOTE',localDeviceId:'cloud',now,committedNodeIds:[],committedArtifacts:[],finalDestination:'cloud'};}
describe('bounded data-location planner',()=>{
  it('compares downstream transfer and uses separate return direction',()=>{
    const request=fixture(),result=new WorkflowPlacementPlanner().plan(request);
    // pc a+b: 100 upload +2 compute +100 final download =202; baseline=200.
    expect(result.suggestion?.map(a=>a.deviceId)).toEqual(['cloud','cloud']);expect(result.baselineMs).toBe(200);
    request.links[1].bytesPerSecond=1000;
    expect(new WorkflowPlacementPlanner().plan(request).suggestion?.map(a=>a.deviceId)).toEqual(['pc','pc']);
  });
  it('uses legal alternatives when baseline is unavailable and otherwise blocks',()=>{
    const request=fixture();request.nodes.forEach(n=>n.candidates[0].trusted=false);
    const result=new WorkflowPlacementPlanner().plan(request);expect(result.baseline).toBeNull();expect(result.status).toBe('ready');
    request.privacy='LOCAL_ONLY';expect(new WorkflowPlacementPlanner().plan(request).status).toBe('blocked');
  });
  it('keeps a committed prefix fixed and rejects stale/unknown observations',()=>{
    const request=fixture();request.committedNodeIds=['a'];request.committedArtifacts=[{id:'out-a',bytes:1000,replicas:[{deviceId:'pc',readMs:0}]}];
    const result=new WorkflowPlacementPlanner().plan(request);expect(result.suggestion?.map(a=>a.nodeId)).toEqual(['b']);
    request.nodes[1].candidates[1].computeMs=null;request.nodes[1].candidates[0].observedAt=0;
    expect(new WorkflowPlacementPlanner().plan(request).rejections.map(r=>r.code)).toEqual(expect.arrayContaining(['COST_UNKNOWN','OBSERVATION_EXPIRED']));
  });
  it('has deterministic pruning and a bounded fallback',()=>{
    const request=fixture(),planner=new WorkflowPlacementPlanner();const first=planner.plan(request);
    request.nodes.forEach(n=>n.candidates.reverse());expect(planner.plan(request).suggestion).toEqual(first.suggestion);
    let time=0;const limited=new WorkflowPlacementPlanner({maxCandidates:8,lookahead:16,beamWidth:4,planningBudgetMs:1,switchCostMs:0,hysteresisMs:0},()=>time++);
    expect(limited.plan(request).reason).toBe('PLANNING_BUDGET_BASELINE');
  });
  it('does not dispatch shadow suggestions and respects independent rollout gates',()=>{
    const request=fixture();request.links[1].bytesPerSecond=1000;const decision=new WorkflowPlacementPlanner().plan(request);
    const config:PlacementRollout={mode:'SHADOW',policyVersion:'p1',expiresAt:now+1,killSwitch:false,allowedDevices:['cloud','pc'],allowedCapabilities:['crop'],sampleCount:30,minimumSamples:30,
      qualityPassed:true,nonInferiorityPassed:true,failureRate:0,maximumFailureRate:.05,cohortAllowed:true};
    expect(authorizePlacement(decision,config,'crop',now)).toEqual(decision.baseline);
    config.mode='CANARY';expect(authorizePlacement(decision,config,'crop',now)).toEqual(decision.suggestion);
    config.killSwitch=true;expect(authorizePlacement(decision,config,'crop',now)).toEqual(decision.baseline);
  });
});
