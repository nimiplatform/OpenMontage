import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import { createNimiClientId } from '@nimiplatform/sdk/types';
import { ModelConfigAIConfigSurface } from '@nimiplatform/kit/features/model-config';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { StatusBadge } from '@nimiplatform/kit/ui';
import {
  AIStudioHostProvider,
  AIStudioWorkspace,
  DEFAULT_AI_STUDIO_HISTORY_PANEL_PREFERENCES,
  boundStudioRunHistoryWithRecord,
  cleanupStudioHistoryArtifacts,
  clearStudioHistoryWithPolicy,
  createStudioNonSuccess,
  createStudioRunTargetSummary,
  createEmptyStudioPromptDraftStore,
  loadStudioAIConfig,
  parseAIStudioHistoryPanelPreferences,
  parseStudioRunHistory,
  parseStudioPromptDraftStore,
  projectStudioManagedHistory,
  readStudioPromptDraft,
  requireStudioAIConfigOwner,
  removeStudioHistoryWithPolicy,
  runStudioCapability,
  subscribeStudioAIConfigRefresh,
  studioHistoryArtifactPaths,
  updateStudioPromptDraftStore,
  useAIStudioWorkspaceController,
  type AIStudioHistoryMutationOutcome,
  type AIStudioHistoryPanelPreferences,
  type AIStudioHistoryProjection,
  type AIStudioHistoryRepository,
  type AIStudioHostPort,
  type AIStudioWorkspaceController,
  type StudioPromptDraftStore,
  type StudioRunHistory,
  type StudioRunHistoryRecord,
  type StudioRuntimeInspection,
} from '../../capabilities/ai-studio-core/index.js';
import { appId, appTitle } from '../../shell/auth/app-identity.js';
import { getNimiLocalAppClient } from '../../shell/auth/local-app-client.js';
import { getRuntimePlatformProjection } from '../../shell/auth/runtime-platform.js';
import {
  generatedAIStudioComposition,
  generatedAIStudioRegistrations,
} from './capability-registry.js';
import { generatedStudioRuntimeHandlers } from './runtime-registry.js';
import { generatedLocale, translateGeneratedMessage } from './i18n.js';

const HISTORY_PATH = 'ai-studio/run-history.v1.json';
const PROMPT_DRAFT_STORAGE_KEY = 'nimi.ai-studio.prompt-drafts.v1';
const translate: AIStudioHostPort['translate'] = translateGeneratedMessage;

async function inspectTargetRuntime(): Promise<StudioRuntimeInspection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status === 'ready') {
    return { status: 'connected', mode: projection.mode, detail: 'The protected local-app Runtime session is connected.' };
  }
  return { status: 'unavailable', mode: projection.mode, detail: projection.message };
}

function reasonCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as { readonly reasonCode?: unknown; readonly code?: unknown }).reasonCode
    ?? (error as { readonly code?: unknown }).code;
  return typeof value === 'string' ? value.trim().toUpperCase().replaceAll('-', '_') : '';
}

function isStorageEntryNotFound(error: unknown): boolean {
  const normalized = reasonCode(error);
  return normalized === 'APP_STORAGE_ENTRY_NOT_FOUND'
    || normalized === 'NOT_FOUND'
    || normalized === 'ENTRY_NOT_FOUND'
    || normalized.endsWith('_STORAGE_JSON_NOT_FOUND')
    || normalized.endsWith('_STORAGE_ENTRY_NOT_FOUND')
    || normalized.endsWith('_LOCAL_ASSET_NOT_FOUND');
}

async function loadRunHistory(): Promise<StudioRunHistory> {
  try {
    const document = await getNimiLocalAppClient().storage.readJson(HISTORY_PATH);
    return parseStudioRunHistory(document.value);
  } catch (error) {
    if (isStorageEntryNotFound(error)) return {};
    throw error;
  }
}

async function writeRunHistory(history: StudioRunHistory): Promise<StudioRunHistory> {
  const normalized = parseStudioRunHistory(JSON.parse(JSON.stringify(history)) as unknown);
  await getNimiLocalAppClient().storage.writeJson(HISTORY_PATH, normalized as never);
  return normalized;
}

let historyMutationTail: Promise<unknown> = Promise.resolve();
function mutateHistory<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
  const next = historyMutationTail.then(operation, operation);
  historyMutationTail = next.then(() => undefined, () => undefined);
  return next;
}

const cleanupArtifacts: AIStudioHistoryRepository['cleanupArtifacts'] = (relativePaths) => cleanupStudioHistoryArtifacts({
  relativePaths,
  removeArtifact: (relativePath) => getNimiLocalAppClient().storage.assets.remove(relativePath),
  isNotFound: isStorageEntryNotFound,
});

async function verifyHistoryProjection(runHistory: StudioRunHistory): Promise<AIStudioHistoryProjection> {
  return projectStudioManagedHistory({
    runHistory,
    resolveCapabilityLabel: (capabilityId) => generatedAIStudioRegistrations.find((entry) => (
      entry.descriptor.id === capabilityId
    ))?.descriptor.label ?? capabilityId,
    statArtifact: (artifact) => getNimiLocalAppClient().storage.assets.stat(artifact.relativePath),
  });
}

async function loadVerifiedHistory(): Promise<AIStudioHistoryProjection> {
  return verifyHistoryProjection(await loadRunHistory());
}

async function appendRecord(record: StudioRunHistoryRecord): Promise<AIStudioHistoryProjection> {
  return mutateHistory(async () => {
    const current = await loadRunHistory();
    const next = boundStudioRunHistoryWithRecord(current, record);
    return verifyHistoryProjection(await writeRunHistory(next));
  });
}

async function persistHistory({ result, record }: { readonly result: Parameters<AIStudioHistoryRepository['persist']>[0]['result']; readonly record: StudioRunHistoryRecord }) {
  try {
    return { ok: true as const, projection: await appendRecord(record) };
  } catch (error) {
    const paths = studioHistoryArtifactPaths(record);
    const cleanup = await cleanupArtifacts(paths);
    const message = error instanceof Error ? error.message : String(error || 'History persistence failed.');
    return {
      ok: false as const,
      message,
      retryRecord: paths.length === 0,
      remainingCleanupPaths: cleanup.remainingCleanupPaths,
      ...(paths.length > 0 ? {
        displayFailure: { reason: 'runtime-call-failed' as const, message: `Runtime completed, but managed artifact history persistence failed: ${message}` },
      } : {}),
    };
  }
}

async function removeHistoryRecord(recordId: string, deleteAssets: boolean): Promise<AIStudioHistoryMutationOutcome> {
  return mutateHistory(async () => {
    const current = await loadRunHistory();
    return removeStudioHistoryWithPolicy({
      history: current,
      recordId,
      deleteAssets,
      removeArtifact: (relativePath) => getNimiLocalAppClient().storage.assets.remove(relativePath),
      isNotFound: isStorageEntryNotFound,
      commit: async (next) => { await writeRunHistory(next); },
      project: verifyHistoryProjection,
    });
  });
}

async function clearHistory(capabilityId: string | null, deleteAssets: boolean): Promise<AIStudioHistoryMutationOutcome> {
  return mutateHistory(async () => {
    const current = await loadRunHistory();
    return clearStudioHistoryWithPolicy({
      history: current,
      capabilityId,
      deleteAssets,
      removeArtifact: (relativePath) => getNimiLocalAppClient().storage.assets.remove(relativePath),
      isNotFound: isStorageEntryNotFound,
      commit: async (next) => { await writeRunHistory(next); },
      project: verifyHistoryProjection,
    });
  });
}

const HISTORY_PANEL_STORAGE_KEY = 'nimi.ai-studio.history-panel.v1';
function loadPanelPreferences(): AIStudioHistoryPanelPreferences {
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_PANEL_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_STUDIO_HISTORY_PANEL_PREFERENCES;
    return parseAIStudioHistoryPanelPreferences(JSON.parse(raw));
  } catch { return DEFAULT_AI_STUDIO_HISTORY_PANEL_PREFERENCES; }
}
function savePanelPreferences(preferences: AIStudioHistoryPanelPreferences): void {
  try { globalThis.localStorage?.setItem(HISTORY_PANEL_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* UI state remains session-local. */ }
}

const historyRepository: AIStudioHistoryRepository = Object.freeze({
  load: loadVerifiedHistory,
  persist: persistHistory,
  appendRecord,
  cleanupArtifacts,
  remove: removeHistoryRecord,
  clear: clearHistory,
  nextIdentity: async () => ({ runId: createNimiClientId('run'), createdAt: new Date().toISOString() }),
  loadPanelPreferences,
  savePanelPreferences,
});

let promptDraftStore = readPromptDraftStore();

function readPromptDraftStore(): StudioPromptDraftStore {
  try {
    const raw = globalThis.localStorage?.getItem(PROMPT_DRAFT_STORAGE_KEY);
    if (!raw) return createEmptyStudioPromptDraftStore();
    return parseStudioPromptDraftStore(JSON.parse(raw));
  } catch {
    return createEmptyStudioPromptDraftStore();
  }
}

async function savePromptDraft(key: Parameters<AIStudioHostPort['app']['commands']['savePromptDraft']>[0], prompt: string, enabled: boolean) {
  const next = updateStudioPromptDraftStore(promptDraftStore, key, prompt, enabled);
  if (next === promptDraftStore) return promptDraftStore;
  promptDraftStore = next;
  try { globalThis.localStorage?.setItem(PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(promptDraftStore)); } catch { /* UI state remains session-local. */ }
  return promptDraftStore;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

const RUN_STATUS_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
    ready: 'StudioShell.runStatusReady',
    unavailable: 'StudioShell.runStatusUnavailable',
    failed: 'StudioShell.runStatusFailed',
    canceled: 'StudioShell.runStatusCanceled',
    'timed-out': 'StudioShell.runStatusTimedOut',
});
function runStatusLabel(status: string): string {
  const key = RUN_STATUS_LABEL_KEYS[status];
  return key ? translate(key) : status;
}

const hostValue: AIStudioHostPort = {
  appTitle,
  translate,
  locale: generatedLocale,
  clock: { now: () => Date.now() },
  app: {
    projection: {
      promptDraft: (key, enabled) => ({ prompt: readStudioPromptDraft(promptDraftStore, key, enabled) }),
      projectRunTarget: createStudioRunTargetSummary,
      runStatusLabel,
    },
    events: {
      subscribeAIConfigRefresh: (listener) => subscribeStudioAIConfigRefresh(listener, window, document),
    },
    commands: {
      savePromptDraft,
      async copyText(text) {
        try {
          await navigator.clipboard.writeText(text);
          return { ok: true, value: { copied: true } };
        } catch (error) {
          return { ok: false, error };
        }
      },
      exportText: async ({ filename, body }) => downloadBlob(filename, new Blob([body], { type: 'text/plain;charset=utf-8' })),
    },
  },
  sdk: {
    runCapability: (input) => runStudioCapability(input, {
      appId,
      surfaceId: 'ai-capabilities',
      abortReason: 'studio-user-canceled',
      translate,
      handlers: generatedStudioRuntimeHandlers,
      resolveCapability: (capabilityId) => generatedAIStudioComposition.getCapability(capabilityId).descriptor,
      inspectRuntime: inspectTargetRuntime,
      getClient: getNimiLocalAppClient,
      createScenarioId: (capability) => `studio:${capability.id}`,
      nonSuccess: (capability, reason, message, diagnostics) => (
        createStudioNonSuccess(capability, reason, message, translate, diagnostics)
      ),
    }),
    async listLocalAppVoiceAssets() {
      const result = await getNimiLocalAppClient().ai.voiceAssets.list({ pageSize: 100, pageToken: '' });
      return result.assets.map((asset) => ({
        voiceAssetId: asset.voiceAssetId,
        creationSource: asset.creationSource,
        status: asset.status,
      }));
    },
    uploadLocalAppArtifact: (input) => getNimiLocalAppClient().ai.artifacts.upload(input),
    aiConfig: {
      get: () => loadStudioAIConfig({
        get: async () => (await getNimiLocalAppClient().aiConfig.get()).config,
      }, appId),
    },
    revealLocalAppAsset: (relativePath) => getNimiLocalAppClient().storage.assets.reveal(relativePath),
  },
};

const generatedCapabilityContracts = Object.freeze([
  ...new Set(generatedAIStudioRegistrations.flatMap((registration) => (
    registration.descriptor.capabilityContract ? [registration.descriptor.capabilityContract] : []
  ))),
]);

function GeneratedAIConfigPanel({
  runtime,
  capabilityId,
}: {
  readonly runtime: StudioRuntimeInspection | null;
  readonly capabilityId: string;
}) {
  const [snapshot, setSnapshot] = useState<NimiAIConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getNimiLocalAppClient().aiConfig.get();
      if (next.config) requireStudioAIConfigOwner(next.config, appId);
      setSnapshot(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error || 'AIConfig load failed.'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    return subscribeStudioAIConfigRefresh(() => { void refresh(); }, window, document);
  }, []);
  const runtimeLabel = runtime?.status === 'connected'
    ? translate('StudioShell.statusConfigured')
    : translate('StudioShell.statusNotAdmitted');
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={translate('StudioModelConfig.drawerDescription', { appTitle })}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', appId }}
          capabilityContracts={generatedCapabilityContracts}
          initialCapabilityContract={capabilityId}
          capabilities={snapshot?.config ? snapshot.config.capabilities as never : snapshot ? null : undefined}
          revision={snapshot?.revision}
          effectiveSelections={snapshot?.effectiveSelections}
          listOptions={(query) => getNimiLocalAppClient().aiConfig.listOptions(query)}
          loading={loading && !snapshot}
          loadError={loadError}
          onRetry={() => { void refresh(); }}
          onOverwrite={async (input) => {
            const result = await getNimiLocalAppClient().aiConfig.overwrite(input);
            setSnapshot({ config: result.config, revision: result.revision, effectiveSelections: [] });
            if (result.outcome === 'committed') void refresh();
            return result;
          }}
          onOpenOwnerConfiguration={() => {
            void openDesktopIntent({
              requestId: createNimiClientId('desktop-open'),
              intent: { kind: 'open-apps', appId, section: 'ai-models' },
            });
          }}
          copy={{
            title: translate('StudioModelConfig.drawerTitle'),
            description: translate('StudioModelConfig.drawerDescription', { appTitle }),
            capabilityLabel: (contract, fallback) => (
              generatedAIStudioRegistrations.find((entry) => entry.descriptor.capabilityContract === contract)
                ? translate(generatedAIStudioRegistrations.find((entry) => entry.descriptor.capabilityContract === contract)!.descriptor.labelKey)
                : fallback
            ),
          }}
          headerSlot={<StatusBadge tone={runtime?.status === 'connected' ? 'neutral' : 'warning'} shape="dot">{runtimeLabel}</StatusBadge>}
        />
      </div>
    </section>
  );
}

type GeneratedAIStudioState = {
  readonly runtime: StudioRuntimeInspection | null;
  readonly controller: AIStudioWorkspaceController;
};
const GeneratedAIStudioStateContext = createContext<GeneratedAIStudioState | null>(null);

export function GeneratedAIStudioHost({
  onSelectCapability,
  children,
}: {
  readonly onSelectCapability: (capabilityId: string) => void;
  readonly children: ReactNode;
}) {
  const [runtime, setRuntime] = useState<StudioRuntimeInspection | null>(null);
  useEffect(() => {
    let active = true;
    void inspectTargetRuntime().then((next) => { if (active) setRuntime(next); });
    return () => { active = false; };
  }, []);
  const controller = useAIStudioWorkspaceController({
    historyRepository,
    registrations: generatedAIStudioRegistrations,
    onSelectCapability,
    translate,
  });
  const state = useMemo(() => ({ runtime, controller }), [controller, runtime]);
  return (
    <AIStudioHostProvider value={hostValue}>
      <GeneratedAIStudioStateContext.Provider value={state}>
        {children}
      </GeneratedAIStudioStateContext.Provider>
    </AIStudioHostProvider>
  );
}

function useGeneratedAIStudioState(): GeneratedAIStudioState {
  const state = useContext(GeneratedAIStudioStateContext);
  if (!state) throw new Error('GENERATED_AI_STUDIO_HOST_UNAVAILABLE');
  return state;
}

export function GeneratedAIStudioRoute({
  capabilityId,
}: {
  readonly capabilityId: string;
}) {
  const { runtime, controller } = useGeneratedAIStudioState();
  const registration = useMemo(() => (
    generatedAIStudioRegistrations.find((entry) => entry.descriptor.id === capabilityId)
      ?? generatedAIStudioRegistrations[0]
  ), [capabilityId]);
  if (!registration) return null;
  return (
    <AIStudioWorkspace
        registration={registration}
        registrations={generatedAIStudioRegistrations}
        runtime={runtime}
        controller={controller}
        renderAIConfigPanel={(input) => <GeneratedAIConfigPanel {...input} />}
        rootTestId="nimi-app-ai-studio"
      />
  );
}
