import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, Film, Settings2, Square, WandSparkles } from 'lucide-react';
import { Button, InlineAlert, SelectField, StatusBadge, Surface, TextareaField, TextField } from '@nimiplatform/kit/ui';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk';
import type { MediaRenderResult, MediaSceneInput, PipelineCheckpoint, ProductionStage } from '../../src-electron/media-contract.js';
import { getNimiLocalAppClient } from '../shell/auth/local-app-client.js';
import { AIConfigPanel } from './ai-config-panel.js';
import { assertConfiguration, ConfigurationChangedError, generateSceneMedia, type GeneratedMedia, type SceneGeneration } from './generation.js';
import { parseStoryboard, storyboardMessages, type StoryScene } from './storyboard.js';
import { newProductionProject, ProductionProjectStore, type ProductionProject, type ProjectSummary } from './project-store.js';
import { assetManifest, renderReport, scenePlanArtifact } from './pipeline.js';
import './production.css';

type BusyStep = 'planning' | 'assets' | 'rendering' | null;
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function useMediaUrl(media: { bytes: Uint8Array; mimeType: string } | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!media) { setUrl(null); return; }
    const value = URL.createObjectURL(new Blob([new Uint8Array(media.bytes).buffer], { type: media.mimeType }));
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [media]);
  return url;
}

function ScenePreview({ media, index, disabled, onRegenerate }: { media: SceneGeneration; index: number; disabled: boolean; onRegenerate: (kind: 'image' | 'narration') => void }) {
  const image = useMediaUrl(media.image);
  const audio = useMediaUrl(media.narration);
  return <div className="om-scene-preview">
    {image ? <img src={image} alt={'场景 ' + (index + 1) + ' 的生成配图'} /> : <div className="om-image-empty"><Film size={24} aria-hidden="true" /><span>确认方案后生成配图</span></div>}
    {audio ? <audio controls preload="metadata" src={audio} aria-label={'场景 ' + (index + 1) + ' 的旁白'} /> : <p className="om-muted">旁白尚未生成</p>}
    <div className="om-media-actions"><Button size="sm" tone="secondary" disabled={disabled} onClick={() => onRegenerate('image')}>重新生成配图</Button><Button size="sm" tone="secondary" disabled={disabled} onClick={() => onRegenerate('narration')}>重新生成旁白</Button></div>
  </div>;
}

function mediaInput(image: GeneratedMedia, narration: GeneratedMedia): MediaSceneInput {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('当前合成器不支持这张图片的格式：' + image.mimeType);
  if (!['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac'].includes(narration.mimeType)) throw new Error('当前合成器不支持这段旁白的格式：' + narration.mimeType);
  return { image: image.bytes, imageMimeType: image.mimeType as MediaSceneInput['imageMimeType'], narration: narration.bytes, narrationMimeType: narration.mimeType as MediaSceneInput['narrationMimeType'] };
}

export function ProductionWorkspace() {
  const [project, setProject] = useState(newProductionProject);
  const projectRef = useRef(project);
  const store = useRef<ProductionProjectStore | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [library, setLibrary] = useState<ProjectSummary[]>([]);
  const [saveStatus, setSaveStatus] = useState('正在读取项目');
  const [saveError, setSaveError] = useState('');
  const [voices, setVoices] = useState<readonly { voiceId: string; name: string }[]>([]);
  const [voiceError, setVoiceError] = useState('');
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [displayedConfig, setDisplayedConfig] = useState<NimiAIConfigSnapshot | null>(null);
  const { material, duration, storyboard, assets } = project;
  const needsConfirmation = project.needsConfirmation || project.checkpoints.scene_plan?.metadata?.ai_config_revision !== displayedConfig?.revision;
  const [busy, setBusy] = useState<BusyStep>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [video, setVideo] = useState<MediaRenderResult>();
  const videoUrl = useMediaUrl(video);
  const stopRequested = useRef(false);
  const currentJob = useRef<string | null>(null);
  const currentRender = useRef<string | null>(null);
  const textCancel = useRef<(() => Promise<void>) | null>(null);
  const completeAssets = assets.length === 3 && assets.every((scene) => scene.image && scene.narration);
  const voiceReady = voicesLoaded && !voiceError && (voices.length === 0 || voices.some((voice) => voice.voiceId === project.voiceId));

  const updateProject = useCallback((change: Partial<ProductionProject>) => {
    const next = { ...projectRef.current, ...change };
    projectRef.current = next; setProject(next); return next;
  }, []);

  const saveProject = useCallback(async (value = projectRef.current) => {
    if (!store.current) throw new Error('项目存储尚未就绪。');
    setSaveStatus('正在保存'); setSaveError('');
    try {
      await store.current.save(value);
      setSaveStatus('已保存到 Nimi');
      setLibrary((current) => [{ id: value.id, title: value.storyboard?.title || '未命名短片', updatedAt: new Date().toISOString() }, ...current.filter((entry) => entry.id !== value.id)]);
    } catch (cause) { setSaveStatus('保存失败'); setSaveError(errorMessage(cause)); throw cause; }
  }, []);

  const refreshVoices = useCallback(async () => {
    setVoicesLoaded(false); setVoiceError(''); setDisplayedConfig(null);
    try {
      const client = getNimiLocalAppClient();
      const snapshot = await client.aiConfig.get();
      const result = await client.aiConfig.listOptions({ kind: 'preset-voices' });
      if (result.kind !== 'preset-voices') throw new Error('音色列表格式不正确。');
      setVoices(result.options); setVoicesLoaded(true); setDisplayedConfig(snapshot);
    } catch (cause) { setVoiceError(errorMessage(cause)); }
  }, []);

  useEffect(() => {
    let disposed = false;
    const repository = new ProductionProjectStore(getNimiLocalAppClient()); store.current = repository;
    void (async () => {
      const projects = await repository.list();
      const previous = projects[0] ? await repository.load(projects[0].id) : null;
      if (disposed) return;
      setLibrary(projects);
      if (previous) {
        updateProject(previous);
        if (previous.output) setVideo(await repository.readVideo(previous.output));
        const unfinished = Object.values(previous.checkpoints).find((entry) => entry.status === 'failed');
        if (unfinished?.error) setError('上次制作未完成：' + unfinished.error);
      }
      if (!disposed) { setLoaded(true); setSaveStatus(previous ? '已恢复上次项目' : '新项目'); }
    })().catch((cause) => { if (!disposed) { setError('无法打开项目：' + errorMessage(cause)); setSaveStatus('读取失败'); } });
    void refreshVoices();
    return () => { disposed = true; };
  }, [refreshVoices, updateProject]);

  useEffect(() => {
    if (!loaded || busy) return;
    const timer = setTimeout(() => { void saveProject().catch(() => undefined); }, 350);
    return () => clearTimeout(timer);
  }, [project, loaded, busy, saveProject]);

  const updateAssets = useCallback((index: number, change: Partial<SceneGeneration>) => {
    return updateProject({ assets: projectRef.current.assets.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...change } : scene) });
  }, [updateProject]);

  const checkpoint = async (stage: ProductionStage, status: PipelineCheckpoint['status'], artifacts: Record<string, unknown>, humanApproved = false, detail?: string) => {
    const current = projectRef.current;
    if (!window.openMontageMedia?.checkpoint) throw new Error('阶段检查接口尚未加载，请从 Nimi 重开 OpenMontage。');
    const metadata = stage === 'scene_plan' && status === 'completed' && displayedConfig ? { ai_config_revision: displayedConfig.revision } : status === 'failed' && stopRequested.current ? { scheduling_stopped_by_user: true } : undefined;
    const result = await window.openMontageMedia.checkpoint({ projectId: current.id, title: current.storyboard?.title || '未命名短片', stage, status, artifacts, humanApproved, checkpoints: current.checkpoints, ...(metadata ? { metadata } : {}), ...(detail ? { error: detail } : {}) });
    await saveProject(updateProject({ checkpoints: { ...current.checkpoints, [stage]: result } }));
  };
  const recordFailure = async (stage: ProductionStage, cause: unknown) => {
    const existing = projectRef.current.checkpoints[stage];
    if (existing?.status !== 'in_progress') return;
    try { await checkpoint(stage, 'failed', existing.artifacts, false, errorMessage(cause)); }
    catch (saveCause) { setSaveError('阶段状态未保存：' + errorMessage(saveCause)); }
  };

  useEffect(() => () => {
    stopRequested.current = true;
    void textCancel.current?.();
    if (currentJob.current) void getNimiLocalAppClient().ai.scenarioJobs.cancel(currentJob.current, 'OpenMontage window closed').catch(() => undefined);
    if (currentRender.current) void window.openMontageMedia?.cancel(currentRender.current).catch(() => undefined);
  }, []);

  const prepare = async () => {
    setError(null); setBusy('planning'); setProgress('正在根据材料准备三个场景'); stopRequested.current = false;
    try {
      const client = getNimiLocalAppClient();
      await saveProject(updateProject({ checkpoints: {}, needsConfirmation: true }));
      await checkpoint('scene_plan', 'in_progress', {});
      const snapshot = await client.aiConfig.get();
      await assertConfiguration(client, snapshot.revision, 'text.generate');
      if (stopRequested.current) throw new Error('已停止准备方案。');
      const stream = await client.ai.text.streamTurn({ messages: storyboardMessages(material, duration), maxTokens: 3000 });
      textCancel.current = () => stream.cancel();
      let output = ''; let completed = false; let traceId = '';
      try {
        if (stopRequested.current) { await stream.cancel(); throw new Error('已请求停止文字生成。'); }
        for await (const event of stream) {
          if (event.type === 'delta') output += event.text;
          else if (event.type === 'completed') { completed = event.finishReason === 'stop'; traceId = event.traceId; }
          else if (event.type === 'failed') throw new Error(event.reasonCode);
        }
      } finally { textCancel.current = null; await stream.cancel(); }
      if (stopRequested.current) throw new Error('方案准备已停止，当前草稿未被替换。');
      if (!completed) throw new Error('文字服务没有确认完成，当前草稿未被替换。');
      const plan = parseStoryboard(output);
      const next = updateProject({ storyboard: plan, assets: [{}, {}, {}], needsConfirmation: true, output: undefined, textTraceId: traceId });
      await checkpoint('scene_plan', 'awaiting_human', { scene_plan: scenePlanArtifact(next) }); setVideo(undefined);
    } catch (cause) { setError(errorMessage(cause)); await recordFailure('scene_plan', cause); }
    finally { setBusy(null); setProgress(''); }
  };

  const generateAssets = async () => {
    if (!storyboard) return;
    setError(null); setBusy('assets'); stopRequested.current = false;
    let operation = '素材准备';
    try {
      const plan = parseStoryboard(JSON.stringify(storyboard));
      const client = getNimiLocalAppClient();
      if (!displayedConfig) throw new Error('请先在 AI 设置中确认制作模型。');
      const revision = displayedConfig.revision;
      await assertConfiguration(client, revision);
      const options = await client.aiConfig.listOptions({ kind: 'preset-voices' });
      if (options.kind !== 'preset-voices' || (options.options.length > 0 && !options.options.some((voice) => voice.voiceId === projectRef.current.voiceId))) throw new Error('请先选择当前语音模型可用的旁白音色。');
      if (stopRequested.current) throw new Error('已停止继续生成。');
      await checkpoint('scene_plan', 'completed', { scene_plan: scenePlanArtifact(projectRef.current) }, true);
      await checkpoint('assets', 'in_progress', {});
      await saveProject(updateProject({ needsConfirmation: false }));
      for (const [index, scene] of plan.scenes.entries()) {
        for (const kind of ['image', 'narration'] as const) {
          if (stopRequested.current) throw new Error('已停止后续生成。已完成素材会保留。');
          operation = '场景 ' + (index + 1) + ' · ' + (kind === 'image' ? '生成配图' : '生成旁白');
          setProgress(operation);
          await generateSceneMedia({ client, scene, kind, existing: projectRef.current.assets[index], approvedRevision: revision,
            projectId: projectRef.current.id, voiceId: projectRef.current.voiceId,
            stopped: () => stopRequested.current,
            onChange: async (change) => { await saveProject(updateAssets(index, change)); },
            onJob: (jobId) => { currentJob.current = jobId; },
            onStatus: (status) => { if (status === 'canceled') setProgress('Nimi 已确认取消当前任务'); },
          });
        }
      }
      await checkpoint('assets', 'awaiting_human', { asset_manifest: assetManifest(projectRef.current) });
    } catch (cause) {
      if (cause instanceof ConfigurationChangedError) { updateProject({ needsConfirmation: true }); await refreshVoices(); }
      const detail = operation + '：' + errorMessage(cause);
      setError(detail); await recordFailure('assets', new Error(detail));
    } finally { setBusy(null); setProgress(''); currentJob.current = null; }
  };

  const render = async () => {
    setError(null); setBusy('rendering'); setProgress('正在本地混音与合成视频'); stopRequested.current = false;
    try {
      const media = window.openMontageMedia;
      if (!media) throw new Error('媒体接口尚未加载，请从 Nimi 重新启动 OpenMontage。');
      const availability = await media.inspect();
      if (!availability.available) throw new Error('本地媒体工具尚未就绪：' + availability.missing.join('、'));
      if (projectRef.current.checkpoints.scene_plan?.status !== 'completed') throw new Error('请先确认当前制作方案，再批准素材合成。');
      if (projectRef.current.checkpoints.assets?.status !== 'completed') await checkpoint('assets', 'completed', { asset_manifest: assetManifest(projectRef.current) }, true);
      await checkpoint('compose', 'in_progress', {});
      await saveProject();
      if (stopRequested.current) throw new Error('已停止合成，未启动媒体工作进程。');
      const scenes = projectRef.current.assets.map((scene) => {
        if (!scene.image || !scene.narration) throw new Error('请先生成并检查全部场景素材。');
        return mediaInput(scene.image, scene.narration);
      });
      const renderId = crypto.randomUUID(); currentRender.current = renderId;
      const result = await media.render({ renderId, scenes });
      if (!stopRequested.current) {
        setVideo(result);
        const output = await store.current!.saveVideo(projectRef.current, result);
        await saveProject(updateProject({ output }));
        await checkpoint('compose', 'completed', { render_report: renderReport(result, output!) });
      }
    } catch (cause) { setError(errorMessage(cause)); await recordFailure('compose', cause); }
    finally { currentRender.current = null; setBusy(null); setProgress(''); }
  };

  const stop = async () => {
    stopRequested.current = true; setProgress('正在请求停止；等待当前任务的实际结果');
    try {
      await textCancel.current?.();
      if (currentJob.current) await getNimiLocalAppClient().ai.scenarioJobs.cancel(currentJob.current, 'User requested stop in OpenMontage');
      if (currentRender.current) await window.openMontageMedia?.cancel(currentRender.current);
    } catch (cause) { setError('停止请求未确认：' + errorMessage(cause)); }
  };

  const editScene = (index: number, field: keyof StoryScene, value: string) => {
    const current = projectRef.current.storyboard;
    updateProject({ storyboard: current ? { ...current, scenes: current.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, [field]: value } : scene) } : null, output: undefined, needsConfirmation: true, checkpoints: {} });
    if (field === 'narration') updateAssets(index, { narration: undefined, narrationJobId: undefined, ...(projectRef.current.assets[index].pendingSubmission === 'narration' ? { pendingSubmission: undefined } : {}) });
    if (field === 'imagePrompt') updateAssets(index, { image: undefined, imageJobId: undefined, ...(projectRef.current.assets[index].pendingSubmission === 'image' ? { pendingSubmission: undefined } : {}) });
    setVideo(undefined);
  };
  const regenerate = async (index: number, kind: 'image' | 'narration') => {
    const scene = projectRef.current.assets[index];
    try {
      if (scene.pendingSubmission) throw new Error('上次提交结果仍不确定。请先在 Nimi 核对任务，当前不能盲目重新提交。');
      const key = kind === 'image' ? 'imageJobId' : 'narrationJobId';
      if (scene[key] && !scene[kind]) {
        const { job } = await getNimiLocalAppClient().ai.scenarioJobs.get(scene[key]!);
        if (!['completed', 'failed', 'canceled', 'timeout'].includes(job.status)) throw new Error('原任务仍在运行，请先继续该任务；运行时可请求停止。');
      }
      updateAssets(index, { [kind]: undefined, [key]: undefined });
      updateProject({ needsConfirmation: true, output: undefined, checkpoints: {} }); setVideo(undefined); setError(null);
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const configurationCommitted = useCallback(() => { updateProject({ needsConfirmation: true }); void refreshVoices(); }, [refreshVoices, updateProject]);
  const openProject = async (id: string) => {
    setError(null); setLoaded(false);
    try {
      await saveProject();
      const selected = id ? await store.current!.load(id) : newProductionProject();
      updateProject(selected); setVideo(selected.output ? await store.current!.readVideo(selected.output) : undefined);
      setLoaded(true); setSaveStatus(id ? '项目已打开' : '新项目');
    } catch (cause) { setError('无法打开项目：' + errorMessage(cause)); setLoaded(true); }
  };
  const chooseVoice = (voiceId: string) => {
    updateProject({ voiceId, needsConfirmation: true, output: undefined, checkpoints: {}, assets: projectRef.current.assets.map((scene) => ({ ...scene, narration: undefined, narrationJobId: undefined, ...(scene.pendingSubmission === 'narration' ? { pendingSubmission: undefined } : {}) })) });
    setVideo(undefined);
  };
  const modelSummary = [['text.generate', '文字'], ['image.generate', '配图'], ['audio.synthesize', '旁白']].map(([capability, label]) => {
    const selection = displayedConfig?.effectiveSelections.find((entry) => entry.capabilityContract === capability);
    const resource = selection?.resource;
    const model = resource?.oneofKind === 'cloud' ? resource.cloud.target.label + ' / ' + resource.cloud.connector.label : resource?.oneofKind === 'local' ? resource.local.label : '未配置';
    return label + '：' + model + (selection?.state === 'ready' ? '' : '（未就绪）');
  }).join(' · ');

  return <main className="om-workspace">
    <header className="om-header">
      <div><h1>OpenMontage</h1><p>从你的材料开始，制作有画面和旁白的短片。</p></div>
      <Button tone="secondary" onClick={() => setSettingsOpen(true)}><Settings2 size={17} aria-hidden="true" />AI 设置</Button>
    </header>
    <div className="om-body">
      <Surface className="om-brief" material="glass-thin" tone="panel">
        <div className="om-project-picker"><SelectField aria-label="打开项目" value={project.id} disabled={!loaded || busy !== null} options={library.map((entry) => ({ value: entry.id, label: entry.title }))} placeholder="当前项目" onValueChange={(id) => void openProject(id)} /><Button size="sm" tone="secondary" disabled={!loaded || busy !== null} onClick={() => void openProject('')}>新建</Button></div>
        <p className="om-muted" aria-live="polite">{saveStatus}</p>
        {saveError ? <InlineAlert tone="warning">项目未保存：{saveError}。请从 Nimi 重新打开本项目核对已保存内容。</InlineAlert> : null}
        <h2>准备一支解说短片</h2><p className="om-muted">提供真实材料，先确认方案，再生成素材。</p>
        <label htmlFor="production-material">事实材料与想表达的重点</label>
        <TextareaField id="production-material" value={material} onChange={(event) => updateProject({ material: event.target.value, needsConfirmation: true, checkpoints: {} })} rows={10} maxLength={12000} disabled={!loaded || busy !== null} placeholder="粘贴一段说明、文章摘要或你已经确认的事实，并写下希望观众记住什么。" />
        <fieldset className="om-duration" disabled={busy !== null}><legend>目标时长</legend><div>
          {[30, 45, 60].map((value) => <Button key={value} size="sm" tone={duration === value ? 'primary' : 'secondary'} aria-pressed={duration === value} onClick={() => updateProject({ duration: value, needsConfirmation: true, checkpoints: {} })}>{value} 秒</Button>)}
        </div></fieldset>
        <label htmlFor="narration-voice">旁白音色</label>
        <SelectField id="narration-voice" aria-label="旁白音色" value={project.voiceId} disabled={!loaded || busy !== null || !voicesLoaded || voices.length === 0} options={voices.map((voice) => ({ value: voice.voiceId, label: voice.name }))} placeholder={voicesLoaded && voices.length === 0 ? '当前模型没有预设音色' : '选择当前模型的音色'} onValueChange={chooseVoice} />
        {voiceError ? <p className="om-muted">音色暂不可用：{voiceError}。请在 AI 设置中检查语音配置。</p> : null}
        <p className="om-muted">实际成片时长由旁白决定。当前流程生成三个横向场景，以 Remotion 合成为 720p 视频。</p>
        <Button tone="primary" disabled={!loaded || !material.trim() || busy !== null} onClick={() => void prepare()}><WandSparkles size={17} aria-hidden="true" />{storyboard ? '重新准备方案' : '准备制作方案'}</Button>
      </Surface>
      <section className="om-production" aria-label="制作方案与结果">
        {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
        {storyboard ? <ol className="om-stages" aria-label="制作阶段">{([['scene_plan', '方案'], ['assets', '素材'], ['compose', '合成']] as const).map(([stage, label]) => {
          const saved = project.checkpoints[stage];
          const active = { scene_plan: 'planning', assets: 'assets', compose: 'rendering' }[stage] === busy;
          const state = saved?.status === 'completed' ? (stage === 'compose' ? '完成' : '已确认') : saved?.status === 'awaiting_human' ? '待确认' : saved?.status === 'failed' ? (saved.metadata?.scheduling_stopped_by_user ? '已暂停' : '失败') : saved?.status === 'in_progress' ? (active ? '进行中' : '待继续') : '未开始';
          return <li key={stage}><span>{label}</span><StatusBadge tone={saved?.status === 'completed' ? 'success' : 'neutral'}>{state}</StatusBadge></li>;
        })}</ol> : null}
        {busy ? <div className="om-progress" aria-live="polite"><StatusBadge tone="neutral">{progress}</StatusBadge><Button size="sm" tone="secondary" onClick={() => void stop()}><Square size={13} aria-hidden="true" />停止后续操作</Button></div> : null}
        {!storyboard ? <div className="om-empty"><Film size={42} strokeWidth={1.3} aria-hidden="true" /><h2>把故事讲清楚，再开始制作</h2><p>场景、旁白和配图描述会出现在这里。你可以先修改方案，然后确认生成。</p></div> : <>
          <div className="om-plan-heading"><h2>{storyboard.title}</h2><StatusBadge tone={completeAssets ? 'success' : 'neutral'}>{completeAssets ? '素材已齐备' : '三个场景'}</StatusBadge></div>
          <div className="om-scenes">{storyboard.scenes.map((scene, index) => <Surface key={index} className="om-scene" material="glass-thin" tone="panel">
            <div className="om-scene-copy">
              <label htmlFor={'scene-title-' + index}>场景 {index + 1}</label><TextField id={'scene-title-' + index} value={scene.title} disabled={busy !== null} maxLength={100} onChange={(event) => editScene(index, 'title', event.target.value)} />
              <label htmlFor={'scene-narration-' + index}>旁白</label><TextareaField id={'scene-narration-' + index} value={scene.narration} rows={3} disabled={busy !== null} maxLength={1200} onChange={(event) => editScene(index, 'narration', event.target.value)} />
              <label htmlFor={'scene-image-' + index}>配图描述</label><TextareaField id={'scene-image-' + index} value={scene.imagePrompt} rows={3} disabled={busy !== null} maxLength={3000} onChange={(event) => editScene(index, 'imagePrompt', event.target.value)} />
            </div><ScenePreview media={assets[index]} index={index} disabled={!loaded || busy !== null} onRegenerate={(kind) => void regenerate(index, kind)} />
          </Surface>)}</div>
          <div className="om-approval"><p>{displayedConfig ? modelSummary : '正在读取制作模型'}</p><p>确认后会生成缺少的配图和旁白；失败任务的重试会重新生成。费用按你在 Nimi 中配置的服务计量，当前没有可用报价。</p>{!voiceReady ? <p>先选择可用的旁白音色，再确认生成。</p> : null}<Button tone="primary" disabled={!loaded || !displayedConfig || !voiceReady || busy !== null || (completeAssets && !needsConfirmation && ['awaiting_human', 'completed'].includes(project.checkpoints.assets?.status || ''))} onClick={() => void generateAssets()}>{completeAssets ? '确认当前方案' : needsConfirmation ? '确认方案并生成素材' : '继续或重试素材'}<ArrowRight size={17} aria-hidden="true" /></Button></div>
          {completeAssets ? <Surface className="om-render" material="glass-thin" tone="panel"><div><h2>检查素材，合成短片</h2><p className="om-muted">{project.checkpoints.scene_plan?.status === 'completed' ? '试听旁白、检查画面后，使用本地媒体工具合成。此操作不再次生成 AI 素材。' : '先确认当前方案，再检查素材并合成。'}</p></div><Button tone="primary" disabled={busy !== null || project.checkpoints.scene_plan?.status !== 'completed'} onClick={() => void render()}><Film size={17} aria-hidden="true" />{project.checkpoints.compose?.status === 'failed' ? '重试合成' : project.checkpoints.assets?.status === 'completed' ? '重新合成' : '确认素材并合成'}</Button></Surface> : null}
          {video && videoUrl ? <section className="om-result"><h2>成片预览</h2><video controls src={videoUrl} preload="metadata" aria-label="生成的解说短片" /><div><span>{video.width} × {video.height} · {video.durationSeconds.toFixed(1)} 秒</span><Button tone="primary" onClick={() => { const anchor = document.createElement('a'); anchor.href = videoUrl; anchor.download = storyboard.title.replace(/[<>:"/\\|?*]/g, '-') + '.mp4'; anchor.click(); }}><Download size={17} aria-hidden="true" />导出视频</Button></div></section> : null}
        </>}
      </section>
    </div>
    <AIConfigPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onCommitted={configurationCommitted} />
  </main>;
}
