import { RuntimeProbeController } from '../../src/modules/runtime/controllers/runtime-probe.controller';
import { CloudReadinessService } from '../../src/core/runtime/cloud-readiness.service';
it('serves bounded probes and reports dependency status without invoking business search', async () => {
  const check = jest.fn().mockResolvedValue({ available: false, checkedAt: new Date().toISOString(), checks: {} });
  const controller = new RuntimeProbeController({ check } as unknown as CloudReadinessService);
  expect(controller.ping()).toMatchObject({ data: { available: true } });
  expect(controller.upload({ payload: 'x'.repeat(32768) })).toMatchObject({ data: { receivedBytes: 32768 } });
  expect(() => controller.upload({ payload: 'x'.repeat(65537) })).toThrow();
  expect(() => controller.upload({ payload: '<business-data>' })).toThrow();
  expect(controller.download().data!.padding).toHaveLength(32768);
  expect((await controller.minimal()).data!.queueMs).toBeGreaterThanOrEqual(0);
  expect(await controller.dependencies()).toMatchObject({ data: { available: false } });
  expect(check).toHaveBeenCalledTimes(1);
});
