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

export interface WorkflowRequest {
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
  constructor(private readonly registry: ExecutorRegistryService, private readonly runner: RuntimeRunnerService,
    private readonly runs: RuntimeRunService, private readonly sessions: SessionsService,
    private readonly debug: SearchDebugService, private readonly imageStages: ShoppingImageStagesService, private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.registry.register({ executorId: 'zeabur-shopping-workflow', toolIds: IMAGE_STAGE_TOOLS,
      execute: context => this.imageStages.execute(context) });
    this.registry.register({ executorId: 'zeabur-shopping-workflow', toolIds: SHOPPING_WORKFLOW_TOOLS,
      execute: context => this.dispatch(context) });
  }

  async execute(toolId: string, request: WorkflowRequest, signal?: AbortSignal) {
    if (!request.userId) throw new UnauthorizedException('AUTH_REQUIRED');
    if (request.sessionId) await this.assertSessionOwner(request.sessionId, request.userId);
    const assetId = (request.dto as { assetId?: string } | undefined)?.assetId;
    if (assetId) {
      const asset = await this.prisma.imageAsset.findFirst({ where: { id: assetId, ownerUserId: request.userId }, select: { id: true } });
      if (!asset) throw new NotFoundException('ASSET_NOT_FOUND');
    }
    const image = toolId === 'shopping.image' || toolId === 'shopping.image_upload';
    const graph = image ? buildImageSearchTaskGraph((request.dto as { assetId?: string })?.assetId ?? request.taskId ?? 'upload')
      : buildShoppingWorkflowGraph(toolId, request.sessionId ? `session:${request.sessionId}` : 'request:body');
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
    for (const task of graph.nodes) {
      for (const key of ['minimumQuality', 'energyBudgetMah', 'costBudgetMinorUnits'] as const) {
        const value = profile?.[key];
        if (typeof value === 'number' && value >= 0) task.constraints = { ...task.constraints, [key]: value };
      }
      if (typeof profile?.deadlineMs === 'number' && profile.deadlineMs > 0) {
        task.constraints = { ...task.constraints, deadlineMs: Math.min(150000, profile.deadlineMs) };
      }
    }
    const run = await this.runs.start(graph, request.userId);
    const result = await this.runner.execute<Record<string, unknown>>(run.runId, request, signal);
    const session = result.session as { sessionId?: string } | undefined;
    return { ...result, runtimeRunId: run.runId, runId: run.runId, taskId: request.taskId ?? graph.nodes[0].taskId,
      status: 'succeeded', resultRef: result.resultRef ?? (session?.sessionId ? 'session:' + session.sessionId : undefined),
      serverTiming: { queueMs: 0, computeMs: run.telemetry.reduce((sum, record) => sum + record.latencyMs, 0) },
      runtime: run };
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
