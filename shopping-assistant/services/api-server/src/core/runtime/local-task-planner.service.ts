import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createId } from "../../common/utils/id";
import type { AgentPlanner } from "./agent-runtime.service";
import {
  ExecutionLocation,
  PrivacyLevel,
  TaskDemand,
  TaskGraph,
  TaskIntent,
  UserPreference,
} from "./runtime.contracts";
import { RuntimePlanningError } from "./runtime-errors";

export const LOCAL_TASK_DECISION_PROVIDER = Symbol("LOCAL_TASK_DECISION_PROVIDER");
export const LOCAL_TASK_TEMPLATES = Symbol("LOCAL_TASK_TEMPLATES");
export type LocalTaskOperation = string;
export const LOCAL_DECISION_SCHEMA_VERSION = "1";

export interface LocalTaskTemplate {
  operation: LocalTaskOperation;
  realtime: TaskDemand["realtime"];
  complexity: TaskDemand["complexity"];
  /** Minimum privacy policy owned by the app, not by the model. */
  privacy: PrivacyLevel;
  match?: (goal: string, context: Record<string, unknown>) => boolean;
  build: (goal: string, context: Record<string, unknown>) => TaskIntent[];
}

export interface LocalTaskDecisionInput {
  goal: string;
  context: Record<string, unknown>;
  operations: readonly LocalTaskOperation[];
  schemaVersion: typeof LOCAL_DECISION_SCHEMA_VERSION;
  signal: AbortSignal;
}

export interface LocalTaskDecision {
  operation: LocalTaskOperation;
  realtime: TaskDemand["realtime"];
  complexity: TaskDemand["complexity"];
  priority: TaskDemand["priority"];
  privacy: PrivacyLevel;
  localityPreference?: ExecutionLocation;
  reasons: string[];
  confidence: number;
  providerId: string;
  trainedModel: boolean;
}

export interface LocalTaskDecisionProvider {
  /** Implementation is supplied by the host app or board agent. No remote scheduler call is required. */
  decide(input: LocalTaskDecisionInput): Promise<LocalTaskDecision>;
}

@Injectable()
export class LocalTaskPlannerService implements AgentPlanner {
  readonly version = "registered-local-templates-v2";
  constructor(
    @Optional() @Inject(LOCAL_TASK_DECISION_PROVIDER) private readonly decisionProvider?: LocalTaskDecisionProvider,
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(LOCAL_TASK_TEMPLATES) private readonly templates: readonly LocalTaskTemplate[] = [],
  ) {
    const ids = new Set<string>();
    for (const template of templates) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(template.operation) || ids.has(template.operation) ||
          !["interactive", "deferred"].includes(template.realtime) ||
          !["simple", "complex"].includes(template.complexity) ||
          !["public", "internal", "sensitive", "high"].includes(template.privacy) ||
          typeof template.build !== "function") throw new Error("LOCAL_TEMPLATE_INVALID_OR_DUPLICATE");
      ids.add(template.operation);
    }
  }

  async planGoal(input: { goal: string; context?: Record<string, unknown> }): Promise<TaskGraph> {
    const goal = input.goal.trim();
    const context = input.context ?? {};
    if (!goal || goal.length > 4096) {
      throw new RuntimePlanningError("GOAL_LENGTH_INVALID", "目标应为 1 到 4096 个字符。");
    }
    const operations = this.templates.map(template => template.operation);
    let operation = context.operation as LocalTaskOperation | undefined;
    if (operation !== undefined && !operations.includes(operation)) {
      throw new RuntimePlanningError("OPERATION_UNSUPPORTED", "操作不在本地任务模板支持范围内。");
    }
    const explicit = operation !== undefined;
    let inferredRealtime: TaskDemand["realtime"] | undefined;
    let inferredComplexity: TaskDemand["complexity"] | undefined;
    let providerId: string | undefined;
    let providerConfidence: number | undefined;
    let inferred: LocalTaskDecision | undefined;
    let fallbackReason: string | undefined;
    let trainedModel = false;
    if (!operation) {
      if (this.decisionProvider) {
        const controller = new AbortController();
        const configuredTimeout = this.config?.get<number>("runtime.localDecisionTimeoutMs") ?? 50;
        const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1, Math.min(500, configuredTimeout)) : 50;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const decision = await Promise.race([
            this.decisionProvider.decide({ goal, context: structuredClone(context),
              operations: Object.freeze([...operations]), schemaVersion: LOCAL_DECISION_SCHEMA_VERSION, signal: controller.signal }),
            new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("LOCAL_DECISION_TIMEOUT")), { once: true })),
          ]);
          if (decision && operations.includes(decision.operation) && Number.isFinite(decision.confidence) &&
              decision.confidence >= 0.8 && decision.confidence <= 1 &&
              typeof decision.providerId === "string" && decision.providerId.trim() &&
              typeof decision.trainedModel === "boolean" &&
              ["interactive", "deferred"].includes(decision.realtime) &&
              ["simple", "complex"].includes(decision.complexity) &&
              ["background", "normal", "interactive", "urgent"].includes(decision.priority) &&
              ["public", "internal", "sensitive", "high"].includes(decision.privacy) &&
              (decision.localityPreference === undefined || ["auto", "local_only", "cloud_only", "local_preferred", "cloud_preferred"].includes(decision.localityPreference)) &&
              Array.isArray(decision.reasons) && decision.reasons.length <= 8 &&
              decision.reasons.every(reason => typeof reason === "string" && reason.length <= 256)) {
            inferred = decision;
            operation = decision.operation;
            inferredRealtime = decision.realtime;
            inferredComplexity = decision.complexity;
            providerId = decision.providerId.trim().slice(0, 128);
            providerConfidence = decision.confidence;
            trainedModel = decision.trainedModel === true;
          } else fallbackReason = "LOCAL_PROVIDER_OUTPUT_REJECTED";
        } catch { fallbackReason = controller.signal.aborted ? "LOCAL_PROVIDER_TIMEOUT" : "LOCAL_PROVIDER_FAILED"; }
        finally { clearTimeout(timer); controller.abort(); }
      }
    }
    if (!operation) {
      // Ambiguous free text is deliberately left for the caller to disambiguate.
      const matches = this.templates.filter(template => template.match?.(goal, context)).map(template => template.operation);
      if (matches.length !== 1) {
        throw new RuntimePlanningError("LOCAL_INTENT_UNSUPPORTED", "本地模板无法可靠拆解此目标，请提供明确的 operation 或 taskGraph。");
      }
      operation = matches[0];
    }
    const template = this.templates.find(item => item.operation === operation)!;
    const realtime = context.realtime ?? inferredRealtime ?? template.realtime;
    if (realtime !== "interactive" && realtime !== "deferred") {
      throw new RuntimePlanningError("REALTIME_INVALID", "realtime 应为 interactive 或 deferred。");
    }
    const deadlineMs = context.deadlineMs ?? (realtime === "interactive" ? 1500 : 30000);
    if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 300000) {
      throw new RuntimePlanningError("DEADLINE_INVALID", "deadlineMs 应为 0 到 300000 之间的正数。");
    }
    let privacy = context.privacy ?? template.privacy;
    if (!["public", "internal", "sensitive", "high"].includes(privacy as string)) {
      throw new RuntimePlanningError("PRIVACY_INVALID", "privacy 值无效。");
    }
    privacy = stricterPrivacy(privacy as PrivacyLevel, template.privacy, inferred?.privacy);
    const locality = context.locality ?? inferred?.localityPreference ?? "auto";
    if (!["auto", "local_only", "cloud_only", "local_preferred", "cloud_preferred"].includes(locality as string)) {
      throw new RuntimePlanningError("LOCALITY_INVALID", "locality 值无效。");
    }
    const minimumQuality = context.minimumQuality;
    if (minimumQuality !== undefined &&
        (typeof minimumQuality !== "number" || !Number.isFinite(minimumQuality) || minimumQuality < 0 || minimumQuality > 1)) {
      throw new RuntimePlanningError("MINIMUM_QUALITY_INVALID", "minimumQuality 应为 0 到 1 之间的数值。");
    }
    const energyBudgetMah = context.energyBudgetMah;
    if (energyBudgetMah !== undefined &&
        (typeof energyBudgetMah !== "number" || !Number.isFinite(energyBudgetMah) || energyBudgetMah <= 0)) {
      throw new RuntimePlanningError("ENERGY_BUDGET_INVALID", "energyBudgetMah 应为正数。");
    }
    if (context.allowDegrade !== undefined && typeof context.allowDegrade !== "boolean") {
      throw new RuntimePlanningError("ALLOW_DEGRADE_INVALID", "allowDegrade 应为布尔值。");
    }
    const priority = context.priority ?? inferred?.priority ?? (realtime === "interactive" ? "interactive" : "background");
    if (!["background", "normal", "interactive", "urgent"].includes(priority as string)) {
      throw new RuntimePlanningError("PRIORITY_INVALID", "priority 值无效。");
    }
    const templateComplexity = template.complexity;
    const complexity: TaskDemand["complexity"] =
      templateComplexity === "complex" || inferredComplexity === "complex" ? "complex" : "simple";
    const defaultPreference: UserPreference = realtime === "interactive"
      ? "speed"
      : complexity === "complex" ? "quality" : "energy";
    const preference = context.preference ?? defaultPreference;
    if (!["speed", "quality", "energy", "privacy"].includes(preference as string)) {
      throw new RuntimePlanningError("PREFERENCE_INVALID", "preference 值无效。");
    }
    const demand: TaskDemand = {
      operation, realtime, complexity,
      deadlineMs, priority: priority as TaskDemand["priority"],
      source: explicit ? "explicit_operation" : providerId ? "local_provider" : "local_template_rules",
      reasons: [
        explicit ? "调用方声明业务操作" : providerId ? "本地决策 Provider 达到置信度阈值" : "命中受限本地模板",
        inferredComplexity === "complex" && templateComplexity === "simple"
          ? "本地 Provider 将语义复杂度升级为 complex"
          : "复杂度至少遵循模板工作流结构",
        context.deadlineMs === undefined ? "使用交互类别的默认软实时预算" : "使用调用方的端到端预算",
        ...(fallbackReason ? [fallbackReason] : []),
        ...(inferred?.reasons ?? []),
      ],
      plannerVersion: providerId ?? this.version, trainedModel,
      decisionConfidence: providerConfidence,
    };
    const nodes = template.build(goal, context);
    return {
      graphId: createId("local-graph"), goal, planner: this.version, createdAt: new Date().toISOString(), demand,
      nodes: nodes.map(node => ({
        ...node,
        constraints: { ...node.constraints, privacy: stricterPrivacy(privacy as PrivacyLevel, node.constraints?.privacy), priority: demand.priority,
          deadlineMs: Math.min(deadlineMs, node.constraints?.deadlineMs ?? Infinity),
          allowDegrade: context.allowDegrade === true && node.constraints?.allowDegrade !== false,
          locality: mergeLocality(locality as ExecutionLocation, node.constraints?.locality),
          minimumQuality: minimumQuality === undefined ? node.constraints?.minimumQuality : Math.max(minimumQuality as number, node.constraints?.minimumQuality ?? 0),
          energyBudgetMah: energyBudgetMah === undefined ? node.constraints?.energyBudgetMah : Math.min(energyBudgetMah as number, node.constraints?.energyBudgetMah ?? Infinity),
          preference: preference as UserPreference },
        checkpointPolicy: node.checkpointPolicy ?? { enabled: true, stopOnResourcePressure: true },
      })),
    };
  }
}

function stricterPrivacy(...values: Array<PrivacyLevel | undefined>): PrivacyLevel {
  const levels: PrivacyLevel[] = ["public", "internal", "sensitive", "high"];
  return levels[Math.max(0, ...values.map(value => value ? levels.indexOf(value) : 0))];
}

function mergeLocality(requested: ExecutionLocation, template?: ExecutionLocation): ExecutionLocation {
  if (template === "local_only" || template === "cloud_only") {
    if ((requested === "local_only" || requested === "cloud_only") && requested !== template) {
      throw new RuntimePlanningError("LOCALITY_CONFLICT", "调用方位置约束与业务模板冲突。");
    }
    return template;
  }
  return requested === "auto" ? template ?? requested : requested;
}
