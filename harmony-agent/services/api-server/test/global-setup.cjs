const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const { dirname, join } = require('node:path');

module.exports = async () => {
  const apiRoot = join(__dirname, '..');
  const prismaDir = join(apiRoot, 'prisma');
  const schemaPath = join(prismaDir, 'schema.prisma');
  const initialMigration = join(
    prismaDir,
    'migrations',
    '000001_init',
    'migration.sql',
  );
  const patchScript = join(prismaDir, 'patch-sqlite-schema.mjs');
  const prismaPackage = require.resolve('prisma/package.json');
  const prismaCli = join(dirname(prismaPackage), 'build', 'index.js');

  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    rmSync(join(prismaDir, `test.db${suffix}`), { force: true });
  }

  execFileSync(
    process.execPath,
    [
      prismaCli,
      'db',
      'execute',
      '--file',
      initialMigration,
      '--schema',
      schemaPath,
    ],
    {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: 'file:./test.db' },
      stdio: 'inherit',
    },
  );
  execFileSync(process.execPath, [patchScript], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  });
};
