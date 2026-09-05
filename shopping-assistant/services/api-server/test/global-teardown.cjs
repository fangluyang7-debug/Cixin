const { rmSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async () => {
  const prismaDir = join(__dirname, '..', 'prisma');
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    rmSync(join(prismaDir, `test.db${suffix}`), { force: true });
  }
};
