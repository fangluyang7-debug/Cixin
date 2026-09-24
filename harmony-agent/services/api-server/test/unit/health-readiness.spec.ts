import { ConfigService } from '@nestjs/config';
import { HealthController } from '../../src/modules/health/controllers/health.controller';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

describe('HealthController readiness', () => {
  const storage = {
    provider: 'tencent_cos', region: 'ap-test', secretId: 'not-printed',
    secretKey: 'not-printed', buckets: {
      compressedRecognition: 'recognition', originalSource: 'original', demoAssets: 'demo',
    },
  };

  it('checks the database and reports COS configuration without exposing secrets', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]) } as unknown as PrismaService;
    const controller = new HealthController(prisma, new ConfigService({ objectStorage: storage }));
    const result = await controller.getReadiness();
    expect(result.data).toEqual({ database: 'connected', objectStorage: 'configured_not_probed' });
    expect(JSON.stringify(result)).not.toContain('not-printed');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails readiness when the mounted database is unavailable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('disk unavailable')) } as unknown as PrismaService;
    const controller = new HealthController(prisma, new ConfigService({ objectStorage: storage }));
    await expect(controller.getReadiness()).rejects.toMatchObject({ status: 503 });
  });
});
