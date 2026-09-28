import { WorkflowPlacementDecision } from './workflow-placement-planner';

export type RecoveryAction = 'COMMITTED' | 'RESUME' | 'RECOMPUTE' | 'WAIT' | 'FAIL';
export interface RecoveryOption {
  action: 'RESUME' | 'RECOMPUTE' | 'WAIT';
  placement: WorkflowPlacementDecision;
  checkpointAvailable: boolean;
  compatible: boolean;
  replaySafe: boolean;
  // Read/transfer costs are in placement. A checkpoint already made costs zero to make again.
  additionalMs: number;
}
export function chooseRecovery(input: { committed: boolean; cancelled: boolean; remainingBudgetMs: number;
  attempts: number; maximumAttempts: number; options: RecoveryOption[] }): { action: RecoveryAction; costMs: number | null; reason: string } {
  if (input.committed) return {action:'COMMITTED',costMs:0,reason:'COMMIT_ALREADY_EXISTS'};
  if (input.cancelled) return {action:'FAIL',costMs:null,reason:'USER_CANCELLED'};
  if (!Number.isFinite(input.remainingBudgetMs)||input.remainingBudgetMs<=0||!Number.isSafeInteger(input.attempts)||
    !Number.isSafeInteger(input.maximumAttempts)||input.maximumAttempts<1||input.attempts>=input.maximumAttempts) return {action:'FAIL',costMs:null,reason:'BUDGET_OR_ATTEMPT_LIMIT'};
  const choices=input.options.filter(o=>o.compatible&&o.replaySafe&&(o.action!=='RESUME'||o.checkpointAvailable)&&
    o.placement.status==='ready'&&o.placement.suggestionMs!==null&&Number.isFinite(o.additionalMs)&&o.additionalMs>=0)
    .map(o=>({action:o.action,costMs:o.placement.suggestionMs!+o.additionalMs,reason:'LEGAL_REMAINING_COMPLETION_COST'}))
    .filter(o=>Number.isFinite(o.costMs)&&o.costMs>=0&&o.costMs<=input.remainingBudgetMs)
    .sort((a,b)=>a.costMs-b.costMs||a.action.localeCompare(b.action));
  return choices[0]??{action:'FAIL',costMs:null,reason:'NO_LEGAL_RECOVERY'};
}

export const CHECKPOINT_FORMATS = Object.freeze({
  'shopping.stage-commit.v1': { portable: true, requires: ['queryRef','stage output refs','workflow epoch','compatibility fingerprint'] },
  'shopping.normalization.v1': { portable: true, requires: ['inputHash','indexSnapshotId','modelVersion','dimension','committed chunks','cursor'] },
  'legacy-local': { portable: false, requires: ['original executor'] },
});
