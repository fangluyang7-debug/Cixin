import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const etsRoot = path.resolve(import.meta.dirname, '../apps/harmony/scheduler/src/main/ets');
const entries = [path.join(etsRoot, 'api/SchedulerService.ts'),
  path.join(etsRoot, 'placement/PlacementPolicy.ts')];
const options = { noEmit: true, strict: false, skipLibCheck: true,
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, types: [] };
const host = ts.createCompilerHost(options);
const originalRead = host.readFile.bind(host);
const originalExists = host.fileExists.bind(host);
const originalGetSourceFile = host.getSourceFile.bind(host);
const normalizedRoot = etsRoot.replaceAll('\\', '/');
const etsPath = file => {
  const normalized = file.replaceAll('\\', '/');
  return normalized.startsWith(normalizedRoot) && normalized.endsWith('.ts') ?
    `${normalized.slice(0, -3)}.ets` : null;
};
host.fileExists = file => originalExists(file) || (etsPath(file) !== null && originalExists(etsPath(file)));
host.readFile = file => {
  const alternate = etsPath(file);
  return alternate !== null && fs.existsSync(alternate) ? fs.readFileSync(alternate, 'utf8') : originalRead(file);
};
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
  const alternate = etsPath(file);
  if (alternate !== null && fs.existsSync(alternate)) {
    return ts.createSourceFile(file, fs.readFileSync(alternate, 'utf8'), languageVersion);
  }
  return originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
};
const program = ts.createProgram(entries, options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
  }));
  process.exitCode = 1;
} else {
  process.stdout.write('Scheduler core TypeScript compatibility check passed\n');
}
