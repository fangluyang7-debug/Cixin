import { ShoppingResultV1, validShoppingResultV1 } from './ShoppingPayloads';
import { Product } from './Product';

export interface CandidatePrice { amount: string | number; currency: string; }
export interface ShoppingCandidate {
  candidateItemId: string;
  productId?: string;
  productPoolKey?: string;
  externalId?: string;
  title: string;
  platformName: string;
  price: CandidatePrice;
  shopName?: string;
  shopType?: string;
  stockStatus?: string;
  coverImageUrl?: string;
  productUrl?: string;
}
export interface ShoppingCandidateSet { items: ShoppingCandidate[]; candidateSnapshotId?: string; }
export interface ShoppingSession { sessionId: string; stateVersion?: number; degraded?: boolean; }
export interface ShoppingAnswer { kind: string; text: string; candidateCount?: number; }
export interface ShoppingPrice { candidateItemId: string; price: CandidatePrice; stockStatus: string; }
export interface ShoppingResponseData {
  runtimeRunId: string;
  taskId?: string;
  status?: string;
  session?: ShoppingSession;
  candidates?: ShoppingCandidateSet;
  assistantMessage?: ShoppingAnswer | string;
  prices?: ShoppingPrice[];
  priceSource?: string;
  stateVersion?: number;
  requestRevision?: number;
  serverTiming?: ShoppingServerTiming;
}
export interface ShoppingServerTiming { queueMs: number | null; computeMs?: number; executionMs?: number; }
export interface ShoppingEnvelope { success: boolean; data: ShoppingResponseData; }
export interface ShoppingResult {
  operation: string;
  runtimeRunId: string;
  taskId: string;
  sessionId: string | null;
  stateVersion: number | null;
  requestRevision: number | null;
  products: Product[] | null;
  answer: ShoppingAnswer | string | null;
  prices: ShoppingPrice[] | null;
  payload: ShoppingResultV1;
  // Private lossless snapshot accompanies the generated typed business payload.
  payloadJson: string;
}
export function decodeShoppingResult(body: string, operation: string, taskId: string): ShoppingResult {
  const envelope = JSON.parse(body) as ShoppingEnvelope;
  if (envelope === null || envelope.success !== true || envelope.data === null ||
    typeof envelope.data !== 'object' || !/^run_[A-Za-z0-9_-]+$/.test(envelope.data.runtimeRunId)) {
    throw new Error('CLOUD_INVALID_RESULT');
  }
  const data = envelope.data;
  if (data.status !== undefined && !validShoppingResultV1(JSON.parse(JSON.stringify(data)) as ShoppingResultV1)) { throw new Error('CLOUD_PAYLOAD_SCHEMA_INVALID'); }
  if (data.status !== undefined && data.status !== 'succeeded') { throw new Error('CLOUD_INVALID_RESULT'); }
  const operations = ['text', 'image', 'image_upload', 'read', 'refine', 'prices', 'answer', 'subject', 'profile', 'turn', 'more'];
  if (operations.indexOf(operation) < 0) { throw new Error('CLOUD_OPERATION_UNSUPPORTED'); }
  if (data.candidates !== undefined && !Array.isArray(data.candidates.items)) { throw new Error('CLOUD_INVALID_CANDIDATES'); }
  const products: Product[] | null = data.candidates === undefined ? null : data.candidates.items.map((item: ShoppingCandidate): Product => {
    if (!item || typeof item.candidateItemId !== 'string' || item.candidateItemId.length === 0 ||
      typeof item.title !== 'string' || typeof item.platformName !== 'string' || !item.price ||
      typeof item.price.currency !== 'string' ||
      (typeof item.price.amount !== 'string' && typeof item.price.amount !== 'number') ||
      !/^[0-9]+(\.[0-9]+)?$/.test(String(item.price.amount))) { throw new Error('CLOUD_INVALID_CANDIDATE'); }
    const product = new Product(item.externalId ?? '', item.platformName, item.title, String(item.price.amount),
      item.price.currency, item.stockStatus ?? '', item.shopName ?? '', item.shopType ?? '', item.productUrl ?? '', item.coverImageUrl ?? '');
    product.sessionId = data.session?.sessionId;
    product.candidateItemId = item.candidateItemId;
    product.productId = item.productId;
    product.productPoolKey = item.productPoolKey;
    return product;
  });
  return { operation: operation, runtimeRunId: data.runtimeRunId, taskId: data.taskId ?? taskId,
    sessionId: data.session?.sessionId ?? null, stateVersion: data.stateVersion ?? data.session?.stateVersion ?? null,
    requestRevision: data.requestRevision ?? null, products: products, answer: data.assistantMessage ?? null,
    prices: data.prices ?? null, payload: JSON.parse(JSON.stringify(data)) as ShoppingResultV1, payloadJson: JSON.stringify(data) };
}
