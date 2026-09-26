import { BadRequestException } from '@nestjs/common';
import { CloudRouteObservation } from './runtime.contracts';
import { estimateCloudRoute } from './cloud-route-cost';

export function clientRoute(value: unknown, inputBytes: number): CloudRouteObservation {
  if (!value || typeof value !== 'object') throw new BadRequestException('CLIENT_ROUTE_REQUIRED');
  const v = value as Record<string, unknown>;
  const number = (key: string): number => {
    const n = v[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new BadRequestException('CLIENT_ROUTE_METRICS_INVALID');
    return n;
  };
  if (v.source !== 'measured' || v.transferAuthorized !== true || typeof v.observedAt !== 'string') {
    throw new BadRequestException('CLIENT_ROUTE_NOT_MEASURED');
  }
  const route: CloudRouteObservation = { executorId: 'zeabur-shopping-workflow', inputResidence: 'device',
    outputDestination: 'device', accessMode: 'inline_transfer', transferAuthorized: true,
    inputBytes: Math.max(inputBytes, number('inputBytes')), outputBytes: Math.max(512 * 1024, number('outputBytes')),
    roundTripMs: number('roundTripMs'), uploadMbps: number('uploadMbps'), downloadMbps: number('downloadMbps'),
    queueMs: number('queueMs'), storageReadMs: 0, storageWriteMs: 0, source: 'measured', observedAt: v.observedAt };
  if (estimateCloudRoute({ taskId: 'validation', toolId: 'generic', inputRef: 'request', cloudRoutes: [route] }, route.executorId).reasons.length) {
    throw new BadRequestException('CLIENT_ROUTE_INVALID_OR_EXPIRED');
  }
  return route;
}
