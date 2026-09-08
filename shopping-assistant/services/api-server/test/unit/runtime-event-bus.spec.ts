import { firstValueFrom } from "rxjs";
import { RuntimeEventBusService } from "../../src/core/runtime/runtime-event-bus.service";

describe("RuntimeEventBusService", () => {
  it("replays recent events to a new SSE subscriber", async () => {
    const bus = new RuntimeEventBusService();
    bus.emit({
      type: "task_graph_received",
      runId: "run_1",
      graphId: "graph-1",
      message: "使用上传图片检索商品",
    });

    const stream = bus.sse();
    const first = await firstValueFrom(stream);

    expect(first.type).toBe("task_graph_received");
    expect(first.data).toMatchObject({
      runId: "run_1",
      graphId: "graph-1",
      message: "使用上传图片检索商品",
    });
  });

  it("keeps a bounded replay buffer", () => {
    const bus = new RuntimeEventBusService();
    for (let index = 0; index < 210; index += 1) {
      bus.emit({
        type: "candidate_evaluated",
        message: `event ${index}`,
        payload: { index },
      });
    }

    expect(bus.replay()).toHaveLength(200);
    expect(bus.replay()[0].payload).toEqual({ index: 10 });
  });
});
