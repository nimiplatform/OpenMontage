import { registerPlugin } from '@capacitor/core';

type ExportSink = {
  beginExport(input: { name: string; mimeType: string; size: number }): Promise<{ id: string }>;
  appendExport(input: { id: string; offset: number; data: string }): Promise<{ received: number }>;
  saveExport(input: { id: string }): Promise<{ name: string; bytesWritten: number }>;
  abortExport(input: { id: string }): Promise<void>;
};
const files = registerPlugin<ExportSink>('OpenMontageFiles');

export async function deliverAndroidMedia(blob: Blob, name: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { id } = await files.beginExport({ name, mimeType: blob.type || 'application/octet-stream', size: blob.size });
  try {
    for (let offset = 0; offset < blob.size; offset += 65536) {
      signal.throwIfAborted();
      const bytes = new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer());
      let value = '';
      for (let index = 0; index < bytes.length; index += 8192) value += String.fromCharCode(...bytes.subarray(index, index + 8192));
      await files.appendExport({ id, offset, data: btoa(value) });
    }
    signal.throwIfAborted();
    // All remote bytes are staged before opening the OS picker. Its local save
    // may complete after backgrounding ends this Runtime scope; it issues no RPC.
    return await files.saveExport({ id });
  } catch (cause) {
    await files.abortExport({ id }).catch(() => undefined);
    throw cause;
  }
}
