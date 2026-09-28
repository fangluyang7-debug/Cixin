import { execFileSync } from 'node:child_process';
import { ShoppingImageStagesService } from '../../src/modules/sessions/application/shopping-image-stages.service';
import { buildImageSearchTaskGraph } from '../../src/core/runtime/image-search-task-graph';
import { SessionMutationService } from '../../src/core/runtime/session-mutation.service';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { ArtifactStoreService } from '../../src/core/runtime/artifact-store.service';
import { WorkflowStoreService } from '../../src/core/runtime/workflow-store.service';

describe('durable workflow commits on isolated SQLite', () => {
  const previousRecovery=process.env.WORKFLOW_RECOVERY_ENABLED;
  let directory: string, prisma: PrismaService, artifacts: ArtifactStoreService, workflows: WorkflowStoreService;
  beforeAll(async () => {
    process.env.WORKFLOW_RECOVERY_ENABLED='true';
    directory = await mkdtemp(path.join(tmpdir(), 'harmony-workflow-test-'));
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'file:' + path.join(directory, 'test.db').replaceAll('\\', '/');
    prisma = new PrismaService(); await prisma.$connect();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    for (const name of ['000001_init', '000002_artifacts', '000003_workflows','000004_session_mutations']) {
      const sql = await readFile(path.resolve(__dirname, '../../prisma/migrations', name, 'migration.sql'), 'utf8');
      for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    }
    execFileSync(process.execPath,[path.resolve(__dirname,'../../prisma/patch-sqlite-schema.mjs')],{env:{...process.env,DATABASE_URL:'file:'+path.join(directory,'test.db').replaceAll('\\','/')},stdio:'pipe',windowsHide:true});
    artifacts = new ArtifactStoreService(prisma); workflows = new WorkflowStoreService(prisma, artifacts);
  });
  afterAll(async () => {
    if(previousRecovery===undefined) delete process.env.WORKFLOW_RECOVERY_ENABLED; else process.env.WORKFLOW_RECOVERY_ENABLED=previousRecovery;
    await prisma?.$disconnect();
    if (directory && path.dirname(path.resolve(directory)) === path.resolve(tmpdir()) && path.basename(directory).startsWith('harmony-workflow-test-')) await rm(directory, {recursive:true,force:true});
  });
  it('reuses committed stages and returns the committed result after response loss', async () => {
    const ticket = await workflows.begin('owner', 'shopping.image', 'once', {assetId:'a'}, 60000);
    const work = jest.fn(async () => ({price:'12.3400'}));
    const ref = await workflows.stage(ticket,'quality',[],new AbortController().signal,work);
    expect(await workflows.stage(ticket,'quality',[],new AbortController().signal,work)).toEqual(ref);
    expect(work).toHaveBeenCalledTimes(1);
    const result = await workflows.stage(ticket,'result',[ref],new AbortController().signal,async () => ({status:'succeeded'}),true);
    expect((await workflows.begin('owner','shopping.image','once',{assetId:'a'},60000)).result).toEqual(result);
    await expect(workflows.begin('owner','shopping.image','once',{assetId:'b'},60000)).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });
  it('rolls business writes back if publication fails', async () => {
    const ticket = await workflows.begin('owner','shopping.image','rollback',{},60000);
    const signal = new AbortController();
    await expect(workflows.stage(ticket,'result',[],signal.signal,async () => {
      await artifacts.publishJson('owner','test.query',{temporary:true});
      throw new Error('PUBLICATION_FAILED');
    },true)).rejects.toThrow('PUBLICATION_FAILED');
    expect(await prisma.artifactRecord.count({where:{payloadJson:'{"temporary":true}'}})).toBe(0);
    expect(await workflows.committed(ticket,'result')).toBeNull();
  });
  it('revokes old fences, keeps committed prefixes and never refreshes the total budget', async () => {
    const ticket = await workflows.begin('owner','shopping.image','restart',{},60000);
    const ref = await workflows.stage(ticket,'crop',[],new AbortController().signal,async () => ({hash:'old'}));
    const restarted = new WorkflowStoreService(prisma,artifacts);
    const next = await restarted.begin('owner','shopping.image','restart',{},600000);
    expect(next.expiresAt).toBe(ticket.expiresAt); expect(next.epoch).toBe(ticket.epoch+1);
    await expect(workflows.stage(ticket,'embedding',[ref],new AbortController().signal,async()=>({}))).rejects.toThrow('WORKFLOW_FENCE_REVOKED');
    expect(await restarted.committed(next,'crop')).toEqual(ref);
  });
  it('does not recover user cancellation and does not reclaim pinned artifacts', async () => {
    const ticket = await workflows.begin('owner','shopping.image','cancel',{},60000);
    const ref = await workflows.stage(ticket,'quality',[],new AbortController().signal,async()=>({valid:true}));
    await workflows.stop(ticket,'CANCELLED');
    await expect(workflows.begin('owner','shopping.image','cancel',{},60000)).rejects.toThrow('WORKFLOW_NOT_RECOVERABLE');
    await prisma.artifactRecord.update({where:{id:ref.artifactId},data:{expiresAt:new Date(0)}});
    expect(await artifacts.expireUnpinned(new Date())).toBe(0);
    await artifacts.release('owner',ticket.id);
    expect(await artifacts.expireUnpinned(new Date())).toBe(1);
  });
  it('serializes session writers, replays receipts, rejects old revisions and quarantines uncertain writes', async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO ImageAsset (id,assetGroupId,variantType,isPrimaryRecognitionAsset,bucketGroup,objectKey,uploadStatus) VALUES ('session-asset','g','original_source',0,'recognition','a.jpg','uploaded')`);
    await prisma.user.create({data:{id:'owner',email:'owner@invalid.test'}});
    await prisma.querySession.create({data:{id:'session-cas',assetId:'session-asset',entrySource:'android_app',userId:'owner',status:'ready',stage:'ready'}});
    const service=new SessionMutationService(prisma);
    const request={ownerId:'owner',sessionId:'session-cas',key:'edit1',operation:'profile',input:{color:'blue'},baseVersion:0,revision:1};
    let release!:()=>void; const waiting=new Promise<void>(r=>release=r);
    let entered!:()=>void; const started=new Promise<void>(r=>entered=r);
    const work=jest.fn(async()=>{entered();await waiting;return {ok:true};});
    const first=service.execute(request,work);await started;
    await expect(service.execute({...request,key:'edit2'},async()=>({}))).rejects.toThrow('SESSION_BUSY');
    await expect(service.readable('session-cas')).rejects.toThrow('SESSION_BUSY');
    release();expect(await first).toMatchObject({stateVersion:1,requestRevision:1});
    expect(await service.execute(request,work)).toMatchObject({stateVersion:1});expect(work).toHaveBeenCalledTimes(1);
    await expect(service.execute({...request,key:'old'},async()=>({}))).rejects.toThrow('SESSION_VERSION_CONFLICT');
    await expect(service.execute({...request,key:'fail',baseVersion:1,revision:2},async()=>{throw new Error('MODEL_FAILED');})).rejects.toThrow('MODEL_FAILED');
    await expect(service.readable('session-cas')).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect((await prisma.querySession.findUnique({where:{id:'session-cas'}}))?.stateVersion).toBe(1);
  });

  it('executes the twelve-stage Artifact path and reuses final commit without duplicate business writes', async () => {
    await prisma.imageAsset.create({data:{id:'durable-image',ownerUserId:'owner',assetGroupId:'g',variantType:'original_source',isPrimaryRecognitionAsset:true,bucketGroup:'recognition',objectKey:'source.jpg',uploadStatus:'uploaded'}});
    const ticket=await workflows.begin('owner','shopping.image','durable-image',{dto:{assetId:'durable-image'}},60000);
    const sessions={getSession:async(id:string)=>({session:{sessionId:id}}),writeRuntimeCandidateSnapshot:jest.fn(async()=> 'snapshot')};
    const profiles={classifyProductCategory:jest.fn(async()=>({category:'shoe',confidence:1})),identifyProductProfile:async()=>({category:'shoe',keywords:['shoe'],styleTags:[],sceneTags:[],confidence:1,raw:{}})};
    const service=new ShoppingImageStagesService(prisma,{} as any,sessions as any,{getCurrentCandidates:async()=>({items:[]})} as any,
      {getSignedReadUrl:async()=> 'https://private.invalid/crop?signature=secret',putImage:async()=>({bucketGroup:'recognition',objectKey:'crop.jpg'})} as any,
      {readMetadata:async()=>({width:64,height:64}),cropForEmbedding:async()=>({buffer:Buffer.from('crop')})} as any,
      profiles as any,{embedImage:async()=>({provider:'test',modelName:'fixture',dimension:2,vector:[1,0],vectorHash:'fixture'})} as any,
      {searchFastAnnShoes:async()=>[]} as any,workflows,artifacts);
    const outputs=new Map<string,unknown>(),graph=buildImageSearchTaskGraph('durable-image');
    for(const task of graph.nodes) outputs.set(task.taskId,await service.execute({runId:'run_durable',task,assignment:{} as any,
      input:{workflow:ticket,dto:{assetId:'durable-image'},userId:'owner'},outputs,signal:new AbortController().signal}));
    expect(await prisma.stageCommit.count({where:{workflowId:ticket.id}})).toBe(12);
    expect(sessions.writeRuntimeCandidateSnapshot).toHaveBeenCalledTimes(1);
    expect(profiles.classifyProductCategory).toHaveBeenCalledTimes(1);
    const replay=await workflows.begin('owner','shopping.image','durable-image',{dto:{assetId:'durable-image'}},60000);
    expect(await workflows.readJson('owner',replay.result!)).toMatchObject({status:'succeeded',stateVersion:1});
    const stored=await prisma.artifactRecord.findMany({where:{ownerId:'owner'}});
    expect(JSON.stringify(stored)).not.toContain('signature=secret');
  });

});
