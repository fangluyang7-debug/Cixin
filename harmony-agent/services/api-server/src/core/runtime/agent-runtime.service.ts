import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  ExecutionPlan,
  TaskGraph,
  TelemetryRecord,
  VerificationResult,
} from "./runtime.contracts";
import { ResourceAwareSchedulerService } from "./scheduler.service";
import { TelemetryService } from "./telemetry.service";

export const AGENT_PLANNER = Symbol("AGENT_PLANNER");

export interface AgentPlanner {
  planGoal(input: {
    goal: string;
    context?: Record<string, unknown>;
  }): Promise<TaskGraph>;
}

export interface AgentPlanResult {
  status: "ready" | "blocked";
  taskGraph: TaskGraph | null;
  executionPlan: ExecutionPlan | null;
  missingRequirements: Array<{ code: string; message: string }>;
}

@Injectable()
export class AgentRuntimeService {
  constructor(
    private readonly scheduler: ResourceAwareSchedulerService,
    private readonly telemetry: TelemetryService,
    @Optional() @Inject(AGENT_PLANNER) private readonly planner?: AgentPlanner,
  ) {}

  async planGoal(input: {
    goal: string;
    context?: Record<string, unknown>;
  }): Promise<AgentPlanResult> {
    if (!this.planner) {
      return {
        status: "blocked",
        taskGraph: null,
        executionPlan: null,
        missingRequirements: [
          {
            code: "AGENT_PLANNER_NOT_CONFIGURED",
            message: "没有配置可验证的 Agent Planner，不能猜测用户目标对应的任务图。",
          },
        ],
      };
    }
    const taskGraph = await this.planner.planGoal(input);
    return this.scheduleGraph(taskGraph);
  }

  async scheduleGraph(taskGraph: TaskGraph, runId?: string): Promise<AgentPlanResult> {
    const executionPlan = await this.scheduler.plan(taskGraph, { runId });
    return {
      status: executionPlan.status,
      taskGraph,
      executionPlan,
      missingRequirements: executionPlan.missingRequirements.map((requirement) => ({
        code: requirement.code,
        message: requirement.message,
      })),
    };
  }

  async observeAndReplan(input: {
    taskGraph: TaskGraph;
    telemetry: TelemetryRecord[];
    runId?: string;
  }) {
    for (const record of input.telemetry) {
      this.telemetry.record(record);
    }
    return this.scheduleGraph(input.taskGraph, input.runId);
  }

  verify(
    assignment: Parameters<TelemetryService["verify"]>[0],
    tool: Parameters<TelemetryService["verify"]>[1],
    telemetry: TelemetryRecord,
  ): VerificationResult {
    return this.telemetry.verify(assignment, tool, telemetry);
  }
}
