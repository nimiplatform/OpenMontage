import { contextBridge, ipcRenderer } from 'electron';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload-cjs';
import type { CheckpointInput, OpenMontageMedia, MediaRenderInput } from './media-contract.js';

installNimiElectronRuntimeBridge({ contextBridge, ipcRenderer });

const media: OpenMontageMedia = {
  inspect: () => ipcRenderer.invoke('openmontage:media:inspect'),
  render: (input: MediaRenderInput) => ipcRenderer.invoke('openmontage:media:render', input),
  cancel: (renderId: string) => ipcRenderer.invoke('openmontage:media:cancel', renderId),
  checkpoint: (input: CheckpointInput) => ipcRenderer.invoke('openmontage:project:checkpoint', input),
  pipelineContext: (input) => ipcRenderer.invoke('openmontage:project:pipeline-context', input),
  prepareAudio: (input) => ipcRenderer.invoke('openmontage:media:prepare-audio', input),
  exportSubtitles: (input) => ipcRenderer.invoke('openmontage:media:export-subtitles', input),
};
contextBridge.exposeInMainWorld('openMontageMedia', media);
