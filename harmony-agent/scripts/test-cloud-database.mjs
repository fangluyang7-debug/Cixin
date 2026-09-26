import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = join(root, 'services/api-server');
const directory = await mkdtemp(join(tmpdir(), 'harmony-cloud-db-'));
const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
const env = { ...process.env, DATABASE_URL: databaseUrl };
const prismaCli = join(root, 'node_modules/prisma/build/index.js');
let prisma;

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: workspace, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Database initialization command failed');
}

function initialize() {
  run([prismaCli, 'db', 'execute', '--file', 'prisma/migrations/000001_init/migration.sql',
    '--schema', 'prisma/schema.prisma']);
  run(['prisma/patch-sqlite-schema.mjs']);
}

try {
  initialize();
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const sentinel = { id: 'cloud-test-sentinel', email: 'sentinel@example.invalid' };
  await prisma.user.create({ data: sentinel });
  await prisma.imageAsset.create({ data: { id: 'owned-asset', ownerUserId: sentinel.id,
    assetGroupId: 'group', variantType: 'compressed_recognition', bucketGroup: 'test', objectKey: 'test', uploadStatus: 'uploaded' } });
  await prisma.$disconnect();
  initialize();
  assert.equal((await prisma.imageAsset.findUnique({ where: { id: 'owned-asset' } }))?.ownerUserId, sentinel.id,
    'Repeated initialization must preserve asset ownership');
  assert.equal((await prisma.user.findUnique({ where: { id: sentinel.id } }))?.email,
    sentinel.email, 'Repeated initialization must preserve rows');
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = (model.dbName ?? model.name).replaceAll('"', '""');
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
    const names = new Set(columns.map((column) => column.name));
    for (const field of model.fields.filter((field) => field.kind !== 'object')) {
      assert.ok(names.has(field.dbName ?? field.name), `${model.name}.${field.name} is missing`);
    }
  }
  console.log(`PASS: fresh initialization, repeat startup, row preservation, ${Prisma.dmmf.datamodel.models.length} model column checks`);
} finally {
  await prisma?.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
