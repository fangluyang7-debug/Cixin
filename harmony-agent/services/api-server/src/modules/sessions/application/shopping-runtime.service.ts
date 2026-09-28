import { TurnsService } from '../../turns/application/turns.service';
import { CandidatesService } from '../../candidates/application/candidates.service';
import { createHash, randomUUID } from 'node:crypto';
import { SessionMutationService } from '../../../core/runtime/session-mutation.service';
import { createId } from '../../../common/utils/id';
import { WorkflowStoreService, WorkflowTicket } from '../../../core/runtime/workflow-store.service';
import { performance } from 'node:perf_hooks';
import { ArtifactStoreService } from '../../../core/runtime/artifact-store.service';
import { ArtifactRef } from '../../../core/runtime/scheduling-protocol';
import { BadRequestException, HttpException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { clientRoute } from '../../../core/runtime/client-route';
import { ShoppingImageStagesService } from './shopping-image-stages.service';
import { buildImageSearchTaskGraph, IMAGE_STAGE_TOOLS } from '../../../core/runtime/image-search-task-graph';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ExecutorRegistryService, RuntimeExecutionContext } from '../../../core/runtime/executor-registry.service';
import { RuntimeRunnerService } from '../../../core/runtime/runtime-runner.service';
import { RuntimeRunService } from '../../../core/runtime/runtime-run.service';
import { SHOPPING_WORKFLOW_TOOLS } from '../../../core/runtime/shopping-plugin';
import { buildShoppingWorkflowGraph } from '../../../core/runtime/shopping-task-graph';
import { SessionsService } from './sessions.service';
import { SearchDebugService } from './search-debug.service';
import { CreateTextSessionDto } from '../dto/create-text-session.dto';
import { UpdateSubjectSelectionDto } from '../dto/subject-selection.dto';
import { UpdateProductProfileDto } from '../dto/update-product-profile.dto';

export interface ShoppingRuntimeResult extends Record<string, unknown> { runtimeRunId: string; runId: string; status: string; }
export interface WorkflowRequest {
  workflow?: WorkflowTicket;
  baseVersion?: number;
  requestRevision?: number;
  taskId?: string;
  taskProfile?: unknown;
  deviceProfile?: unknown;
  networkProfile?: unknown;
  dto?: unknown;
  sessionId?: string;
  userId?: string | null;
}

@Injectable()
export class ShoppingRuntimeService implements OnModuleInit {
  private readonly unversionedPipeline = randomUUID();
  constructor(private readonly registry: ExecutorRegistryService, private readonly runner: RuntimeRunnerService,
    private readonly runs: RuntimeRunService, private readonly sessions: SessionsService,
    private readonly debug: SearchDebugService, private readonly imageStages: ShoppingImageStagesService, private readonly prisma: PrismaService, @Optional() private readonly artifacts?: ArtifactStoreService, @Optional() private readonly workflows?: WorkflowStoreService, @Optional() private readonly mutations?: SessionMutationService, @Optional() private readonly turns?: TurnsService, @Optional() private readonly candidateService?: CandidatesService) {}

  onModuleInit() {
    this.registry.register({ executorId: 'zeabur-shopping-workflow', toolIds: IMAGE_STAGE_TOOLS,
      execute: context => this.imageStages.execute(context) });
    this.registry.register({ executorId: 'zeabur-shopping-workflow', toolIds: SHOPPING_WORKFLOW_TOOLS,
      execute: context => this.dispatch(context) });
  }

  async execute(toolId: string, request: WorkflowRequest, signal?: AbortSignal): Promise<ShoppingRuntimeResult> {
    if (!request.userId) throw new UnauthorizedException('AUTH_REQUIRED');
    if (request.sessionId) await this.assertSessionOwner(request.sessionId, request.userId);
    signal?.throwIfAborted();
    if (process.env.SESSION_REVISION_ENABLED === 'true' && request.sessionId && this.mutations) {
      if (['shopping.subject','shopping.profile','shopping.refine','shopping.turn','shopping.more'].includes(toolId)) {
        return this.mutations.execute({ownerId:request.userId??'',sessionId:request.sessionId,key:request.taskId??createId('request'),operation:toolId,
          input:request.dto??null,baseVersion:request.baseVersion,revision:request.requestRevision},()=>this.executeInternal(toolId,request,signal));
      }
      await this.mutations.readable(request.sessionId);
    }
    return this.executeInternal(toolId,request,signal);
  }
  private async executeInternal(toolId:string,request:WorkflowRequest,signal?:AbortSignal):Promise<ShoppingRuntimeResult> {
    const receivedAt = performance.now();
    if (!request.userId) throw new UnauthorizedException('AUTH_REQUIRED');
    const ownerId = request.userId;
    if (request.sessionId) await this.assertSessionOwner(request.sessionId, request.userId);
    const imageRef = (request.dto as { imageArtifact?: ArtifactRef } | undefined)?.imageArtifact;
    if (imageRef) {
      if (process.env.ARTIFACT_PROTOCOL_ENABLED !== 'true' || !this.artifacts) throw new BadRequestException('ARTIFACT_PROTOCOL_DISABLED');
      const resolvedAssetId = await this.artifacts.imageAsset(request.userId, imageRef);
      request = { ...request, dto: { ...(request.dto as object), assetId: resolvedAssetId } };
    }
    const assetId = (request.dto as { assetId?: string } | undefined)?.assetId;
    if (assetId) {
      const asset = await this.prisma.imageAsset.findFirst({ where: { id: assetId, ownerUserId: request.userId }, select: { id: true } });
      if (!asset) throw new NotFoundException('ASSET_NOT_FOUND');
    }
    const image = toolId === 'shopping.image' || toolId === 'shopping.image_upload';
    let workflow: WorkflowTicket | undefined;
    if (image && process.env.WORKFLOW_PROTOCOL_ENABLED === 'true') {
      if (!this.workflows || !this.artifacts) throw new BadRequestException('WORKFLOW_STORE_UNAVAILABLE');
      if ((request.dto as { imageBase64?: string })?.imageBase64) throw new BadRequestException('ARTIFACT_UPLOAD_REQUIRED');
      workflow = await this.workflows.begin(ownerId, toolId, request.taskId ?? createId('request'),
        JSON.parse(JSON.stringify({ dto: request.dto, sessionId: request.sessionId ?? null, compatibility: await this.compatibilityFingerprint() })),
        Math.min(150000, typeof (request.taskProfile as { deadlineMs?: number })?.deadlineMs === 'number' ? (request.taskProfile as { deadlineMs: number }).deadlineMs : 150000) - (performance.now() - receivedAt));
      if (workflow.result) return await this.workflows.readJson(ownerId, workflow.result) as ShoppingRuntimeResult;
      request = { ...request, workflow };
    }
    try {
    const graph = image ? buildImageSearchTaskGraph((request.dto as { assetId?: string })?.assetId ?? request.taskId ?? 'upload')
      : buildShoppingWorkflowGraph(toolId, request.sessionId ? `session:${request.sessionId}` : 'request:body');
    if (workflow) graph.graphId = workflow.id;
    graph.clientTaskId = request.taskId;
    if (request.taskId !== undefined) {
      graph.nodes[0].cloudRoutes = [clientRoute(request.networkProfile, Buffer.byteLength(JSON.stringify(request.dto ?? {})))];
    }
    for (const node of graph.nodes) {
      node.deviceProfile = safeProfile(request.deviceProfile);
      node.networkProfile = safeProfile(request.networkProfile);
    }
    const profile = safeProfile(request.taskProfile);
    if (profile?.allowCloud === false || profile?.privacy === 'high') {
      for (const task of graph.nodes) task.constraints = { ...task.constraints, privacy: 'high' };
    }
    if (profile?.deadlineMs !== undefined && (typeof profile.deadlineMs !== 'number' || !Number.isFinite(profile.deadlineMs) || profile.deadlineMs <= 0)) throw new BadRequestException('DEADLINE_EXCEEDED');
    for (const task of graph.nodes) {
      for (const key of ['minimumQuality', 'energyBudgetMah', 'costBudgetMinorUnits'] as const) {
        const value = profile?.[key];
        if (typeof value === 'number' && value >= 0) task.constraints = { ...task.constraints, [key]: value };
      }
      if (typeof profile?.deadlineMs === 'number' && profile.deadlineMs > 0) {
        const remaining = Math.min(Math.min(150000, profile.deadlineMs) - (performance.now() - receivedAt), workflow ? workflow.expiresAt - Date.now() : Infinity);
        if (remaining <= 0) throw new BadRequestException('DEADLINE_EXCEEDED');
        task.constraints = { ...task.constraints, deadlineMs: remaining };
      }
    }
    if (workflow) for (const task of graph.nodes) {
      const remaining = Math.min(task.constraints?.deadlineMs ?? 150000, workflow.expiresAt - Date.now());
      if (remaining <= 0) throw new BadRequestException('DEADLINE_EXCEEDED');
      task.constraints = { ...task.constraints, deadlineMs: remaining };
    }
    signal?.throwIfAborted();
    const run = await this.runs.start(graph, ownerId);
    const result = await this.runner.execute<Record<string, unknown>>(run.runId, request, signal);
    const session = result.session as { sessionId?: string } | undefined;
    return { ...result, runtimeRunId: run.runId, runId: run.runId, taskId: request.taskId ?? graph.nodes[0].taskId,
      status: 'succeeded', resultRef: result.resultRef ?? (session?.sessionId ? 'session:' + session.sessionId : undefined),
      serverTiming: { queueMs: 0, scope: 'workflow-stage-execution', executionMs: run.telemetry.reduce((sum, record) => sum + record.latencyMs, 0), computeMs: run.telemetry.reduce((sum, record) => sum + record.latencyMs, 0) },
      runtime: run };
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const code = response && typeof response === 'object' ? (response as { code?: string }).code : null;
      if (workflow) await this.workflows!.stop(workflow, signal?.aborted || code === 'RUNTIME_CANCELLED' ? 'CANCELLED' : code === 'RUNTIME_TIMEOUT' || Date.now() >= workflow.expiresAt ? 'EXPIRED' : 'RECOVERABLE');
      throw error;
    }
  }

  private async compatibilityFingerprint(): Promise<string> {
    const hash = createHash('sha256');
    hash.update(process.env.SHOPPING_PIPELINE_VERSION || this.unversionedPipeline);
    for (const key of ['VISION_MODEL_NAME','VISION_CATEGORY_MODEL_NAME','VISION_PROFILE_MODEL_NAME','EMBEDDING_PROVIDER','EMBEDDING_MODEL_NAME','EMBEDDING_DIMENSION','QUERY_EMBEDDING_KIND','IMAGE_EMBEDDING_PREPROCESSOR']) hash.update(key+'='+String(process.env[key]??'')+';');
    // Hash actual content, not just a row count or optional cached vector hash.
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.productImageEmbedding.findMany({orderBy:{id:'asc'},take:256,...(cursor?{cursor:{id:cursor},skip:1}:{}),
        select:{id:true,vectorJson:true,provider:true,modelName:true,dimension:true,embeddingKind:true,preprocessJson:true}});
      for (const row of rows) hash.update(JSON.stringify(row));
      if (rows.length<256) break;
      cursor=rows[rows.length-1].id;
    }
    return hash.digest('hex');
  }

  async assertSessionOwner(sessionId: string, userId: string) {
    if (!userId) throw new UnauthorizedException('AUTH_REQUIRED');
    const session = await this.prisma.querySession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');
  }

  private async dispatch(context: RuntimeExecutionContext) {
    context.signal.throwIfAborted();
    const input = context.input as WorkflowRequest;
    const options = { userId: input.userId ?? null };
    switch (context.task.toolId) {
      case 'shopping.turn': return this.turns!.createTurn(input.sessionId!, input.dto as Parameters<TurnsService['createTurn']>[1]);
      case 'shopping.more': return { session: {sessionId:input.sessionId!}, candidates: await this.candidateService!.getMoreCandidates(input.sessionId!, input.dto as Parameters<CandidatesService['getMoreCandidates']>[1]) };
      case 'shopping.text': return this.sessions.createTextSession(input.dto as CreateTextSessionDto, options);
      case 'shopping.prices': return this.sessions.runtimePriceView(input.sessionId!);
      case 'shopping.answer': return this.sessions.runtimeAnswerView(input.sessionId!);
      case 'shopping.read': return this.sessions.readRuntimeSession(input.sessionId!);
      case 'shopping.subject': return this.sessions.updateSubjectSelection(input.sessionId!, input.dto as UpdateSubjectSelectionDto);
      case 'shopping.profile': return this.sessions.updateProductProfile(input.sessionId!, input.dto as UpdateProductProfileDto);
      case 'shopping.refine': return this.sessions.refineCandidates(input.sessionId!);
      case 'shopping.debug': return this.debug.run(input.dto as Parameters<SearchDebugService['run']>[0]);
      default: throw new Error('RUNTIME_UNKNOWN_SHOPPING_OPERATION');
    }
  }
}

// Keep raw inputs, credentials, URLs and arbitrary object trees out of the task graph.
function safeProfile(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: Record<string, unknown> = {};
  const allowed = ['allowCloud', 'privacy', 'batteryPercent', 'thermalLevel', 'memoryPressure',
    'freeMemoryMb', 'availableMemoryMb', 'systemCpuUsage', 'appCpuUsage', 'appVisibility', 'capturedAt',
    'roundTripMs', 'uploadMbps', 'downloadMbps', 'source', 'observedAt', 'inputBytes', 'deadlineMs',
    'minimumQuality', 'energyBudgetMah', 'costBudgetMinorUnits'];
  for (const key of allowed) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean' || item === null ||
      typeof item === 'string' && item.length <= 64 && /^[a-zA-Z0-9_.:-]+$/.test(item)) result[key] = item;
  }
  return result;
}
