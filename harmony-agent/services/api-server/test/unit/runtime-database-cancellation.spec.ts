import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { RuntimeWorkScope } from '../../src/core/runtime/runtime-work-scope';

describe('Scoped database cancellation', () => {
  let prisma: PrismaService;
  let folder: string;
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'runtime-db-'));
    process.env.DATABASE_URL = 'file:' + join(folder, 'scope.db').replaceAll('\\', '/');
    prisma = new PrismaService(); await prisma.onModuleInit();
    await prisma.$executeRawUnsafe('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL UNIQUE, "displayName" TEXT, "status" TEXT NOT NULL DEFAULT \'active\', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  });
  afterAll(async () => {
    await prisma?.onModuleDestroy();
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (folder) await rm(folder, { recursive: true, force: true });
  });
  it('uses real Prisma delegates and rejects new writes after stop, including transactions', async () => {
    await prisma.user.create({ data: { id: 'before', email: 'before@example.test' } });
    const controller = new AbortController();
    const measurements = { storageReadMs: 0, storageWriteMs: 0, modelMs: 0 };
    await expect(RuntimeWorkScope.run(controller.signal, measurements, async () => {
      const user = await prisma.user.findUnique({ where: { id: 'before' } });
      expect(user?.id).toBe('before');
      controller.abort(new Error('RUNTIME_CANCELLED'));
      await prisma.user.create({ data: { id: 'after', email: 'after@example.test' } });
    })).rejects.toThrow('RUNTIME_CANCELLED');
    await expect(RuntimeWorkScope.run(controller.signal, measurements, () => prisma.$transaction(async tx => {
      return tx.user.create({ data: { id: 'tx', email: 'tx@example.test' } });
    }))).rejects.toThrow('RUNTIME_CANCELLED');
    expect(await prisma.user.count()).toBe(1);
  });
  it('waits for explicitly tracked background work before confirming settlement', async () => {
    let finish!: () => void; let ended = false;
    const child = new Promise<void>(resolve => { finish = resolve; });
    const work = RuntimeWorkScope.run(new AbortController().signal, { storageReadMs: 0, storageWriteMs: 0, modelMs: 0 }, async () => {
      RuntimeWorkScope.track(child); return 'result';
    }).then(() => { ended = true; });
    await Promise.resolve(); expect(ended).toBe(false);
    finish(); await work; expect(ended).toBe(true);
  });
});
