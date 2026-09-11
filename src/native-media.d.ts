import type { OpenMontageMedia } from '../src-electron/media-contract.js';

declare global {
  interface Window {
    readonly openMontageMedia?: OpenMontageMedia;
  }
}

export {};
