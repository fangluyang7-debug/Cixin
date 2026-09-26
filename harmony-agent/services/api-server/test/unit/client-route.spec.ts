import { clientRoute } from '../../src/core/runtime/client-route';
import { estimateCloudRoute } from '../../src/core/runtime/cloud-route-cost';
import { shoppingTask } from '../../src/core/runtime/shopping-task-graph';
const observation = () => ({ source: 'measured', transferAuthorized: true, observedAt: new Date().toISOString(),
  inputBytes: 100, outputBytes: 100, roundTripMs: 10, uploadMbps: 10, downloadMbps: 20, queueMs: 2 });
it('uses actual request size as a lower bound, excludes client fee claims and keeps bandwidth evidence', () => {
  const route = clientRoute({ ...observation(), estimatedFeeMinorUnits: 0 }, 1024 * 1024);
  expect(route.inputBytes).toBe(1024 * 1024);
  expect(route.estimatedFeeMinorUnits).toBeUndefined();
  const result = estimateCloudRoute({ taskId: 'a', toolId: 'generic', inputRef: 'r', cloudRoutes: [route] }, route.executorId);
  expect(result.overheadMs).toBeCloseTo(10 + 2 + 838.8608 + 209.7152);
});
it.each([{ uploadMbps: 0 }, { downloadMbps: NaN }, { source: 'declared' }, { observedAt: new Date(0).toISOString() },
  { transferAuthorized: false }, { observedAt: new Date(Date.now() + 60000).toISOString() }])('rejects unusable evidence %j', patch => {
  expect(() => clientRoute({ ...observation(), ...patch }, 100)).toThrow();
});
it('distinguishes in-process steps from static network declarations', () => {
  const task = shoppingTask('a', 'generic', 'r');
  expect(estimateCloudRoute(task, 'zeabur-shopping-workflow').reasons).toEqual([]);
  task.cloudRoutes![0].source = 'declared';
  expect(estimateCloudRoute(task, 'zeabur-shopping-workflow').reasons).toContain('CLOUD_ROUTE_NOT_MEASURED');
});
