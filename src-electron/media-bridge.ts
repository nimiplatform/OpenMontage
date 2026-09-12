import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { isAllowedElectronRendererUrl } from '@nimiplatform/kit/shell/electron/main';
import { MediaRenderer, type MediaRuntimePaths } from './media-runtime.js';
import type { AudioPreparationInput, CheckpointInput, MediaRenderInput, SubtitleCue } from './media-contract.js';

export function registerOpenMontageMediaBridge(input: {
  ipcMain: IpcMain;
  allowedRendererUrls: readonly string[];
  paths: MediaRuntimePaths;
}): MediaRenderer {
  const renderer = new MediaRenderer(input.paths);
  const checkSender = (event: IpcMainInvokeEvent) => {
    if (!event.senderFrame || !isAllowedElectronRendererUrl(event.senderFrame.url, input.allowedRendererUrls)) {
      throw new Error('The media operation must originate from the OpenMontage window.');
    }
  };
  input.ipcMain.handle('openmontage:media:inspect', (event) => { checkSender(event); return renderer.inspect(); });
  input.ipcMain.handle('openmontage:media:render', (event, request: MediaRenderInput) => { checkSender(event); return renderer.render(request); });
  input.ipcMain.handle('openmontage:project:checkpoint', (event, request: CheckpointInput) => { checkSender(event); return renderer.checkpoint(request); });
  input.ipcMain.handle('openmontage:project:pipeline-context', (event, request: { pipelineId?: string; stage?: string }) => { checkSender(event); return renderer.pipelineContext(request); });
  input.ipcMain.handle('openmontage:media:cancel', (event, renderId: string) => {
    checkSender(event);
    if (typeof renderId !== 'string') throw new Error('A media render identifier is required.');
    return renderer.cancel(renderId);
  });
  input.ipcMain.handle('openmontage:media:prepare-audio', (event, request: AudioPreparationInput) => { checkSender(event); return renderer.prepareAudio(request); });
  input.ipcMain.handle('openmontage:media:export-subtitles', (event, request: { cues: readonly SubtitleCue[] }) => { checkSender(event); return renderer.exportSubtitles(request); });
  return renderer;
}
