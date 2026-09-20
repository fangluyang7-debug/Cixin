import { ConfigService } from "@nestjs/config";
import { CloudPlatformAdapterService } from "../../src/core/runtime/cloud-platform-adapter.service";

describe("CloudPlatformAdapterService", () => {
  it("does not treat configured credentials as proof of a usable cloud executor", async () => {
    const config = new ConfigService({
      modelProviders: {
        vision: {
          baseUrl: "https://provider.invalid/v1",
          apiKey: "configured-but-not-tested",
          modelName: "configured-model",
        },
      },
      embedding: {
        baseUrl: "https://provider.invalid/v1",
        apiKey: "configured-but-not-tested",
        modelName: "configured-model",
      },
    });
    const adapter = new CloudPlatformAdapterService(config);

    const executors = await adapter.discoverExecutors();

    expect(executors.length).toBeGreaterThan(0);
    expect(executors.every((executor) => executor.available === false)).toBe(
      true,
    );
    expect(
      executors.some((executor) =>
        executor.availabilityReason?.includes(
          "PROVIDER_SPECIFIC_PROBE_NOT_IMPLEMENTED",
        ),
      ),
    ).toBe(true);
  });
});
