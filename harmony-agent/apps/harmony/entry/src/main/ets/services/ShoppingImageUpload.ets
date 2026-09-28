import { http } from '@kit.NetworkKit';
import { fileIo } from '@kit.CoreFileKit';
import { ArtifactRef, CancellationSignal, ClockPort } from 'scheduler';
import { CloudApiConfig } from './CloudApiConfig';

interface UploadData { assetId: string; artifactRef?: ArtifactRef; }
interface UploadEnvelope { success: boolean; data: UploadData; }
export interface UploadedShoppingImage { assetId: string; imageArtifact?: ArtifactRef; }

// Data-plane slot is independent of compute admission. Held until the HTTP promise settles.
export class ShoppingImageUpload {
  private static active: boolean = false;
  public static async upload(uri: string, clock: ClockPort, deadline: number,
    signal?: CancellationSignal): Promise<UploadedShoppingImage> {
    while (ShoppingImageUpload.active) {
      ShoppingImageUpload.check(clock, deadline, signal);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    ShoppingImageUpload.check(clock, deadline, signal);
    ShoppingImageUpload.active = true;
    const request = http.createHttp();
    const unsubscribe = signal?.onCancelled(() => request.destroy());
    try {
      const file = fileIo.openSync(uri, fileIo.OpenMode.READ_ONLY);
      let bytes: Uint8Array;
      try {
        const size = fileIo.statSync(file.fd).size;
        if (size <= 0 || size > 6 * 1024 * 1024) { throw new Error('CLOUD_IMAGE_TOO_LARGE'); }
        const buffer = new ArrayBuffer(size);
        if (fileIo.readSync(file.fd, buffer) !== size) { throw new Error('CLOUD_IMAGE_READ_FAILED'); }
        bytes = new Uint8Array(buffer);
      } finally { fileIo.closeSync(file); }
      const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' :
        bytes[0] === 0x52 && bytes[1] === 0x49 ? 'image/webp' : 'image/jpeg';
      const boundary = 'harmony_upload_' + Date.now().toString(16);
      const prefix = ShoppingImageUpload.ascii('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="image"\r\nContent-Type: ' + mime + '\r\n\r\n');
      const suffix = ShoppingImageUpload.ascii('\r\n--' + boundary + '--\r\n');
      const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
      body.set(prefix); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length);
      ShoppingImageUpload.check(clock, deadline, signal);
      const remaining = deadline - clock.now();
      const headers = CloudApiConfig.requestHeaders();
      headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary;
      const response = await request.request(CloudApiConfig.getBaseUrl() + '/api/v1/assets/images', {
        method: http.RequestMethod.POST, header: headers, extraData: body.buffer,
        connectTimeout: Math.min(10000, remaining), readTimeout: remaining
      });
      ShoppingImageUpload.check(clock, deadline, signal);
      if (response.responseCode < 200 || response.responseCode >= 300) { throw new Error('CLOUD_UPLOAD_HTTP_' + response.responseCode); }
      const envelope = JSON.parse(String(response.result)) as UploadEnvelope;
      if (!envelope.success || !envelope.data || !/^asset_[a-zA-Z0-9_-]+$/.test(envelope.data.assetId)) {
        throw new Error('CLOUD_INVALID_ASSET');
      }
      return { assetId: envelope.data.assetId, imageArtifact: envelope.data.artifactRef };
    } finally { unsubscribe?.(); request.destroy(); ShoppingImageUpload.active = false; }
  }
  private static check(clock: ClockPort, deadline: number, signal?: CancellationSignal): void {
    if (signal?.isCancellationRequested) { throw new Error('CLOUD_CANCELLED'); }
    if (!Number.isFinite(deadline) || clock.now() >= deadline) { throw new Error('DEADLINE_EXCEEDED'); }
  }
  private static ascii(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) { bytes[i] = text.charCodeAt(i); }
    return bytes;
  }
}
