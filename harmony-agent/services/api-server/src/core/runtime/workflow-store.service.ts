import { decodeShoppingPayload } from './shopping-payload';
import { RuntimeWorkScope } from './runtime-work-scope';
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { createId } from '../../common/utils/id';
import { ArtifactStoreService, canonicalJson, contentHash } from './artifact-store.service';
import { ArtifactRef, TaskInstanceV1, validTaskInstance } from './scheduling-protocol';

export interface WorkflowTicket { id: string; ownerId: string; epoch: number; expiresAt: number; totalBudgetMs?: number; queryRef?: ArtifactRef; result?: ArtifactRef; }
@Injectable()
export class WorkflowStoreService {
  private readonly coordinatorId = createId('coordinator');
  constructor(private readonly prisma: PrismaService, private readonly artifacts: ArtifactStoreService) {}

  async begin(ownerId: string, operation: string, key: string, request: unknown, budgetMs: number): Promise<WorkflowTicket> {
    if (!ownerId || !/^[A-Za-z0-9_-]{1,128}$/.test(key) || !Number.isFinite(budgetMs) || budgetMs <= 0) throw new ConflictException('WORKFLOW_REQUEST_INVALID');
    const requestJson = canonicalJson(request);
    const requestHash = contentHash(Buffer.from(requestJson));
    return this.prisma.publication(async () => {
      const old = await this.prisma.workflowExecution.findUnique({ where: { ownerId_operation_requestKey: { ownerId, operation, requestKey: key } } });
      if (old) {
        if (old.requestHash !== requestHash) throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        if (old.state === 'COMMITTED' && old.resultRefJson) return { id: old.id, ownerId, epoch: old.epoch, expiresAt: old.expiresAt.getTime(), totalBudgetMs:old.expiresAt.getTime()-old.createdAt.getTime(), result: JSON.parse(old.resultRefJson) as ArtifactRef };
        if (['CANCELLED', 'EXPIRED', 'UNREPLAYABLE'].includes(old.state) || old.expiresAt.getTime() <= Date.now()) throw new ConflictException('WORKFLOW_NOT_RECOVERABLE');
        if (old.state === 'RUNNING' && old.coordinatorId === this.coordinatorId) throw new ConflictException('WORKFLOW_IN_PROGRESS');
        // Only the image pipeline has idempotent object writes and an atomic business commit.
        if (!['shopping.image', 'shopping.image_upload'].includes(operation)) throw new ConflictException('WORKFLOW_RECONCILIATION_REQUIRED');
        if (old.epoch >= 3 || process.env.WORKFLOW_RECOVERY_ENABLED !== 'true') throw new ConflictException('RECOVERY_DISABLED_OR_LIMIT');
        const price = await this.prisma.stageCommit.findFirst({ where: { workflowId: old.id, nodeId: 'price-stock' } });
        if (price && Date.now() - price.createdAt.getTime() > 30000) throw new ConflictException('PRICE_CHECKPOINT_EXPIRED_RESTART_REQUIRED');
        const recovered = await this.prisma.workflowExecution.update({ where: { id: old.id }, data: { epoch: { increment: 1 }, state: 'RUNNING', coordinatorId: this.coordinatorId } });
        return { id: old.id, ownerId, epoch: recovered.epoch, expiresAt: old.expiresAt.getTime(), totalBudgetMs:old.expiresAt.getTime()-old.createdAt.getTime(), queryRef: JSON.parse(old.requestJson).queryRef };
      }
      const input = request as { dto?: object; sessionId?: string };
      const queryRef = await this.artifacts.publishJson(ownerId, 'shopping.query', { ...(input.dto ?? request as object), operation: operation.replace('shopping.', ''), sessionId: input.sessionId ?? null });
      const row = await this.prisma.workflowExecution.create({ data: { id: createId('workflow'), ownerId, operation, requestKey: key,
        requestHash, requestJson: canonicalJson({ queryRef }), coordinatorId: this.coordinatorId, state: 'RUNNING', expiresAt: new Date(Date.now() + budgetMs) } });
      await this.artifacts.pin(ownerId, queryRef, row.id);
      return { id: row.id, ownerId, epoch: row.epoch, expiresAt: row.expiresAt.getTime(), totalBudgetMs:budgetMs, queryRef };
    });
  }

  async checkpoint(ticket: WorkflowTicket, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const row = await this.prisma.workflowExecution.findFirst({ where: { id: ticket.id, ownerId: ticket.ownerId, epoch: ticket.epoch, state: 'RUNNING' } });
    if (!row || row.expiresAt.getTime() <= Date.now()) throw new ConflictException('WORKFLOW_FENCE_REVOKED');
  }

  async committed(ticket: WorkflowTicket, nodeId: string): Promise<ArtifactRef | null> {
    const commit = await this.prisma.stageCommit.findUnique({ where: { workflowId_nodeId_outputVersion: { workflowId: ticket.id, nodeId, outputVersion: 1 } } });
    if (!commit) return null;
    const ref = JSON.parse(commit.outputRefJson) as ArtifactRef;
    await this.artifacts.read(ticket.ownerId, ref);
    return ref;
  }

  async stage(ticket: WorkflowTicket, nodeId: string, inputs: ArtifactRef[], signal: AbortSignal,
    work: () => Promise<unknown>, businessCommit = false, dependenciesOf: (value: unknown) => ArtifactRef[] = () => []): Promise<ArtifactRef> {
    await this.checkpoint(ticket, signal);
    const previous = await this.committed(ticket, nodeId);
    if (previous) return previous;
    const attemptId=createId('attempt');
    const remaining=Math.min(ticket.expiresAt-Date.now(),RuntimeWorkScope.remainingBudget(150000));
    const instance:TaskInstanceV1={protocolVersion:1,traceId:ticket.id,workflowId:ticket.id,nodeId,taskId:ticket.id+':'+nodeId,attemptId,coordinatorId:this.coordinatorId,
      contractId:'shopping.stage.'+nodeId,contractVersion:1,requestRevision:0,budget:{totalBudgetMs:ticket.totalBudgetMs??remaining,remainingBudgetMs:Math.min(remaining,ticket.totalBudgetMs??remaining),expiresAt:ticket.expiresAt},
      inputs,networkAllowed:true,privacy:'AUTHORIZED_REMOTE'};
    if(!validTaskInstance(instance))throw new ConflictException('TASK_INSTANCE_INVALID');
    const attempt = await this.prisma.taskAttempt.create({ data: { id: attemptId, instanceJson:canonicalJson(instance), workflowId: ticket.id, nodeId, epoch: ticket.epoch, state: 'RUNNING' } });
    RuntimeWorkScope.recordAttempt(attempt.id);
    try {
      const publish = async (output: unknown) => {
        await this.checkpoint(ticket, signal);
        const ref = await this.artifacts.publishJson(ticket.ownerId, businessCommit ? 'shopping.result' : 'shopping.stage-state', output, [...inputs, ...dependenciesOf(output)]);
        await this.prisma.stageCommit.create({ data: { id: createId('commit'), workflowId: ticket.id, nodeId,
          attemptId: attempt.id, fencingToken: ticket.epoch, outputRefJson: canonicalJson(ref) } });
        await this.artifacts.pin(ticket.ownerId, ref, ticket.id);
        await this.prisma.taskAttempt.update({ where: { id: attempt.id }, data: { state: 'SETTLED', settledAt: new Date() } });
        if (businessCommit) await this.prisma.workflowExecution.update({ where: { id: ticket.id }, data: { state: 'COMMITTED', resultRefJson: canonicalJson(ref) } });
        signal.throwIfAborted();
        return ref;
      };
      if (businessCommit) return await this.prisma.publication(async () => {
        await this.checkpoint(ticket, signal);
        return publish(await work());
      });
      // CPU/model/object-storage work deliberately happens outside the transaction.
      const output = await work();
      return await this.prisma.publication(() => publish(output));
    } catch (error) {
      await RuntimeWorkScope.settlement(() => this.prisma.taskAttempt.updateMany({ where: { id: attempt.id, state: 'RUNNING' }, data: { state: 'SETTLED_FAILED', settledAt: new Date() } })).catch(() => {});
      throw error;
    }
  }

  async stop(ticket: WorkflowTicket, reason: 'CANCELLED' | 'EXPIRED' | 'RECOVERABLE' | 'UNREPLAYABLE'): Promise<void> {
    await this.prisma.workflowExecution.updateMany({ where: { id: ticket.id, ownerId: ticket.ownerId, epoch: ticket.epoch, state: 'RUNNING' },
      data: { state: reason, epoch: { increment: 1 } } });
  }

  async readJson(ownerId: string, ref: ArtifactRef): Promise<unknown> {
    const record = await this.artifacts.read(ownerId, ref);
    if (record.payloadJson === null) throw new ConflictException('ARTIFACT_JSON_REQUIRED');
    return decodeShoppingPayload(record.schemaId, JSON.parse(record.payloadJson));
  }
}
