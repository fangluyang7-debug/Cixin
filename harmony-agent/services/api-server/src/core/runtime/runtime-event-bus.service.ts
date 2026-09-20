import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export const RUNTIME_EVENT_TYPES = [
  "task_graph_received",
  "candidate_evaluated",
  "executor_selected",
  "plan_blocked",
  "telemetry_recorded",
  "verification_failed",
  "replan_requested",
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export interface RuntimeEvent {
  type: RuntimeEventType;
  message: string;
  emittedAt: string;
  runId?: string;
  graphId?: string;
  taskId?: string;
  toolId?: string;
  executorId?: string;
  payload?: Record<string, unknown>;
}

export type RuntimeEventInput = Omit<RuntimeEvent, "emittedAt"> & {
  emittedAt?: string;
};

@Injectable()
export class RuntimeEventBusService {
  private readonly subject = new Subject<RuntimeEvent>();
  private readonly recent: RuntimeEvent[] = [];
  private readonly maxRecent = 200;

  emit(input: RuntimeEventInput): RuntimeEvent {
    const event: RuntimeEvent = {
      ...input,
      emittedAt: input.emittedAt ?? new Date().toISOString(),
    };
    this.recent.push(event);
    if (this.recent.length > this.maxRecent) this.recent.shift();
    this.subject.next(event);
    return event;
  }

  replay() {
    return [...this.recent];
  }

  stream(): Observable<RuntimeEvent> {
    return this.subject.asObservable();
  }

  sse(): Observable<{ type: string; data: RuntimeEvent | { emittedAt: string } }> {
    return new Observable((subscriber) => {
      for (const event of this.replay()) {
        subscriber.next({ type: event.type, data: event });
      }
      const subscription = this.subject.subscribe((event) => {
        subscriber.next({ type: event.type, data: event });
      });
      const heartbeat = setInterval(() => {
        subscriber.next({
          type: "heartbeat",
          data: { emittedAt: new Date().toISOString() },
        });
      }, 15000);
      return () => {
        subscription.unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }
}
