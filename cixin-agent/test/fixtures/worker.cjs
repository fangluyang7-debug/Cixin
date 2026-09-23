// Test-only CPU worker; does not represent a NOE/GPU implementation.
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const request = JSON.parse(input);
  if (request.operation === 'probe') {
    process.stdout.write(JSON.stringify({ protocolVersion: 1, available: true,
      backend: process.argv.includes('--wrong-backend') ? 'NPU' : 'CPU',
      modelSha256: request.modelSha256, runtimeVersion: request.runtime.version })); return;
  }
  if (request.input?.wait) await new Promise(resolve => setTimeout(resolve, 10000));
  process.stdout.write(JSON.stringify({ protocolVersion: 1, modelSha256: request.modelSha256,
    runtimeVersion: request.runtime.version, quality: 1,
    result: { output: { echo: request.input }, telemetry: { profileId: request.profile.id,
      actualBackend: 'CPU', actualModelTier: request.profile.modelTier, workerCount: request.profile.workerCount,
      actualThreads: request.profile.workerCount, executionPath: 'cpu_test_fixture' } } }));
});
