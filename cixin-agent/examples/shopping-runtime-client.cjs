// Run from an existing shopping backend. No SDK/hardware decisions in business code.
class CixinRuntimeClient {
  constructor(baseUrl, token) { this.baseUrl = baseUrl; this.token = token; }
  async call(path, body) {
    const response = await fetch(new URL(path, this.baseUrl), { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Cixin Runtime HTTP ${response.status}`);
    return response.json();
  }
  searchVectors(input, constraints = {}) {
    return this.call('/api/v1/runtime/tasks', { toolId: 'catalog.vector_search', input, constraints });
  }
  submitGraph(taskGraph, inputs, constraints = {}) {
    return this.call('/api/v1/runtime/graphs', { taskGraph, inputs, constraints });
  }
  getRun(runId) { return this.call(`/api/v1/runtime/runs/${encodeURIComponent(runId)}`); }
}
module.exports = { CixinRuntimeClient };
