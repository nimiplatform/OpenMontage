import { WorkbenchRuntimeGate } from '../workbench-core/index.js';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { AuthenticatedShell } from './authenticated-shell.js';
import { MontagePlatformProvider, downloadFile } from '../production/platform.js';
import { getNimiLocalAppClient } from './auth/local-app-client.js';
import {
  appTitle,
  clearTargetRuntimeGate,
  resolveTargetRuntimeGate,
  targetRuntimeGateCopy,
  targetRuntimeGateErrorMessage,
} from './workbench-target-adapter.js';

const nativePlatform = {kind:'desktop' as const,connected:true,client:getNimiLocalAppClient(),media:window.openMontageMedia!,deliverFile:downloadFile};

export function App() {
  return (
    <>
      <WorkbenchRuntimeGate
        appTitle={appTitle}
        copy={targetRuntimeGateCopy}
        resolve={resolveTargetRuntimeGate}
        clear={clearTargetRuntimeGate}
        toErrorMessage={targetRuntimeGateErrorMessage}
      >
        <MontagePlatformProvider platform={nativePlatform}><AuthenticatedShell /></MontagePlatformProvider>
      </WorkbenchRuntimeGate>
      <NimiToaster />
    </>
  );
}
