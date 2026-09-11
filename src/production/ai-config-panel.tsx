import { useCallback, useEffect, useState } from 'react';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import { ModelConfigAIConfigSurface, type ModelConfigOverwrite } from '@nimiplatform/kit/features/model-config';
import { OverlayShell } from '@nimiplatform/kit/ui';
import { getNimiLocalAppClient } from '../shell/auth/local-app-client.js';
import { appId } from '../shell/auth/app-identity.js';

export function AIConfigPanel({ open, onClose, onCommitted }: { open: boolean; onClose: () => void; onCommitted: () => void }) {
  const [snapshot, setSnapshot] = useState<NimiAIConfigSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSnapshot(await getNimiLocalAppClient().aiConfig.get()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  const overwrite = useCallback<ModelConfigOverwrite>(async (input) => {
    const result = await getNimiLocalAppClient().aiConfig.overwrite(input);
    await refresh();
    if (result.outcome === 'committed') onCommitted();
    return result;
  }, [refresh, onCommitted]);
  return <OverlayShell open={open} onClose={onClose} kind="dialog" size="lg" title="AI 设置">
    <ModelConfigAIConfigSurface context={{ owner: 'app-ai-config', appId }}
      capabilityContracts={['text.generate', 'image.generate', 'audio.synthesize']}
      capabilities={snapshot ? snapshot.config?.capabilities ?? null : undefined}
      revision={snapshot?.revision} effectiveSelections={snapshot?.effectiveSelections}
      listOptions={(query) => getNimiLocalAppClient().aiConfig.listOptions(query)}
      loading={loading} loadError={error} onRetry={() => void refresh()} onOverwrite={overwrite}
      language="zh-CN" copy={{ title: '制作所用的 AI', emptySummary: '选择文字、图像与配音能力后保存。', configuredSummary: '此配置由 Nimi 管理，生成时使用已保存的选择。' }} />
  </OverlayShell>;
}
