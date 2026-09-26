import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication } from '@nestjs/common';
import request = require('supertest');
import { ConfigService } from '@nestjs/config';
import { RuntimeController } from '../../src/modules/runtime/controllers/runtime.controller';
import { RuntimeMaintenanceGuard } from '../../src/modules/runtime/runtime-maintenance.guard';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { AuthService } from '../../src/modules/auth/application/auth.service';
import { JwtTokenService } from '../../src/modules/auth/application/jwt-token.service';
import { RuntimeRunService } from '../../src/core/runtime/runtime-run.service';
import { RuntimeEventBusService } from '../../src/core/runtime/runtime-event-bus.service';
import { RuntimeRunnerService } from '../../src/core/runtime/runtime-runner.service';
import { ToolRegistryService } from '../../src/core/runtime/tool-registry.service';
import { RuntimeSnapshotService } from '../../src/core/runtime/runtime-snapshot.service';
import { ResourceAwareSchedulerService } from '../../src/core/runtime/scheduler.service';
import { AgentRuntimeService } from '../../src/core/runtime/agent-runtime.service';
import { TelemetryService } from '../../src/core/runtime/telemetry.service';
import { PerformanceRegistryService } from '../../src/core/runtime/performance-registry.service';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

import { APP_GUARD } from '@nestjs/core';
import { ResourceOwnershipGuard } from '../../src/modules/auth/resource-ownership.guard';
@Controller('api/v1/sessions')
class LegacySessionController {
  @Get(':sessionId/conversation') getConversation() { return { allowed: true }; }
}

describe('Runtime HTTP authorization', () => {
  let app: INestApplication;
  let runs: RuntimeRunService;
  let events: RuntimeEventBusService;
  let own: string;
  let other: string;
  let a: string;
  let b: string;
  const cancel = jest.fn(() => true);
  beforeAll(async () => {
    const jwt = new JwtTokenService(new ConfigService({ auth: { jwtSecret: 'isolated-test-secret' } }));
    a = 'Bearer ' + jwt.sign({ userId: 'a', email: 'a@example.test' });
    b = 'Bearer ' + jwt.sign({ userId: 'b', email: 'b@example.test' });
    const prisma = { querySession: { findFirst: async ({ where }: any) => where.id === 'owned-session' && where.userId === 'a' ? { id: where.id } : null }, user: { findUnique: async ({ where }: any) => ({ id: where.id, email: where.id + '@example.test', status: 'active' }) } } as unknown as PrismaService;
    events = new RuntimeEventBusService();
    runs = new RuntimeRunService({} as ResourceAwareSchedulerService, events);
    own = runs.startBlockedGoal('private-a', 'BLOCKED', 'test', 'a').runId;
    other = runs.startBlockedGoal('private-b', 'BLOCKED', 'test', 'b').runId;
    runs.get(own)!.taskGraph = { graphId: 'g', goal: 'a', nodes: [], clientTaskId: 'client-a' };
    const module = await Test.createTestingModule({ controllers: [RuntimeController, LegacySessionController], providers: [
      JwtAuthGuard, RuntimeMaintenanceGuard,
      { provide: APP_GUARD, useClass: ResourceOwnershipGuard },
      { provide: PrismaService, useValue: prisma },
      { provide: AuthService, useValue: new AuthService(prisma, jwt) },
      { provide: RuntimeRunService, useValue: runs }, { provide: RuntimeEventBusService, useValue: events },
      { provide: RuntimeRunnerService, useValue: { cancel } },
      { provide: ToolRegistryService, useValue: { list: () => [] } },
      { provide: RuntimeSnapshotService, useValue: { getSnapshot: async () => ({ recentRuns: runs.list(), activeRun: runs.latest(), performanceSamples: ['private-global'] }) } },
      ...[ResourceAwareSchedulerService, AgentRuntimeService, TelemetryService, PerformanceRegistryService].map(provide => ({ provide, useValue: {} })),
    ] }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it('rejects anonymous and tampered tokens on all user runtime surfaces', async () => {
    for (const path of ['runs', 'snapshot', 'events', 'tools', 'runs/' + own]) {
      await request(app.getHttpServer()).get('/api/v1/runtime/' + path).expect(401);
    }
    await request(app.getHttpServer()).get('/api/v1/runtime/runs').set('Authorization', a + 'tampered').expect(401);
    await request(app.getHttpServer()).post(`/api/v1/runtime/runs/${own}/cancel`).expect(401);
  });
  it('protects legacy session subresources from cross-user access', async () => {
    await request(app.getHttpServer()).get('/api/v1/sessions/owned-session/conversation').expect(401);
    await request(app.getHttpServer()).get('/api/v1/sessions/owned-session/conversation').set('Authorization', b).expect(404);
    await request(app.getHttpServer()).get('/api/v1/sessions/owned-session/conversation').set('Authorization', a).expect(200);
  });
  it('filters list and snapshot and conceals foreign runs', async () => {
    const list = await request(app.getHttpServer()).get('/api/v1/runtime/runs').set('Authorization', a).expect(200);
    expect(list.body.data.runs.map((run: any) => run.runId)).toEqual([own]);
    const snapshot = await request(app.getHttpServer()).get('/api/v1/runtime/snapshot').set('Authorization', a).expect(200);
    expect(JSON.stringify(snapshot.body)).not.toContain('private-b');
    expect(snapshot.body.data.performanceSamples).toEqual([]);
    await request(app.getHttpServer()).get(`/api/v1/runtime/runs/${own}`).set('Authorization', b).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/runtime/runs/${own}`).set('Authorization', a).expect(200);
  });
  it('checks owner before cancellation and client telemetry, regardless of supplied owner', async () => {
    await request(app.getHttpServer()).post(`/api/v1/runtime/runs/${own}/cancel`).set('Authorization', b).send({ ownerUserId: 'a' }).expect(404);
    expect(cancel).not.toHaveBeenCalled();
    const body = { ownerUserId: 'a', taskId: 'client-a', timing: { requestMs: 1, uploadMs: null, downloadMs: null, inputBytes: 1, outputBytes: 1 } };
    await request(app.getHttpServer()).post(`/api/v1/runtime/runs/${own}/client-telemetry`).set('Authorization', b).send(body).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/runtime/runs/${own}/client-telemetry`).set('Authorization', a).send({ ...body, taskId: 'wrong' }).expect(409);
    await request(app.getHttpServer()).post(`/api/v1/runtime/runs/${own}/client-telemetry`).set('Authorization', a).send(body).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/runtime/runs/${own}/cancel`).set('Authorization', a).expect(202);
  });
  it('does not let ordinary JWT holders forge plans, verification or server performance samples', async () => {
    for (const path of ['plan', 'agent/plan', 'replan', 'telemetry', 'verify']) {
      await request(app.getHttpServer()).post('/api/v1/runtime/' + path).set('Authorization', a).send({ runId: own }).expect(403);
    }
  });
  it('filters replay and live events with the same owner predicate', () => {
    const seen: string[] = [];
    events.emit({ type: 'plan_blocked', runId: other, message: 'private-b' });
    events.emit({ type: 'plan_blocked', runId: own, message: 'private-a' });
    const subscription = events.sse(event => !!event.runId && runs.get(event.runId)?.ownerUserId === 'a')
      .subscribe(event => { if ('message' in event.data) seen.push(event.data.message); });
    events.emit({ type: 'plan_blocked', runId: other, message: 'private-b-live' });
    events.emit({ type: 'plan_blocked', runId: own, message: 'private-a-live' });
    subscription.unsubscribe(); expect(seen).toEqual(['private-a', 'private-a-live']);
  });
});
