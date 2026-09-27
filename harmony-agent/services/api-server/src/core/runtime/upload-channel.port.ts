/** Uploads are intentionally separate from model execution and scheduling. */
export interface UploadChannelPort {
  createUpload(input: UploadRequest, signal?: AbortSignal): Promise<UploadReceipt>;
  getDownloadUrl(assetId: string, signal?: AbortSignal): Promise<string | null>;
}

export interface UploadRequest {
  ownerUserId: string;
  content: Uint8Array | Buffer;
  contentType: string;
  filename?: string;
  purpose: 'shopping-image' | 'model-input' | 'dataset';
}

export interface UploadReceipt {
  assetId: string;
  bytes: number;
  contentType: string;
  expiresAt?: string;
}
