import { AsyncLocalStorage } from 'node:async_hooks';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { canonicalJson, contentHash } from './artifact-store.service';
import { createId } from '../../common/utils/id';
import { RuntimeWorkScope } from './runtime-work-scope';

const active = new AsyncLocalStorage<string>();
export interface MutationRequest { ownerId: string; sessionId: string; key: string; operation: string; input: unknown; baseVersion?: number; revision?: number; }
@Injectable()
export class SessionMutationService {
  constructor(private readonly prisma: PrismaService) {}

  async readable(sessionId: string): Promise<void> {
    if (active.getStore() === sessionId) return;
    if (await this.prisma.sessionWriteLock.findUnique({where:{sessionId}})) throw new ConflictException('SESSION_BUSY_OR_RECONCILIATION_REQUIRED');
  }

  async execute<T>(request: MutationRequest, work: () => Promise<T>): Promise<T> {
    if (active.getStore() === request.sessionId) return work();
    if (!request.ownerId || !/^[A-Za-z0-9_-]{1,128}$/.test(request.key) ||
      [request.baseVersion,request.revision].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))) throw new ConflictException('SESSION_REVISION_INVALID');
    const hash = contentHash(Buffer.from(canonicalJson({operation:request.operation,input:request.input??null,baseVersion:request.baseVersion??null,revision:request.revision??null})));
    const receipt = await this.prisma.publication(async () => {
      const session = await this.prisma.querySession.findFirst({where:{id:request.sessionId,userId:request.ownerId}});
      if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
      const old = await this.prisma.sessionMutation.findUnique({where:{sessionId_requestKey:{sessionId:request.sessionId,requestKey:request.key}}});
      if (old) {
        if (old.ownerId!==request.ownerId||old.requestHash!==hash) throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        if (old.state==='COMMITTED'&&old.resultJson) return old;
        throw new ConflictException(old.state==='RUNNING'?'SESSION_IN_PROGRESS':'SESSION_RECONCILIATION_REQUIRED');
      }
      if (await this.prisma.sessionWriteLock.findUnique({where:{sessionId:session.id}})) throw new ConflictException('SESSION_BUSY_OR_RECONCILIATION_REQUIRED');
      if (request.baseVersion!==undefined&&request.baseVersion!==session.stateVersion || request.revision!==undefined&&request.revision<=session.requestRevision) throw new ConflictException('SESSION_VERSION_CONFLICT');
      const id=createId('mutation');
      const created=await this.prisma.sessionMutation.create({data:{id,sessionId:session.id,ownerId:request.ownerId,requestKey:request.key,requestHash:hash,
        baseVersion:session.stateVersion,revision:request.revision??session.requestRevision+1,state:'RUNNING'}});
      await this.prisma.sessionWriteLock.create({data:{sessionId:session.id,mutationId:id,ownerId:request.ownerId}});
      return created;
    });
    if (receipt.state==='COMMITTED') return JSON.parse(receipt.resultJson!) as T;
    try {
      // Legacy operations may perform model/storage work. Never hold SQLite's write transaction across them.
      const output=await active.run(request.sessionId,work);
      return await this.prisma.publication(async () => {
        const lock=await this.prisma.sessionWriteLock.findUnique({where:{sessionId:request.sessionId}});
        if (lock?.mutationId!==receipt.id) throw new ConflictException('SESSION_FENCE_REVOKED');
        const changed=await this.prisma.querySession.updateMany({where:{id:request.sessionId,userId:request.ownerId,stateVersion:receipt.baseVersion},
          data:{stateVersion:{increment:1},requestRevision:receipt.revision}});
        if (changed.count!==1) throw new ConflictException('SESSION_VERSION_CONFLICT');
        const result=output&&typeof output==='object'?{...output,stateVersion:receipt.baseVersion+1,requestRevision:receipt.revision}:output;
        const resultJson=JSON.stringify(result);
        if (Buffer.byteLength(resultJson)>1024*1024) throw new ConflictException('SESSION_RESULT_TOO_LARGE');
        await this.prisma.sessionMutation.update({where:{id:receipt.id},data:{state:'COMMITTED',resultJson}});
        await this.prisma.sessionWriteLock.delete({where:{sessionId:request.sessionId}});
        return result as T;
      });
    } catch (error) {
      // A failed legacy operation may already have written state. Preserve the lock, never blindly replay it.
      await RuntimeWorkScope.settlement(()=>this.prisma.sessionMutation.updateMany({where:{id:receipt.id,state:'RUNNING'},data:{state:'RECONCILIATION_REQUIRED'}}));
      throw error;
    }
  }
}
