/**
 * Cixin's optional bridge to the canonical Harmony shopping Runtime.
 * The bridge transports a task envelope only; model keys and business data
 * remain owned by the Harmony service.
 */
export interface HarmonyShoppingTransport {
  submit(request: HarmonyShoppingRequest, signal?: AbortSignal): Promise<HarmonyShoppingResponse>;
  cancel(runId: string, signal?: AbortSignal): Promise<{ executionState: string }>;
}

export interface HarmonyShoppingRequest {
  taskId: string;
  operation: 'text' | 'image_upload' | 'read' | 'refine' | 'prices' | 'answer';
  input?: unknown;
  sessionId?: string;
  taskProfile: Record<string, unknown>;
  deviceProfile: Record<string, unknown>;
  networkProfile: Record<string, unknown>;
}

export interface HarmonyShoppingResponse {
  runId: string;
  taskId: string;
  status: string;
  result?: unknown;
  serverTiming?: Record<string, number>;
}
