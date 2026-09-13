import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk';
import type { MediaRenderResult, MediaSceneInput, PipelineCheckpoint, PipelineDefinition, ProductionStage } from '../../src-electron/media-contract.js';
import { getNimiLocalAppClient } from '../shell/auth/local-app-client.js';
import { assertConfiguration, ConfigurationChangedError, generateSceneMedia, measureMediaDuration, type GeneratedMedia, type SceneGeneration, type SourceMedia, type SourceTranscription } from './generation.js';
import { transcribeSource } from './transcription.js';
import { narrationCues, validateCues, type SubtitleTrack } from './subtitles.js';
import { parseStoryboard, storyboardMessages, type StoryScene } from './storyboard.js';
import { newProductionProject, ProductionProjectStore, recordProductionDecision, summarizeProject, projectTitle, type ProductionProject, type ProjectSummary } from './project-store.js';
import { assetManifest, renderReport, scenePlanArtifact } from './pipeline.js';
import { nextPipelineStage, parseStageArtifacts, stageMessages, stageNames, storyboardFromArtifacts } from './pipeline-workflow.js';
import { retainSceneAssets } from './scene-revision.js';

type BusyStep = 'planning' | 'assets' | 'rendering' | null;
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function useMediaUrl(media: { bytes: Uint8Array; mimeType: string } | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!media) { setUrl(null); return; }
    const value = URL.createObjectURL(new Blob([new Uint8Array(media.bytes).buffer], { type: media.mimeType }));
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [media]);
  return url;
}

function mediaInput(image: { bytes: Uint8Array; mimeType: string }, narration?: GeneratedMedia, durationSeconds?: number): MediaSceneInput {
  if (!['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(image.mimeType)) throw new Error('当前合成器不支持这张图片的格式：' + image.mimeType);
  if (narration && !['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac'].includes(narration.mimeType)) throw new Error('当前合成器不支持这段旁白的格式：' + narration.mimeType);
  return { visual: image.bytes, visualMimeType: image.mimeType as MediaSceneInput['visualMimeType'], ...(narration ? { narration: narration.bytes, narrationMimeType: narration.mimeType as MediaSceneInput['narrationMimeType'] } : {}), ...(durationSeconds ? { durationSeconds } : {}) };
}

export function useProductionController() {
  const [project, setProject] = useState(newProductionProject);
  const projectRef = useRef(project);
  const store = useRef<ProductionProjectStore | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pipelines, setPipelines] = useState<PipelineDefinition[]>([]);
  const [pipelineError, setPipelineError] = useState('');
  const [workingStage, setWorkingStage] = useState<string | null>(null);
  const pipelineRequest = useRef<ReturnType<NonNullable<typeof window.openMontageMedia>['pipelineContext']> | null>(null);
  const pipeline = pipelines.find((item) => item.id === project.pipelineId);
  const originalWorkflow = project.pipelineId !== 'nimi-image-explainer';
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
  const [video, setVideo] = useState<MediaRenderResult>();
  const videoUrl = useMediaUrl(video);
  const stopRequested = useRef(false);
  const currentJob = useRef<string | null>(null);
  const currentRender = useRef<string | null>(null);
  const textCancel = useRef<(() => Promise<void>) | null>(null);
  const completeAssets = assets.length > 0 && assets.length === storyboard?.scenes.length && assets.every((scene, index) => (scene.source || (storyboard?.scenes[index]?.visualKind === 'video' ? scene.video : scene.image)) && (project.narrationEnabled === false || !storyboard?.scenes[index]?.narration.trim() || scene.narration));
  const voiceReady = voicesLoaded && !voiceError && (voices.length === 0 || voices.some((voice) => voice.voiceId === project.voiceId));

  const updateProject = useCallback((change: Partial<ProductionProject>) => {
    const next = { ...projectRef.current, ...change };
    projectRef.current = next; setProject(next); return next;
  }, []);

  const recordActivity = (title: string, detail?: string) => {
    updateProject({ activity: [...(projectRef.current.activity || []), { id: crypto.randomUUID(), at: new Date().toISOString(), title, ...(detail ? { detail } : {}) }] });
  };

  const saveProject = useCallback(async (value = projectRef.current) => {
    if (!store.current) throw new Error('项目存储尚未就绪。');
    setSaveStatus('正在保存'); setSaveError('');
    try {
      await store.current.save(value);
      setSaveStatus('已保存到 Nimi');
      setLibrary((current) => [summarizeProject(value), ...current.filter((entry) => entry.id !== value.id)]);
    } catch (cause) { setSaveStatus('保存失败'); setSaveError(errorMessage(cause)); throw cause; }
  }, []);

  const refreshVoices = useCallback(async () => {
    setVoicesLoaded(false); setVoices([]); setVoiceError(''); setDisplayedConfig(null);
    try {
      const client = getNimiLocalAppClient();
      const snapshot = await client.aiConfig.get();
      setDisplayedConfig(snapshot);
      const result = await client.aiConfig.listOptions({ kind: 'preset-voices' });
      if (result.kind !== 'preset-voices') throw new Error('音色列表格式不正确。');
      setVoices(result.options); setVoicesLoaded(true);
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
    pipelineRequest.current ??= window.openMontageMedia!.pipelineContext({});
    void pipelineRequest.current.then((context) => { if (!disposed && context.type === 'catalog') setPipelines(context.pipelines); }).catch((cause) => { if (!disposed) setPipelineError(errorMessage(cause)); });
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
    const result = await window.openMontageMedia.checkpoint({ pipelineId: current.pipelineId, projectId: current.id, title: projectTitle(current), stage, status, artifacts, humanApproved, checkpoints: current.checkpoints, ...(metadata ? { metadata } : {}), ...(detail ? { error: detail } : {}) });
    recordActivity((({ scene_plan: '方案与剧本', assets: '素材', compose: '合成' } as Record<string, string>)[stage] || stage) + ' · ' + ({ completed: humanApproved ? '已确认' : '完成', awaiting_human: '等待审阅', in_progress: '开始', failed: stopRequested.current ? '已暂停' : '失败' })[status], detail);
    if (stage === 'scene_plan' && status === 'completed') {
      updateProject({ decisions: recordProductionDecision(projectRef.current, { at: result.timestamp, models: modelSummary, voice: current.voiceId, renderer: 'Remotion', frame: '1280 × 720', scene_count: current.storyboard!.scenes.length }) });
    }
    await saveProject(updateProject({ checkpoints: { ...projectRef.current.checkpoints, [stage]: result } }));
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
    if (originalWorkflow) { if (pipeline) await runOriginalStage(pipeline.stages[0]!.name); return; }
    setError(null); setBusy('planning'); setProgress('正在根据材料准备剧本与分镜'); stopRequested.current = false;
    try {
      const client = getNimiLocalAppClient();
      await saveProject(updateProject({ checkpoints: {}, needsConfirmation: true }));
      await checkpoint('scene_plan', 'in_progress', {});
      const snapshot = await client.aiConfig.get();
      await assertConfiguration(client, snapshot.revision, 'text.generate');
      if (stopRequested.current) throw new Error('已停止准备方案。');
      const stream = await client.ai.text.streamTurn({ messages: storyboardMessages(material, duration, project.sceneCount), maxTokens: Math.max(3000, (project.sceneCount || 8) * 500) });
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
      const next = updateProject({ storyboard: plan, assets: plan.scenes.map(() => ({})), needsConfirmation: true, output: undefined, textTraceId: traceId });
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
            onChange: async (change) => {
              if (change.imageJobId || change.narrationJobId) recordActivity('场景 ' + (index + 1) + ' · 任务已登记', change.imageJobId || change.narrationJobId);
              if (change.image || change.narration) recordActivity('场景 ' + (index + 1) + ' · ' + (change.image ? '配图' : '旁白') + '已收存');
              await saveProject(updateAssets(index, change));
            },
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
    setError(null); setBusy('rendering'); setWorkingStage('compose'); setProgress('正在本地混音与合成视频'); stopRequested.current = false;
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
        const visual = scene.source || scene.video || scene.image;
        if (!visual) throw new Error('请先生成并检查全部场景素材。');
        const index = projectRef.current.assets.indexOf(scene);
        const sceneId = projectRef.current.storyboard?.scenes[index]?.id || 'scene-' + (index + 1);
        return { ...mediaInput(visual, projectRef.current.narrationEnabled === false ? undefined : scene.narration, originalWorkflow ? projectRef.current.storyboard?.scenes[index]?.durationSeconds : undefined), visualAssetId: sceneId + '-visual', narrationAssetId: sceneId + '-narration' };
      });
      const renderId = crypto.randomUUID(); currentRender.current = renderId;
      const music = projectRef.current.musicState?.source || projectRef.current.musicState?.music;
      const subtitleConfig = projectRef.current.artifacts?.edit_decisions?.subtitles as { enabled?: boolean } | undefined;
      const subtitles = projectRef.current.subtitleTrack && (!originalWorkflow || subtitleConfig?.enabled === true) ? projectRef.current.subtitleTrack : undefined;
      const result = await media.render({ renderId, scenes, ...(originalWorkflow ? { editDecisions: projectRef.current.artifacts?.edit_decisions } : {}), ...(music ? { music: { bytes: music.bytes, mimeType: music.mimeType } } : {}), ...(subtitles ? { subtitles: { cues: subtitles.cues, fontSize: subtitles.fontSize, position: subtitles.position } } : {}) });
      if (!stopRequested.current) {
        setVideo(result);
        const output = await store.current!.saveVideo(projectRef.current, result, !!subtitles);
        await saveProject(updateProject({ output }));
        if (originalWorkflow) {
          const finalReview = { version: '1.0', output_path: output!.relativePath, status: 'revise', checks: { technical_probe: { valid_container: true, duration_seconds: result.durationSeconds, resolution: result.width + 'x' + result.height, has_audio: result.hasAudio, file_size_bytes: result.bytes.byteLength }, visual_spotcheck: { issues: ['等待用户检查画面'] }, audio_spotcheck: { issues: ['等待用户确认声音符合方案'] }, promise_preservation: { render_runtime_used: 'remotion', issues: ['等待用户确认制作意图'] }, subtitle_check: { subtitles_expected: !!subtitles, subtitles_present: !!subtitles, issues: subtitles ? ['等待用户确认字幕内容与时间'] : [] } } };
          await workflowCheckpoint('compose', { render_report: renderReport(result, output!), final_review: finalReview }, 'awaiting_human');
        } else await checkpoint('compose', 'completed', { render_report: renderReport(result, output!) });
      }
    } catch (cause) { setError(errorMessage(cause)); await recordFailure('compose', cause); }
    finally { currentRender.current = null; setBusy(null); setWorkingStage(null); setProgress(''); }
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
    if (Object.keys(projectRef.current.checkpoints).length) recordActivity('修订场景 ' + (index + 1), '下游审批已失效，适用素材保留');
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
      recordActivity('重新准备场景 ' + (index + 1) + ' · ' + (kind === 'image' ? '配图' : '旁白'));
      updateAssets(index, { [kind]: undefined, [key]: undefined });
      updateProject({ needsConfirmation: true, output: undefined, checkpoints: {} }); setVideo(undefined); setError(null);
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const configurationCommitted = useCallback(() => { updateProject({ needsConfirmation: true }); void refreshVoices(); }, [refreshVoices, updateProject]);
  const openProject = async (id: string, pipelineId = 'nimi-image-explainer') => {
    setError(null); setLoaded(false);
    try {
      await saveProject();
      const selected = id ? await store.current!.load(id) : newProductionProject(pipelineId);
      projectRef.current = selected; setProject(selected);
      setVideo(selected.output ? await store.current!.readVideo(selected.output) : undefined);
      setLoaded(true); setSaveStatus(id ? '项目已打开' : '新项目');
    } catch (cause) { setError('无法打开项目：' + errorMessage(cause)); setLoaded(true); }
  };
  const chooseVoice = (voiceId: string) => {
    recordActivity('选择旁白音色', voiceId);
    updateProject({ voiceId, needsConfirmation: true, output: undefined, checkpoints: {}, assets: projectRef.current.assets.map((scene) => ({ ...scene, narration: undefined, narrationJobId: undefined, ...(scene.pendingSubmission === 'narration' ? { pendingSubmission: undefined } : {}) })) });
    setVideo(undefined);
  };
  const modelSummary = [['text.generate', '文字'], ['image.generate', '配图'], ['audio.synthesize', '旁白'], ['video.generate', '视频'], ['music.generate', '音乐']].map(([capability, label]) => {
    const selection = displayedConfig?.effectiveSelections.find((entry) => entry.capabilityContract === capability);
    const resource = selection?.resource;
    const model = resource?.oneofKind === 'cloud' ? resource.cloud.target.label + ' / ' + resource.cloud.connector.label : resource?.oneofKind === 'local' ? resource.local.label : '未配置';
    return label + '：' + model + (selection?.state === 'ready' ? '' : '（未就绪）');
  }).join(' · ');


  const workflowCheckpoint = async (stage: string, artifacts: Record<string, Record<string, unknown>>, status: PipelineCheckpoint['status'], approved = false) => {
    await checkpoint(stage, status, artifacts, approved);
    await saveProject(updateProject({ artifacts: { ...projectRef.current.artifacts, ...artifacts } }));
  };

  const discardFollowingStages = (stage: string) => {
    if (!pipeline) return;
    const index = pipeline.stages.findIndex((entry) => entry.name === stage);
    const following = pipeline.stages.slice(index + 1);
    const staleArtifacts = new Set(following.flatMap((entry) => entry.produces));
    updateProject({
      checkpoints: Object.fromEntries(Object.entries(projectRef.current.checkpoints).filter(([name]) => pipeline.stages.findIndex((entry) => entry.name === name) < index)),
      artifacts: Object.fromEntries(Object.entries(projectRef.current.artifacts || {}).filter(([name]) => !staleArtifacts.has(name))),
      ...(following.some((entry) => entry.name === 'scene_plan') ? { storyboard: null, assets: [] } : {}),
      ...(index <= pipeline.stages.findIndex((entry) => entry.name === 'scene_plan') ? { needsConfirmation: true } : {}),
      ...(stage !== 'publish' ? { output: undefined } : {}),
    });
    if (stage !== 'publish') setVideo(undefined);
  };

  const runOriginalStage = async (stage: string) => {
    if (!pipeline || busy) return;
    const index = pipeline.stages.findIndex((item) => item.name === stage);
    const definition = pipeline.stages[index];
    if (!definition) return;
    setError(null); stopRequested.current = false; setWorkingStage(stage); setBusy('planning');
    try {
      for (const previous of pipeline.stages.slice(0, index)) if (projectRef.current.checkpoints[previous.name]?.status !== 'completed') throw new Error('请先完成并确认' + (stageNames[previous.name] || previous.name) + '。');
      // Project export copies the reviewed output; it does not consume the changed AI configuration.
      if (stage !== 'publish' && index > pipeline.stages.findIndex((entry) => entry.name === 'scene_plan') && needsConfirmation) throw new Error('制作材料或 AI 配置有修订，请先审阅并重新确认分镜与配置。');
      if (stage === 'research' || !['idea', 'proposal', 'script', 'scene_plan', 'assets', 'edit', 'compose', 'publish'].includes(stage)) throw new Error('原版阶段“' + (stageNames[stage] || stage) + '”的工具执行尚未接入。该阶段保留在迁移清单中，不会以虚构产物跳过。');
      discardFollowingStages(stage);
      await saveProject();
      if (stage === 'assets') { await generateWorkflowAssets(); return; }
      if (stage === 'compose') { await render(); return; }
      await checkpoint(stage, 'in_progress', {});
      if (stage === 'publish') {
        if (!projectRef.current.output) throw new Error('请先完成成片审阅。');
        await workflowCheckpoint(stage, { publish_log: { version: '1.0', entries: [{ platform: 'local-project', status: 'draft', timestamp: new Date().toISOString(), metadata_used: { title: projectTitle(projectRef.current), description: projectRef.current.material, hashtags: [] } }] } }, 'awaiting_human');
        return;
      }
      setProgress('正在准备' + (stageNames[stage] || stage));
      const context = await window.openMontageMedia!.pipelineContext({ pipelineId: projectRef.current.pipelineId, stage });
      if (context.type !== 'stage') throw new Error('阶段上下文不完整。');
      const client = getNimiLocalAppClient();
      if (!displayedConfig) throw new Error('请先确认 AI 配置。');
      await assertConfiguration(client, displayedConfig.revision, 'text.generate');
      let correction: { output: string; validationError: string } | undefined;
      let artifacts: Record<string, Record<string, unknown>> = {};
      let traceId = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        await assertConfiguration(client, displayedConfig.revision, 'text.generate');
        const stream = await client.ai.text.streamTurn({ messages: stageMessages(projectRef.current, context, modelSummary, correction), maxTokens: 4096 });
        textCancel.current = () => stream.cancel();
        let text = ''; let complete = false;
        try {
          for await (const event of stream) {
            if (stopRequested.current) { await stream.cancel(); throw new Error('已停止阶段准备。'); }
            if (event.type === 'delta') text += event.text;
            else if (event.type === 'completed') { complete = event.finishReason === 'stop'; traceId = event.traceId; }
            else if (event.type === 'failed') throw new Error(event.reasonCode);
          }
        } finally { textCancel.current = null; await stream.cancel(); }
        if (!complete) throw new Error('模型没有完整结束当前阶段，请重试。');
        artifacts = parseStageArtifacts(text, definition.produces);
        try {
          await workflowCheckpoint(stage, artifacts, definition.gated ? 'awaiting_human' : 'completed');
          break;
        } catch (cause) {
        if (attempt > 0 || !/Artifact .+ failed schema validation/.test(errorMessage(cause))) throw cause;
        recordActivity('阶段产物格式修正', errorMessage(cause));
        correction = { output: text, validationError: errorMessage(cause) };
          setProgress('阶段产物格式未通过检查，正在修正一次');
        }
      }
      const documents = { ...projectRef.current.artifacts, ...artifacts };
      if (stage === 'scene_plan') {
        const plan = storyboardFromArtifacts(documents, projectTitle(projectRef.current));
        if (!plan?.scenes.length) throw new Error('分镜产物没有可制作的场景。');
        await saveProject(updateProject({ storyboard: plan, assets: plan.scenes.map(() => ({})), needsConfirmation: true, textTraceId: traceId }));
      }
    } catch (cause) { setError(errorMessage(cause)); await recordFailure(stage, cause); }
    finally { setWorkingStage(null); setBusy(null); setProgress(''); }
  };

  const approveOriginalStage = async (stage: string) => {
    const current = projectRef.current;
    const saved = current.checkpoints[stage];
    if (!saved || busy) return;
    setBusy('planning'); setWorkingStage(stage); setError(null);
    try {
      let artifacts = saved.artifacts as Record<string, Record<string, unknown>>;
      if (stage === 'scene_plan') {
        const plan = storyboardFromArtifacts({ ...current.artifacts, ...artifacts }, projectTitle(current));
        if (!plan?.scenes.length) throw new Error('请先修订可制作的分镜。');
      }
      if (Array.isArray(artifacts.decision_log?.decisions)) {
        artifacts = { ...artifacts, decision_log: { ...artifacts.decision_log, decisions: artifacts.decision_log.decisions.map((entry) => ({ ...entry, user_approved: true })) } };
      }
      if (stage === 'compose') {
        const review = { ...artifacts.final_review, status: 'pass', checks: { ...(artifacts.final_review.checks as Record<string, unknown>), visual_spotcheck: { issues: [] }, audio_spotcheck: { issues: [] }, promise_preservation: { render_runtime_used: 'remotion', delivery_promise_honored: true }, subtitle_check: { issues: [] } }, metadata: { review_source: 'user-confirmed-in-app', confirmed_at: new Date().toISOString() } };
        artifacts = { ...artifacts, final_review: review };
      }
      if (stage === 'publish') {
        if (!current.output || !store.current) throw new Error('没有可导出的成片。');
        const media = video || await store.current.readVideo(current.output);
        const destination = 'projects/' + current.id + '/exports/' + current.output.relativePath.split('/').at(-1);
        await getNimiLocalAppClient().storage.assets.write({ relativePath: destination, body: media.bytes, mediaType: 'video/mp4', overwrite: true });
        const metadata = { title: projectTitle(current), description: current.material };
        await getNimiLocalAppClient().storage.writeJson('production/exports/' + current.id + '.json', metadata);
        artifacts = { publish_log: { version: '1.0', entries: [{ platform: 'local-project', status: 'exported', timestamp: new Date().toISOString(), export_path: destination, metadata_used: metadata }], metadata: { scope: 'Nimi project export; no external platform posting' } } };
      }
      await workflowCheckpoint(stage, artifacts, 'completed', true);
      await saveProject(updateProject({ needsConfirmation: false }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); setWorkingStage(null); }
  };

  const reviseOriginalArtifact = async (stage: string, artifacts: Record<string, Record<string, unknown>>) => {
    if (!pipeline || busy) return;
    setBusy('planning'); setError(null);
    try {
      recordActivity('修订' + (stageNames[stage] || stage), '后续阶段需要重新准备。');
      if (stage === 'scene_plan') storyboardFromArtifacts({ ...projectRef.current.artifacts, ...artifacts }, projectTitle(projectRef.current));
      discardFollowingStages(stage);
      await workflowCheckpoint(stage, artifacts, 'awaiting_human');
      if (stage === 'scene_plan' || stage === 'script') {
        const plan = storyboardFromArtifacts(projectRef.current.artifacts || {}, projectTitle(projectRef.current));
        if (plan) await saveProject(updateProject({ storyboard: plan, assets: retainSceneAssets(projectRef.current.storyboard, projectRef.current.assets, plan) }));
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };

  const generateWorkflowAssets = async () => {
    const current = projectRef.current;
    if (!current.storyboard || !displayedConfig) throw new Error('请先完成分镜与 AI 配置。');
    const approvedRevision = current.checkpoints.scene_plan?.metadata?.ai_config_revision;
    if (typeof approvedRevision !== 'string') throw new Error('请先确认分镜使用的 AI 配置。');
    await assertConfiguration(getNimiLocalAppClient(), approvedRevision);
    const plannedScenes = (current.artifacts?.scene_plan?.scenes || []) as { required_assets?: Record<string, unknown>[] }[];
    const plannedMusic = plannedScenes.flatMap((scene) => scene.required_assets || []).filter((asset) => asset.type === 'music');
    const musicRequests = [...new Set(plannedMusic.map((asset) => String(asset.source_asset_id || asset.description)))];
    if (musicRequests.length > 1) throw new Error('分镜要求多个不同配乐轨道，当前多轨编辑尚未接入，不能省略其中的音乐。');
    const musicRequest = plannedMusic[0];
    const sourceMusic = typeof musicRequest?.source_asset_id === 'string' ? current.sources?.find((source) => source.id === musicRequest.source_asset_id) : undefined;
    if (musicRequest && musicRequest.source !== 'generate' && !sourceMusic?.mimeType.startsWith('audio/')) throw new Error('分镜中的配乐需要实际导入的音频来源。');
    const musicPrompt = current.musicPrompt?.trim() || String(musicRequest?.description || '');
    if (musicPrompt && !sourceMusic && !current.musicLyrics?.trim()) throw new Error('当前 Nimi 音乐生成需要歌词；请填写歌词。器乐生成仍待接入，也可以在分镜中选择已导入的配乐。');
    if (musicPrompt && !sourceMusic && current.duration > 180) throw new Error('当前 Nimi 音乐单段生成上限为 180 秒，请调整音乐方案。');
    const neededCapabilities = new Set<string>(current.storyboard.scenes.filter((scene) => !scene.sourceAssetId).map((scene) => scene.visualKind === 'video' ? 'video.generate' : 'image.generate'));
    if (current.narrationEnabled !== false && current.storyboard.scenes.some((scene) => scene.narration.trim())) neededCapabilities.add('audio.synthesize');
    if (musicPrompt && !sourceMusic) neededCapabilities.add('music.generate');
    await assertConfiguration(getNimiLocalAppClient(), approvedRevision, [...neededCapabilities]);
    let referenceArtifactId: string | undefined;
    if (current.referenceImageId) {
      const reference = current.sources?.find((source) => source.id === current.referenceImageId);
      if (!reference || !['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType)) throw new Error('首帧参考图不存在，请重新选择。');
      referenceArtifactId = reference.referenceArtifactId;
      if (!referenceArtifactId) {
        const uploaded = await getNimiLocalAppClient().ai.artifacts.upload({ bytes: reference.bytes, mimeType: reference.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' });
        referenceArtifactId = uploaded.artifactId;
        await saveProject(updateProject({ sources: current.sources!.map((source) => source.id === reference.id ? { ...source, referenceArtifactId } : source) }));
      }
    }
    await checkpoint('assets', 'in_progress', {});
    setBusy('assets');
    for (const [index, scene] of current.storyboard.scenes.entries()) {
      if (stopRequested.current) throw new Error('已停止后续生成。');
      if (scene.sourceAssetId) {
        const source = current.sources?.find((item) => item.id === scene.sourceAssetId);
        if (!source) throw new Error('场景引用的源素材不存在：' + scene.sourceAssetId);
        if (!source.mimeType.startsWith(scene.visualKind === 'video' ? 'video/' : 'image/')) throw new Error('场景源素材类型与分镜不符，请修订来源。');
        await saveProject(updateAssets(index, { source }));
      } else {
        const kind = scene.visualKind === 'video' ? 'video' : 'image';
        setProgress('场景 ' + (index + 1) + ' · 生成' + (kind === 'video' ? '视频' : '配图'));
        await generateSceneMedia({ client: getNimiLocalAppClient(), projectId: current.id, scene, kind, referenceArtifactId, voiceId: current.voiceId, existing: projectRef.current.assets[index], approvedRevision, stopped: () => stopRequested.current, onJob: (id) => { currentJob.current = id; }, onStatus: (status) => { if (status === 'canceled') setProgress('Nimi 已确认取消'); }, onChange: async (change) => { if (change.imageJobId || change.videoJobId) recordActivity('场景 ' + (index + 1) + ' · 画面任务已登记', change.imageJobId || change.videoJobId); await saveProject(updateAssets(index, change)); } });
      }
      if (current.narrationEnabled !== false && scene.narration.trim()) {
        setProgress('场景 ' + (index + 1) + ' · 生成旁白');
        await generateSceneMedia({ client: getNimiLocalAppClient(), projectId: current.id, scene, kind: 'narration', voiceId: current.voiceId, existing: projectRef.current.assets[index], approvedRevision: displayedConfig.revision, stopped: () => stopRequested.current, onJob: (id) => { currentJob.current = id; }, onStatus: () => undefined, onChange: async (change) => { await saveProject(updateAssets(index, change)); } });
      }
    }
    if (sourceMusic) {
      await saveProject(updateProject({ musicState: { source: sourceMusic } }));
    } else if (musicPrompt) {
      setProgress('生成配乐');
      await generateSceneMedia({ client: getNimiLocalAppClient(), projectId: current.id, scene: { title: '配乐', narration: '', imagePrompt: musicPrompt, durationSeconds: current.duration }, kind: 'music', musicLyrics: current.musicLyrics, voiceId: '', existing: projectRef.current.musicState || {}, approvedRevision, stopped: () => stopRequested.current, onJob: (id) => { currentJob.current = id; }, onStatus: () => undefined, onChange: async (change) => { await saveProject(updateProject({ musicState: { ...projectRef.current.musicState, ...change } })); } });
    }
    await workflowCheckpoint('assets', { asset_manifest: assetManifest(projectRef.current) }, 'awaiting_human');
  };

  const importSource = async (file: File) => {
    if (busy) return;
    setBusy('assets'); setProgress('收存源素材'); setError(null);
    try {
      const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
      if (!extensions[file.type]) throw new Error('当前素材入口支持 PNG/JPEG/WebP、MP4/WebM 和 MP3/WAV。');
      if (file.size > 128 * 1024 * 1024) throw new Error('该文件超过当前预览入口的 128 MiB 限制，大源文件流转仍在迁移。');
      const source: SourceMedia = { id: crypto.randomUUID(), name: file.name, relativePath: '', mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
      source.relativePath = 'projects/' + projectRef.current.id + '/sources/' + source.id + '.' + extensions[file.type];
      const url = URL.createObjectURL(file);
      try {
        if (file.type.startsWith('image/')) { const bitmap = await createImageBitmap(file); source.width = bitmap.width; source.height = bitmap.height; bitmap.close(); }
        else { const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio'); await new Promise<void>((resolve, reject) => { element.onloadedmetadata = () => { source.durationSeconds = element.duration; if (element instanceof HTMLVideoElement) { source.width = element.videoWidth; source.height = element.videoHeight; } resolve(); }; element.onerror = () => reject(new Error('源素材无法解码。')); element.src = url; }); element.removeAttribute('src'); element.load(); }
      } finally { URL.revokeObjectURL(url); }
      await getNimiLocalAppClient().storage.assets.write({ relativePath: source.relativePath, body: file, mediaType: file.type });
      recordActivity('导入源素材', file.name);
      await saveProject(updateProject({ sources: [...(projectRef.current.sources || []), source], needsConfirmation: true }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); setProgress(''); }
  };

  const transcribeSourceFile = async (sourceId: string, options: Pick<SourceTranscription, 'startSeconds' | 'endSeconds' | 'language' | 'timestamps'>, restart = false) => {
    const source = projectRef.current.sources?.find((item) => item.id === sourceId);
    if (!source || busy) return;
    setBusy('assets'); setError(null); stopRequested.current = false; setProgress('准备并转写 ' + source.name);
    try {
      if (!displayedConfig) throw new Error('请先选择转写模型。');
      await transcribeSource({ client: getNimiLocalAppClient(), source, options, restart, approvedRevision: displayedConfig.revision,
        stopped: () => stopRequested.current, onJob: (id) => { currentJob.current = id; }, onPreparation: (id) => { currentRender.current = id; }, onStatus: (status) => setProgress('转写 ' + source.name + ' · ' + status),
        onChange: async (transcription) => {
          const previous = projectRef.current.sources?.find((item) => item.id === sourceId);
          if (transcription.jobId && transcription.jobId !== (previous?.transcriptionRequest || previous?.transcription)?.jobId) recordActivity('转写任务已登记', transcription.jobId);
          await saveProject(updateProject({ sources: projectRef.current.sources!.map((item) => item.id !== sourceId ? item : transcription.text !== undefined ? { ...item, transcription, transcriptionRequest: undefined } : { ...item, transcriptionRequest: transcription }) }));
        },
      });
      recordActivity('源素材转写已收存', source.name);
    } catch (cause) {
      const message = errorMessage(cause); setError(message);
      await saveProject(updateProject({ sources: projectRef.current.sources?.map((item) => item.id === sourceId && item.transcriptionRequest ? { ...item, transcriptionRequest: { ...item.transcriptionRequest, error: message } } : item) })).catch(() => undefined);
    }
    finally { setBusy(null); setProgress(''); currentJob.current = null; currentRender.current = null; }
  };

  const editTranscription = (sourceId: string, text: string) => {
    updateProject({ sources: projectRef.current.sources?.map((source) => source.id === sourceId && source.transcription ? { ...source, transcription: { ...source.transcription, text, edited: text !== source.transcription.originalText } } : source) });
  };

  const keepSavedTranscription = async (sourceId: string) => {
    const source = projectRef.current.sources?.find((item) => item.id === sourceId);
    if (!source?.transcription || busy) return;
    setBusy('planning'); setError(null);
    try {
      const request = source.transcriptionRequest;
      if (request?.pendingSubmission) throw new Error('提交结果仍不确定，请先核对原任务。');
      if (request?.jobId) {
        const { job } = await getNimiLocalAppClient().ai.scenarioJobs.get(request.jobId);
        if (!['completed', 'failed', 'canceled', 'timeout'].includes(job.status)) throw new Error('当前转写任务尚未结束，请先停止或继续原任务。');
      }
      recordActivity('保留已保存的转写', source.name);
      await saveProject(updateProject({ sources: projectRef.current.sources!.map((item) => item.id === sourceId ? { ...item, transcriptionRequest: undefined } : item) }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };

  const createNarrationSubtitles = async () => {
    if (busy) return;
    setError(null); setBusy('planning');
    try {
      for (const [index, scene] of projectRef.current.assets.entries()) if (scene.narration && !scene.narration.durationSeconds) updateAssets(index, { narration: { ...scene.narration, durationSeconds: await measureMediaDuration(scene.narration) } });
      const cues = validateCues(narrationCues(projectRef.current), video?.durationSeconds);
      await saveProject(updateProject({ subtitleDraft: { cues, origin: 'narration', fontSize: 36, position: 'bottom-center' } }));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  };

  const exportSubtitleDraft = async () => {
    const draft = projectRef.current.subtitleDraft;
    if (!draft) throw new Error('请先创建字幕。');
    return window.openMontageMedia!.exportSubtitles({ cues: validateCues(draft.cues, video?.durationSeconds) });
  };

  const applySubtitles = async (remove = false) => {
    const current = projectRef.current; const draft = current.subtitleDraft;
    if ((!draft && !remove) || busy) return;
    setError(null); setBusy('planning'); setProgress(remove ? '正在移除字幕并准备合成' : '正在保存字幕并准备合成');
    try {
      if (current.checkpoints.assets?.status !== 'completed') throw new Error('请先完成素材审阅。');
      if (originalWorkflow && !current.artifacts?.edit_decisions) throw new Error('请先完成剪辑方案。');
      let track: SubtitleTrack | undefined;
      if (!remove) {
        if (!Number.isInteger(draft!.fontSize) || draft!.fontSize < 12 || draft!.fontSize > 96) throw new Error('字幕字号应为 12–96 的整数。');
        const files = await exportSubtitleDraft(); const id = crypto.randomUUID();
        const srtPath = 'projects/' + current.id + '/subtitles/' + id + '.srt'; const vttPath = 'projects/' + current.id + '/subtitles/' + id + '.vtt';
        const client = getNimiLocalAppClient();
        await client.storage.assets.write({ relativePath: srtPath, body: new TextEncoder().encode(files.srt), mediaType: 'application/x-subrip' });
        await client.storage.assets.write({ relativePath: vttPath, body: new TextEncoder().encode(files.vtt), mediaType: 'text/vtt' });
        track = { ...draft!, cues: validateCues(draft!.cues), srtPath, vttPath };
      }
      const checkpoints = Object.fromEntries(Object.entries(current.checkpoints).filter(([name]) => !['compose', 'publish'].includes(name)));
      updateProject({ subtitleTrack: track, checkpoints, output: undefined }); setVideo(undefined);
      await workflowCheckpoint('assets', { asset_manifest: assetManifest(projectRef.current) }, 'completed', true);
      if (originalWorkflow) await workflowCheckpoint('edit', { edit_decisions: { ...current.artifacts!.edit_decisions, subtitles: track ? { enabled: true, source: 'project-subtitles', style: 'sentence', font_size: track.fontSize, position: track.position } : { enabled: false } } }, 'completed', true);
      recordActivity(remove ? '从成片移除字幕' : '字幕已应用到剪辑', track ? track.cues.length + ' 条字幕，使用现有媒体重新合成。' : '保留字幕草稿，使用现有媒体重新合成。');
      await saveProject(); await render();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); setProgress(''); }
  };
  const arrangeScenes = (scenes: readonly StoryScene[], nextAssets: SceneGeneration[], action: string) => {
    const current = projectRef.current.storyboard;
    if (!current || scenes.length < 1 || scenes.length > 12 || busy) return;
    recordActivity(action, '请重新确认方案；已完成且仍适用的素材保留。');
    updateProject({ storyboard: { ...current, scenes }, assets: nextAssets, checkpoints: {}, needsConfirmation: true, output: undefined });
    setVideo(undefined);
  };
  const addScene = () => {
    if (!storyboard || storyboard.scenes.length >= 12) return;
    arrangeScenes([...storyboard.scenes, { title: '新场景', narration: '', imagePrompt: '' }], [...assets, {}], '添加场景');
  };
  const removeScene = async (index: number) => {
    if (!storyboard || storyboard.scenes.length <= 1) return;
    try {
      const scene = assets[index];
      if (scene.pendingSubmission) throw new Error('该场景有结果不确定的提交，请先核对原任务。');
      for (const kind of ['image', 'narration'] as const) {
        const jobId = scene[kind === 'image' ? 'imageJobId' : 'narrationJobId'];
        if (jobId && !scene[kind]) {
          const { job } = await getNimiLocalAppClient().ai.scenarioJobs.get(jobId);
          if (!['completed', 'failed', 'canceled', 'timeout'].includes(job.status)) throw new Error('该场景任务仍在运行，请先继续或取消原任务。');
        }
      }
      arrangeScenes(storyboard.scenes.filter((_, i) => i !== index), assets.filter((_, i) => i !== index), '移除场景 ' + (index + 1));
    } catch (cause) { setError(errorMessage(cause)); }
  };
  const moveScene = (index: number, delta: number) => {
    if (!storyboard || index + delta < 0 || index + delta >= assets.length) return;
    const scenes = [...storyboard.scenes]; const nextAssets = [...assets];
    [scenes[index], scenes[index + delta]] = [scenes[index + delta], scenes[index]];
    [nextAssets[index], nextAssets[index + delta]] = [nextAssets[index + delta], nextAssets[index]];
    arrangeScenes(scenes, nextAssets, '调整场景顺序');
  };
  return { project, library, loaded, saveStatus, saveError, voices, voiceReady, voiceError, displayedConfig,
    busy, progress, error, video, videoUrl, completeAssets, needsConfirmation, modelSummary,
    updateProject, openProject, chooseVoice, configurationCommitted, prepare, generateAssets, render, stop,
    editScene, regenerate, addScene, removeScene, moveScene, pipelines, pipeline, pipelineError, originalWorkflow, workingStage, runOriginalStage, approveOriginalStage, reviseOriginalArtifact, importSource,
    transcribeSourceFile, editTranscription, keepSavedTranscription, createNarrationSubtitles, exportSubtitleDraft, applySubtitles };
}
