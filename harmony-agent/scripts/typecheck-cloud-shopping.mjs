// TypeScript compatibility check for the new application client; not a substitute for DevEco ArkTS/HAP validation.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const root = path.resolve(import.meta.dirname, '../apps/harmony').replaceAll('\\', '/');
const virtual = root + '/cloud-check.d.ts';
const scheduler = root + '/cloud-scheduler.ts';
const files = new Map([
  [scheduler, `export * from './scheduler/src/main/ets/api/SchedulerTypes';
export * from './scheduler/src/main/ets/api/SchedulerClient';
export * from './scheduler/src/main/ets/placement/PlacementPolicy';`],
  [virtual, `declare module '@kit.AbilityKit' { export namespace common { interface Context {} } }
declare module '@kit.ArkData' { export const preferences: { getPreferences(context: Object, options: { name: string }): Promise<{ get(key: string, value: string): Promise<string>; put(key: string, value: string): Promise<void>; flush(): Promise<void> }> }; }
declare module '@kit.CoreFileKit' { export const fileIo: { OpenMode: { READ_ONLY: number }; openSync(uri: string, mode: number): { fd: number }; statSync(fd: number): { size: number }; readSync(fd: number, buffer: ArrayBuffer): number; closeSync(file: { fd: number }): void }; }
declare module '@kit.ArkTS' { export namespace util { class Base64Helper { encodeToStringSync(bytes: Uint8Array): string; } } }
declare module '@kit.NetworkKit' { export namespace http {
  enum RequestMethod { GET, POST }
  interface DataSendProgressInfo { sendSize: number; totalSize: number; }
  interface HttpResponse { responseCode: number; result: string | Object | ArrayBuffer;
    performanceTiming: { firstSendTiming: number; firstReceiveTiming: number; totalFinishTiming: number }; }
  interface HttpRequestOptions { method: RequestMethod; header: Object; extraData: string; connectTimeout: number; readTimeout: number; }
  interface HttpRequest { request(url: string, options: HttpRequestOptions): Promise<HttpResponse>;
    on(type: 'dataSendProgress', callback: (progress: DataSendProgressInfo) => void): void;
    off(type: 'dataSendProgress'): void; destroy(): void; }
  function createHttp(): HttpRequest;
} }`],
]);
const options = { noEmit: true, strict: false, skipLibCheck: true, target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, types: [],
  baseUrl: root, paths: { scheduler: [scheduler] } };
const host = ts.createCompilerHost(options);
const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
const alternate = file => { const f=file.replaceAll('\\','/'); return f.startsWith(root) && f.endsWith('.ts') ? f.slice(0,-3)+'.ets' : null; };
host.fileExists = file => files.has(file.replaceAll('\\','/')) || exists(file) || !!(alternate(file) && exists(alternate(file)));
host.readFile = file => files.get(file.replaceAll('\\','/')) ?? (alternate(file) && exists(alternate(file)) ? read(alternate(file)) : read(file));
host.getSourceFile = (file, version) => { const text=host.readFile(file); return text === undefined ? undefined : ts.createSourceFile(file,text,version); };
const entries = ['ShoppingTaskService','CloudShoppingExecutor','CloudApiConfig'].map(name=>root+'/entry/src/main/ets/services/'+name+'.ts');
const program=ts.createProgram([...entries,virtual],options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));process.exitCode=1; }
else console.log('Cloud shopping client TypeScript compatibility check passed (SDK boundary declarations; native build still required)');
