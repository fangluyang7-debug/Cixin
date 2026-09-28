import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

// Never uses .env or the project database. Each scenario gets its own disposable SQLite file.
const directory = await mkdtemp(path.join(tmpdir(), 'harmony-artifact-migration-'));
const apply = async (client, name) => {
  const sql = await readFile(new URL('../services/api-server/prisma/migrations/' + name + '/migration.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
};
try {
  for (const oldDatabase of [false, true]) {
    const client = new PrismaClient({ datasourceUrl: 'file:' + path.join(directory, oldDatabase ? 'old.db' : 'empty.db').replaceAll('\\', '/') });
    try {
      if (oldDatabase) {
        await apply(client, '000001_init');
        await client.$executeRawUnsafe(`INSERT INTO ImageAsset (id,assetGroupId,variantType,isPrimaryRecognitionAsset,bucketGroup,objectKey,uploadStatus) VALUES ('keep','group','original_source',0,'recognition','old.jpg','uploaded')`);
      }
      for (const name of ['000002_artifacts','000003_workflows','000004_session_mutations']) { await apply(client,name); await apply(client,name); }
      await client.artifactRecord.create({ data: { id: 'artifact_test', ownerId: 'owner', kind: 'shopping.query', schemaId: 'shopping.query', schemaVersion: 1,
        contentVersion: 1, contentHash: '0'.repeat(64), sizeBytes: 2, mediaType: 'application/json', state: 'COMMITTED', locatorJson: '{}', dependenciesJson: '[]', payloadJson: '{}' } });
      assert.equal(await client.artifactRecord.count(), 1);
      if (oldDatabase) assert.equal((await client.$queryRawUnsafe('SELECT objectKey FROM ImageAsset WHERE id = ?', 'keep'))[0].objectKey, 'old.jpg');
      console.log('PASS additive/idempotent Artifact migration on ' + (oldDatabase ? 'old schema with existing row' : 'empty database'));
    } finally { await client.$disconnect(); }
  }
} finally {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('harmony-artifact-migration-')) throw new Error('Unsafe temporary directory');
  await rm(resolved, { recursive: true, force: true });
}
