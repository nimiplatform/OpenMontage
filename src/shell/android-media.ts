import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function deliverAndroidMedia(blob: Blob, name: string, signal: AbortSignal) {
  if (!name || name === '.' || name === '..' || /[/\\\0]/u.test(name)) throw new Error('文件名无效。');
  const folder = `openmontage-exports/${crypto.randomUUID()}`;
  const path = `${folder}/${name}`;
  const file = await Filesystem.writeFile({ directory: Directory.Cache, path, data: '', recursive: true });
  const remove = async () => { await Filesystem.deleteFile({ directory: Directory.Cache, path }); await Filesystem.rmdir({ directory: Directory.Cache, path: folder }); };
  try {
    for (let offset = 0; offset < blob.size; offset += 65536) {
      signal.throwIfAborted();
      const bytes = new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer());
      let data = ''; for (let i = 0; i < bytes.length; i += 8192) data += String.fromCharCode(...bytes.subarray(i, i + 8192));
      await Filesystem.appendFile({ directory: Directory.Cache, path, data: btoa(data) });
    }
    signal.throwIfAborted();
    await Share.share({ files: [file.uri], title: name });
  } catch (cause) {
    await remove().catch(() => undefined);
    if (cause instanceof Error && cause.message === 'Share canceled') return;
    throw cause;
  }
}
