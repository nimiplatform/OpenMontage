import type {
  WorkbenchRuntimeGateCopy,
  WorkbenchRuntimeGateProjection,
} from '../workbench-core/index.js';
import {
  appTitle,
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
} from './auth/runtime-platform.js';

export { appTitle };

export const targetRuntimeGateCopy: WorkbenchRuntimeGateCopy = Object.freeze({
  checking: '正在连接 Nimi…',
  setupRequired: '需要处理连接',
  signInRequired: '请先登录 Nimi',
  connectionRequired: '暂时无法连接 Nimi',
  retry: '重新检查连接',
  offlineTier: () => '连接恢复后可以继续制作。',
  nextAction: () => '请确认 Nimi 正在运行，然后重新检查连接。',
});

export async function resolveTargetRuntimeGate(): Promise<WorkbenchRuntimeGateProjection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status === 'ready') return { status: 'ready' };
  return {
    status: 'unavailable',
    body: projection.message || 'Runtime session projection is not ready.',
    signInRequired: projection.reasonCode === 'runtime-unauthenticated',
    nextAction: projection.actionHint,
    retryable: projection.retryable,
  };
}

export function clearTargetRuntimeGate(): void {
  clearRuntimePlatformProjection();
}

export function targetRuntimeGateErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'App-host check failed');
}
