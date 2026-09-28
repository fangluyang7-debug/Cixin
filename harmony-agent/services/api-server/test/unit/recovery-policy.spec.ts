import { chooseRecovery, RecoveryOption } from '../../src/core/runtime/recovery-policy';
import { WorkflowPlacementDecision } from '../../src/core/runtime/workflow-placement-planner';
const option=(action:RecoveryOption['action'],cost:number):RecoveryOption=>({action,checkpointAvailable:true,compatible:true,replaySafe:true,additionalMs:0,
  placement:{status:'ready',suggestionMs:cost} as WorkflowPlacementDecision});
const base={committed:false,cancelled:false,remainingBudgetMs:100,attempts:0,maximumAttempts:2};
it('compares remaining completion cost, including checkpoint movement',()=>{
  expect(chooseRecovery({...base,options:[option('RESUME',80),option('RECOMPUTE',50)]}).action).toBe('RECOMPUTE');
  expect(chooseRecovery({...base,options:[option('RESUME',20),option('RECOMPUTE',50)]}).action).toBe('RESUME');
});
it('commit wins, cancellation never retries, missing or incompatible checkpoints never resume',()=>{
  expect(chooseRecovery({...base,committed:true,cancelled:true,options:[]}).action).toBe('COMMITTED');
  expect(chooseRecovery({...base,cancelled:true,options:[option('RESUME',1)]}).action).toBe('FAIL');
  expect(chooseRecovery({...base,options:[{...option('RESUME',1),checkpointAvailable:false}]}).action).toBe('FAIL');
  expect(chooseRecovery({...base,options:[{...option('RESUME',1),compatible:false},option('WAIT',10)]}).action).toBe('WAIT');
  expect(chooseRecovery({...base,remainingBudgetMs:1,options:[option('RECOMPUTE',50)]}).action).toBe('FAIL');
});
