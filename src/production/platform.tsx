import { createContext, useContext, type ReactNode } from 'react';
import type { NimiAppRuntimeClient } from '@nimiplatform/sdk/app';
import type { OpenMontageMedia } from '../../src-electron/media-contract.js';

export type MontagePlatform = Readonly<{
  kind: 'desktop' | 'web' | 'android';
  connected: boolean;
  client: NimiAppRuntimeClient;
  media: OpenMontageMedia;
  deliverFile(blob: Blob, name: string): Promise<void>;
}>;
const Context=createContext<MontagePlatform|null>(null);
export function MontagePlatformProvider({platform,children}:{platform:MontagePlatform;children:ReactNode}) {
  return <Context.Provider value={platform}>{children}</Context.Provider>;
}
export function useMontagePlatform() {
  const platform=useContext(Context);
  if(!platform)throw new Error('OpenMontage requires a connected application scope.');
  return platform;
}
export async function downloadFile(blob:Blob,name:string) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
