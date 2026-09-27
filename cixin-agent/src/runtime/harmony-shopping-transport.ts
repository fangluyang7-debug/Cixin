import { HarmonyShoppingRequest, HarmonyShoppingResponse, HarmonyShoppingTransport } from '../contracts/harmony-shopping';

/** HTTP adapter used when a Cixin board is selected by the scheduler. */
export class HttpHarmonyShoppingTransport implements HarmonyShoppingTransport {
  constructor(private readonly baseUrl: string, private readonly bearerToken: string) {}

  async submit(request: HarmonyShoppingRequest, signal?: AbortSignal): Promise<HarmonyShoppingResponse> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/shopping/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.bearerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new Error(`HARMONY_SHOPPING_HTTP_${response.status}`);
    const envelope = await response.json() as { success?: boolean; data?: HarmonyShoppingResponse };
    if (!envelope.success || !envelope.data?.runId) throw new Error('HARMONY_SHOPPING_INVALID_RESPONSE');
    return envelope.data;
  }

  async cancel(runId: string, signal?: AbortSignal): Promise<{ executionState: string }> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/runtime/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.bearerToken}`, 'content-type': 'application/json' },
      signal,
    });
    if (!response.ok) throw new Error(`HARMONY_RUNTIME_CANCEL_HTTP_${response.status}`);
    const envelope = await response.json() as { data?: { executionState?: string } };
    return { executionState: envelope.data?.executionState ?? 'unknown' };
  }
}
