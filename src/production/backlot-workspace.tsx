import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Clapperboard, Download, Expand, Film, Plus, Settings2, Square, Trash2, X } from 'lucide-react';
import originalBacklotStyles from '../../backlot/ui/board.css?raw';
import { AIConfigPanel } from './ai-config-panel.js';
import { SourceTranscriptionCard } from './source-transcription.js';
import { SubtitleEditor } from './subtitle-editor.js';
import { getNimiLocalAppClient } from '../shell/auth/local-app-client.js';
import { readAsset, summarizeProject, projectTitle, type ProductionProject, type ProjectSummary } from './project-store.js';
import { useMediaUrl, useProductionController } from './use-production.js';
import type { SceneGeneration, SourceMedia } from './generation.js';
import './backlot-workspace.css';
import { nextPipelineStage, pipelineNames, stageNames } from './pipeline-workflow.js';

// Reuse Backlot's actual visual system without its filesystem server, remote
// font import, global resets or animated grain crossing the Nimi shell boundary.
const backlotStyles = '@scope (.backlot-app) {' + originalBacklotStyles
  .replace(/@import\s+url\([^)]*\)\s*;/g, '')
  .replace(/body::after\s*\{[\s\S]*?\}/, '')
  .replace(/:root/g, ':scope').replace(/(?<![-\w])(?:html|body)(?![-\w])/g, ':scope') + '}';
const quickStages = [{ id: 'scene_plan', label: '方案与剧本', view: 'script' }, { id: 'assets', label: '分镜与素材', view: 'assets' }, { id: 'compose', label: '合成与交付', view: 'result' }] as const;
type View = 'captions' | 'pipelines' | 'library' | 'brief' | 'board' | 'script' | 'assets' | 'result';
type Controller = ReturnType<typeof useProductionController>;
function duration(value: number) { const seconds = Math.round(value); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); }
function stageLabel(status?: string, active = false, paused = false) { return paused ? '已暂停' : status === 'completed' ? '已完成' : status === 'awaiting_human' ? '等待确认' : status === 'in_progress' ? active ? '进行中' : '待继续' : status === 'failed' ? '待处理' : '未开始'; }

function LibraryCard({ summary, disabled, onOpen }: { summary: ProjectSummary; disabled: boolean; onOpen: () => void }) {
  const [entry, setEntry] = useState(summary);
  const [poster, setPoster] = useState<{ bytes: Uint8Array; mimeType: string }>();
  const url = useMediaUrl(poster);
  useEffect(() => {
    let active = true;
    const client = getNimiLocalAppClient();
    void (async () => {
      const { value } = await client.storage.readJson('production/projects/' + summary.id + '.json');
      const project = value as unknown as ProductionProject;
      const derived = { ...summarizeProject(project), updatedAt: summary.updatedAt };
      if (active) setEntry(derived);
      const image = project.assets.find((asset) => asset.image)?.image;
      if (image) { const bytes = await readAsset(client, image.relativePath); if (active) setPoster({ bytes, mimeType: image.mimeType }); }
    })().catch(() => { /* Opening the project reports the actual storage error. */ });
    return () => { active = false; };
  }, [summary.id, summary.updatedAt]);
  return <button className="lib-card" disabled={disabled} onClick={onOpen}>
    <div className="lib-poster">{url ? <img src={url} alt="" /> : <span className="lp-txt"><Film size={32} /><span>等待第一张画面</span></span>}<span className="lp-live">{entry.hasOutput ? '已有成片' : entry.stages?.some((stage) => stage.status === 'awaiting_human') ? '等待你的确认' : '继续制作'}</span></div>
    <div className="lib-body"><h3>{entry.title}</h3><div className="lb-meta"><span>{entry.sceneCount || 0} 个场景</span><time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</time></div><div className="mini-rail">{quickStages.map((stage) => <i key={stage.id} className={entry.stages?.find((item) => item.stage === stage.id)?.status === 'completed' ? 'd' : ''} title={stage.label} />)}</div></div>
  </button>;
}

function SceneMedia({ asset, index, selected, onSelect, onDuration }: { asset: SceneGeneration; index: number; selected: boolean; onSelect: () => void; onDuration: (index: number, value: number) => void }) {
  const image = useMediaUrl(asset.image); const audio = useMediaUrl(asset.narration);
  return <>
    <button className={'thumb ' + (selected ? 'selected' : '')} onClick={onSelect} aria-label={'审阅场景 ' + (index + 1)} aria-pressed={selected}>{image ? <img src={image} alt={'场景 ' + (index + 1) + ' 配图'} /> : <span className="bl-media-empty"><Film size={24} />{asset.pendingSubmission ? '提交结果待核对' : asset.imageJobId ? '任务已登记，等待素材' : '配图尚未生成'}</span>}</button>
    {audio ? <audio controls preload="metadata" src={audio} aria-label={'场景 ' + (index + 1) + ' 的旁白'} onLoadedMetadata={(event) => onDuration(index, event.currentTarget.duration)} /> : <p className="bl-muted">旁白尚未生成</p>}
  </>;
}

function Brief({ c, onPrepared }: { c: Controller; onPrepared?: () => void }) {
  return <section className="bl-brief panel" aria-label="制作材料">
    <div className="panel-head"><h2>从材料与意图开始</h2><span className="meta">{pipelineNames[c.project.pipelineId] || c.project.pipelineId}</span></div>
    <div className="panel-body"><p>写清楚要表达的内容和观众。流程会分别准备方案、剧本和分镜，按原版阶段要求等待确认。</p>
      <label htmlFor="production-material">事实材料与创作意图</label><textarea id="production-material" rows={8} value={c.project.material} disabled={!c.loaded || !!c.busy} maxLength={12000} onChange={(event) => c.updateProject({ material: event.target.value, needsConfirmation: true })} placeholder="描述这次作品的主题、观众、已有材料和希望保留的画面或声音。" />
      <div className="bl-fields"><label>目标时长（秒）{c.originalWorkflow ? <input aria-label="目标时长" type="number" min={1} value={c.project.duration} disabled={!!c.busy} onChange={(e) => c.updateProject({ duration: Number(e.target.value), needsConfirmation: true })} /> : <select aria-label="目标时长" value={c.project.duration} disabled={!!c.busy} onChange={(e) => c.updateProject({ duration: Number(e.target.value), needsConfirmation: true })}>{[30, 45, 60].map((value) => <option key={value} value={value}>{value} 秒</option>)}</select>}</label>
      <label>场景安排{c.originalWorkflow ? <input aria-label="场景安排" type="number" min={1} placeholder="根据内容安排" value={c.project.sceneCount || ""} disabled={!!c.busy} onChange={(e) => c.updateProject({ sceneCount: Number(e.target.value) || undefined, needsConfirmation: true })} /> : <select aria-label="场景安排" value={c.project.sceneCount || ''} disabled={!!c.busy} onChange={(e) => c.updateProject({ sceneCount: Number(e.target.value) || undefined, needsConfirmation: true })}><option value="">根据内容安排</option>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1} 个场景</option>)}</select>}</label>
      <label>旁白音色<select aria-label="旁白音色" value={c.project.voiceId} disabled={!!c.busy || !c.voices.length} onChange={(e) => c.chooseVoice(e.target.value)}><option value="">选择音色</option>{c.voices.map((voice) => <option value={voice.voiceId} key={voice.voiceId}>{voice.name}</option>)}</select></label></div>
      {c.originalWorkflow && <>
        <div className="bl-fields"><label>生成画面形式<select aria-label="生成画面形式" value={c.project.visualMode || 'mixed'} disabled={!!c.busy} onChange={(e) => c.updateProject({ visualMode: e.target.value as 'image' | 'video' | 'mixed', needsConfirmation: true })}><option value="mixed">视频与配图混合</option><option value="video">真实生成视频</option><option value="image">生成配图</option></select></label><label>生成视频单段时长（秒）<input aria-label="视频片段时长" type="number" min={1} value={c.project.clipDurationSeconds || 5} disabled={!!c.busy} onChange={(e) => c.updateProject({ clipDurationSeconds: Number(e.target.value), needsConfirmation: true })} /></label></div>
        <label className="bl-check"><input type="checkbox" checked={c.project.narrationEnabled !== false} disabled={!!c.busy} onChange={(e) => c.updateProject({ narrationEnabled: e.target.checked, needsConfirmation: true })} />生成旁白</label>
        <label>配乐要求（留空表示本轮不生成配乐）<textarea rows={2} value={c.project.musicPrompt || ''} disabled={!!c.busy} onChange={(e) => c.updateProject({ musicPrompt: e.target.value, musicState: undefined, needsConfirmation: true })} placeholder="例如：温柔、舒缓的旋律，配合日落与海浪。" /></label>
        {c.project.musicPrompt?.trim() && <label>配乐歌词<textarea rows={3} value={c.project.musicLyrics || ""} disabled={!!c.busy} onChange={(e) => c.updateProject({ musicLyrics: e.target.value, musicState: undefined, needsConfirmation: true })} placeholder="填写歌词。器乐生成仍待接入；已有器乐可作为源素材导入。" /></label>}
        <section className="bl-source-input"><h3>已有素材</h3><p className="bl-muted">导入的文件保存在当前 Nimi 项目；可将视频或音频交给 Nimi 转写；规划会使用实际转写文字、文件信息和你的说明。</p><label className="bl-button">导入图片、视频或音频<input type="file" aria-label="导入源素材" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav" multiple disabled={!!c.busy} onChange={(e) => { const files = [...(e.target.files || [])]; void (async () => { for (const file of files) await c.importSource(file); })(); e.target.value = ''; }} /></label>{c.project.sources?.map((source) => source.mimeType.startsWith("video/") || source.mimeType.startsWith("audio/") ? <SourceTranscriptionCard key={source.id} source={source} c={c} /> : <div className="bl-source-row" key={source.id}><span>{source.name}</span><span className="bl-muted">{source.durationSeconds ? duration(source.durationSeconds) : source.width && source.height ? source.width + ' × ' + source.height : source.mimeType}</span></div>)}</section>
        {c.project.sources?.some((source) => source.mimeType.startsWith('image/')) && <label>视频首帧参考<select aria-label="视频首帧参考" value={c.project.referenceImageId || ''} disabled={!!c.busy} onChange={(e) => c.updateProject({ referenceImageId: e.target.value || undefined, needsConfirmation: true })}><option value="">不使用，按文字生成视频</option>{c.project.sources.filter((source) => source.mimeType.startsWith('image/')).map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label>}
      </>}
      {c.voiceError && <p className="bl-error">{c.voiceError}</p>}
      <p className="bl-muted">当前接入的合成输出为横向 720p。其它画幅、复杂图层和专用工具仍在迁移。模型和服务由 Nimi AI 设置决定，不会暗中替换。</p>
      <button className="bl-primary" disabled={!c.loaded || !c.project.material.trim() || !!c.busy || (c.originalWorkflow && !c.pipeline)} onClick={() => void c.prepare().then(onPrepared)}>{Object.keys(c.project.checkpoints).length ? '重新准备方案' : '准备制作方案'}<ArrowRight size={16} /></button>
    </div>
  </section>;
}

function Decisions({ c }: { c: Controller }) {
  const choices = c.project.decisions?.at(-1);
  return <section className="panel"><div className="panel-head"><h2>制作决策</h2><span className="meta">{choices ? c.needsConfirmation ? '上次确认 · 当前修订待确认' : '已确认方案' : '当前配置'}</span></div><div className="panel-body">
    <div className="decision"><div className="d-cat">AI 模型</div><p className="d-pick">{choices?.models || c.modelSummary}</p>{!choices && <p className="d-why">尚无已记录的确认选择；当前配置将在确认方案时保存。</p>}</div>
    <div className="decision"><div className="d-cat">声音与合成</div><p className="d-pick">{choices?.voice || c.project.voiceId || '尚未选择音色'} <span className="arrow">→</span> {choices?.renderer || 'Remotion'}</p><p className="d-why">{choices?.frame || '1280 × 720'} · {choices?.scene_count || c.project.storyboard?.scenes.length || '待规划'} 个场景</p></div>
    {(c.project.decisions?.length || 0) > 1 && <details className="bl-decision-history"><summary>历史选择（{c.project.decisions!.length}）</summary>{[...c.project.decisions!].reverse().map((decision) => <div className="decision" key={decision.at}><time dateTime={decision.at}>{new Date(decision.at).toLocaleString('zh-CN')}</time><p className="d-why">{decision.models}</p><p className="d-why">{decision.voice} · {decision.scene_count} 场景 · {decision.renderer}</p></div>)}</details>}<div className="decision"><div className="d-cat">生成费用</div><p className="d-pick">实际费用暂不可得</p><p className="d-why">费用按 Nimi 中配置的服务计量。没有可用报价或账单数据，不估造金额。</p></div>
  </div></section>;
}

function Activity({ c }: { c: Controller }) {
  // Like Backlot's state projection, render recorded events; never synthesize a
  // tool success, cost or timestamp from how long this window has been open.
  const entries = c.project.activity?.length ? c.project.activity : Object.values(c.project.checkpoints).map((cp) => ({ id: cp.stage, at: cp.timestamp, title: (quickStages.find((s) => s.id === cp.stage)?.label || cp.stage) + ' · ' + stageLabel(cp.status, false, !!cp.metadata?.scheduling_stopped_by_user), detail: cp.error }));
  return <section className="panel"><div className="panel-head"><h2>活动记录</h2><span className="meta">已保存的制作动作</span></div><div className="panel-body bl-activity">{entries.length ? [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((entry) => <div className="bl-event" key={entry.id}><time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><div><p>{entry.title}</p>{entry.detail && <details><summary>详情</summary><p>{entry.detail}</p></details>}</div></div>) : <p className="bl-muted">开始制作后，阶段确认、任务登记和修订会记录在这里。</p>}</div></section>;
}

function viewedPipelineStage(c: Controller, view: View, stageView: string | null) {
  return stageView || ({ script: "script", assets: "assets", result: "compose" } as Record<string, string>)[view] || (c.pipeline ? nextPipelineStage(c.project, c.pipeline)?.name || c.pipeline.stages.at(-1)?.name : undefined);
}

export function BacklotWorkspace() {
  const c = useProductionController();
  const [view, setView] = useState<View>('library');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stageView, setStageView] = useState<string | null>(null);
  const stages = c.originalWorkflow ? (c.pipeline?.stages.map((stage) => ({ id: stage.name, label: stageNames[stage.name] || stage.name, view: 'board' as const })) || []) : quickStages;
  const [selected, setSelected] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const scenes = c.project.storyboard?.scenes || [];
  const activeIndex = Math.min(selected, Math.max(0, scenes.length - 1));
  const activeScene = scenes[activeIndex];
  const activeAsset = c.project.assets[activeIndex];
  const activeImage = useMediaUrl(activeAsset?.image);
  useEffect(() => { setSelected(0); setMeasured({}); }, [c.project.id]);
  useEffect(() => { if (c.project.storyboard && view === 'brief' && !c.busy && c.project.checkpoints.scene_plan?.status === 'awaiting_human') setView('board'); }, [c.project.storyboard, c.project.checkpoints.scene_plan?.status, c.busy, view]);
  useEffect(() => { if (!lightbox) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setLightbox(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [lightbox]);
  const onDuration = (index: number, value: number) => { const id = c.project.assets[index]?.narration?.artifactId; if (id && Number.isFinite(value)) setMeasured((current) => current[id] === value ? current : { ...current, [id]: value }); };
  const allMeasured = scenes.length > 0 && scenes.every((_, index) => measured[c.project.assets[index]?.narration?.artifactId || ''] !== undefined);
  const sceneDuration = (index: number) => measured[c.project.assets[index]?.narration?.artifactId || ''] ?? c.project.duration / Math.max(1, scenes.length);
  const startTime = (index: number) => scenes.slice(0, index).reduce((sum, _, i) => sum + sceneDuration(i), 0);
  const open = async (id: string, pipelineId?: string) => { await c.openProject(id, pipelineId); setStageView(null); setView(id ? 'board' : 'brief'); };
  const exportVideo = () => { if (!c.videoUrl) return; const anchor = document.createElement('a'); anchor.href = c.videoUrl; anchor.download = (c.project.storyboard?.title || 'OpenMontage').replace(/[<>:"/\\|?*]/g, '-') + '.mp4'; anchor.click(); };
  return <main className="backlot-app"><style>{backlotStyles}</style><div className="wrap">
    <header className="slate"><Clapperboard size={30} className="bl-brand-icon" aria-hidden="true" /><div><a className="bl-wordmark" href="#library" onClick={(event) => { event.preventDefault(); setView('library'); }}>OpenMontage / Backlot</a><h1>{view === 'library' ? '项目库' : view === 'pipelines' ? '选择制作流程' : projectTitle(c.project)}</h1></div>{view !== 'library' && <span className="chip">{pipelineNames[c.project.pipelineId] || c.project.pipelineId} · {scenes.length ? scenes.length + ' 场景' : '待规划'}</span>}<div className="spacer" /><span className={'live ' + (c.busy ? '' : 'idle')}><span className="dot" />{c.busy ? '制作中' : '就绪'}</span><button className="bl-button" onClick={() => setSettingsOpen(true)}><Settings2 size={16} />AI 设置</button>{view !== 'library' && <button className="bl-button" onClick={() => setView('library')}><ArrowLeft size={16} />项目库</button>}</header>
    {(c.error || c.saveError) && <div className="bl-error" role="alert">{c.error}{c.saveError && <p>项目未保存：{c.saveError}</p>}</div>}
    {view === 'pipelines' ? <PipelineChooser c={c} onChoose={(pipelineId) => void open('', pipelineId)} /> : view === 'library' ? <section aria-label="项目库"><div className="bl-library-intro"><div><h2>每个故事，都有自己的制作现场。</h2><p>打开剧本、审阅分镜，或者从新的材料开始。</p></div><button className="bl-primary" disabled={!c.loaded || !!c.busy} onClick={() => setView('pipelines')}><Plus size={17} />新建制作</button></div>{!c.loaded ? <p className="hint">正在从 Nimi 读取项目…</p> : c.library.length ? <div className="lib-grid">{c.library.map((entry) => <LibraryCard key={entry.id} summary={entry} disabled={!c.loaded || !!c.busy} onOpen={() => void open(entry.id)} />)}</div> : <div className="bl-empty"><Clapperboard size={48} /><h2>第一部作品，从一段材料开始。</h2><p>准备方案后，你会在这里看到剧本、分镜和成片。</p></div>}{c.busy && <div className="bl-run" role="status">{c.progress}<button onClick={() => setView('board')}>返回正在制作的项目<ArrowRight size={16} /></button></div>}</section> : <>
      <nav className="rail" aria-label="制作阶段">{stages.map((stage, index) => { const cp = c.project.checkpoints[stage.id]; const running = c.originalWorkflow ? c.workingStage === stage.id : ({ scene_plan: 'planning', assets: 'assets', compose: 'rendering' } as Record<string, string>)[stage.id] === c.busy; const cls = cp?.status === 'completed' ? 'done' : running ? 'active' : cp?.status === 'awaiting_human' ? 'await' : cp?.status === 'failed' ? 'failed' : ''; return <button key={stage.id} className={'stage ' + cls} onClick={() => { if (c.originalWorkflow) { setStageView(stage.id); setView('board'); } else setView(c.project.storyboard ? stage.view : 'brief'); }} aria-current={(c.originalWorkflow ? view !== 'brief' && view !== 'captions' && stage.id === viewedPipelineStage(c, view, stageView) : view === stage.view) ? 'step' : undefined}><span className="line" /><span className="node">{cp?.status === 'completed' ? <Check size={14} /> : index + 1}</span><span className="name">{stage.label}</span><span className="sub">{stageLabel(cp?.status, running, !!cp?.metadata?.scheduling_stopped_by_user)}</span></button>; })}</nav>
      <div className="bl-toolbar"><nav aria-label="项目区域">{([['board', '制作总览'], ['brief', '材料'], ['script', '剧本'], ['assets', '分镜与素材'], ['result', '成片'], ['captions', '字幕']] as const).map(([id, title]) => <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => { setStageView(null); setView(id); }} disabled={!c.originalWorkflow && !c.project.storyboard && !['brief', 'board'].includes(id)}>{title}</button>)}</nav><span aria-live="polite">{c.saveStatus}</span></div>
      {c.busy && <div className="bl-run" role="status"><span className="live"><span className="dot" />{c.progress}</span><button className="bl-button" onClick={() => void c.stop()}><Square size={13} />停止后续操作</button></div>}
      {view === 'captions' ? <SubtitleEditor c={c} /> : c.originalWorkflow && view !== 'brief' ? <OriginalPipelineBoard c={c} stageView={stageView} view={view} onSelectStage={setStageView} /> : view === 'brief' || !c.project.storyboard ? <Brief c={c} onPrepared={() => setView('board')} /> : <>
        {(view === 'board' || view === 'script') && <div className="board"><div className="main-col"><article className="script-card"><span className={'script-status ' + (c.project.checkpoints.scene_plan?.status === 'completed' && !c.needsConfirmation ? 'script-approved' : 'script-pending')}>{c.project.checkpoints.scene_plan?.status === 'completed' && !c.needsConfirmation ? '已确认' : '待确认'}</span><h2 className="sp-title">{c.project.storyboard.title}</h2><p className="sp-meta">剧本 · {duration(allMeasured ? startTime(scenes.length) : c.project.duration)} · {scenes.length} 场景 · {allMeasured ? '旁白实测' : '方案估计'}</p>{scenes.map((scene, index) => <section key={index}><h3 className="sp-slug">{String(index + 1).padStart(2, '0')} — {scene.title}<span className="tc">{duration(startTime(index))} – {duration(startTime(index) + sceneDuration(index))}</span></h3>{view === 'script' ? <><label className="bl-sr-only" htmlFor={'script-title-' + index}>场景 {index + 1} 标题</label><input id={'script-title-' + index} value={scene.title} maxLength={100} disabled={!!c.busy} onChange={(event) => c.editScene(index, 'title', event.target.value)} /><label className="bl-sr-only" htmlFor={'script-narration-' + index}>场景 {index + 1} 旁白</label><textarea id={'script-narration-' + index} rows={3} value={scene.narration} maxLength={1200} disabled={!!c.busy} onChange={(event) => c.editScene(index, 'narration', event.target.value)} /></> : <p className="sp-action">{scene.narration || '这段旁白还没有写好。'}</p>}</section>)}<div className="bl-script-actions"><button onClick={() => setView(view === 'script' ? 'board' : 'script')}>{view === 'script' ? '完成编辑，返回总览' : '阅读与修订剧本'}<ArrowRight size={14} /></button>{view === 'script' && <button disabled={!!c.busy || scenes.length >= 12} onClick={c.addScene}><Plus size={14} />添加场景</button>}</div></article><Approval c={c} /></div><aside><Decisions c={c} /><Activity c={c} /></aside></div>}
        {(view === 'board' || view === 'assets') && <section className="bl-storyboard" aria-label="分镜与素材审阅"><div className="section-title"><h2>分镜 / STORYBOARD</h2><span className="meta">{scenes.length} 个场景 · 点击画面审阅，逐段试听</span><button className="bl-button" disabled={!!c.busy || scenes.length >= 12} onClick={c.addScene}><Plus size={14} />添加场景</button></div><div className="filmstrip">{scenes.map((scene, index) => <article className="scene-card" key={index}><div className="sc-slate"><span className="num">SC {String(index + 1).padStart(2, '0')}</span><span className="dur">{duration(sceneDuration(index))}{!c.project.assets[index]?.narration ? ' 估计' : ''}</span></div><SceneMedia asset={c.project.assets[index]} index={index} selected={activeIndex === index} onSelect={() => { setSelected(index); setView('assets'); }} onDuration={onDuration} /><h3>{scene.title}</h3><p className="bl-scene-caption">{scene.narration}</p></article>)}</div>
          {view === 'assets' && activeScene && activeAsset && <section className="bl-scene-review panel" aria-label={'审阅场景 ' + (activeIndex + 1)}><div className="panel-head"><h2>场景 {activeIndex + 1} · {activeScene.title}</h2><div className="bl-actions"><button className="bl-button" aria-label="场景向前移动" disabled={!!c.busy || activeIndex === 0} onClick={() => { c.moveScene(activeIndex, -1); setSelected(activeIndex - 1); }}><ArrowUp size={16} /></button><button className="bl-button" aria-label="场景向后移动" disabled={!!c.busy || activeIndex === scenes.length - 1} onClick={() => { c.moveScene(activeIndex, 1); setSelected(activeIndex + 1); }}><ArrowDown size={16} /></button><button className="bl-button" disabled={!!c.busy || scenes.length <= 1} onClick={() => void c.removeScene(activeIndex)}><Trash2 size={15} />移除场景</button></div></div><div className="panel-body bl-review-grid"><div>{activeImage ? <button className="bl-large-image" onClick={() => setLightbox(true)} aria-label="放大查看配图"><img src={activeImage} alt={activeScene.title} /><Expand size={18} /></button> : <div className="bl-media-empty"><Film size={36} />等待生成配图</div>}<p className="bl-muted">配图与旁白单独重做；其他场景素材保留。</p><div className="bl-actions"><button className="bl-button" disabled={!!c.busy} onClick={() => void c.regenerate(activeIndex, 'image')}>重新生成配图</button><button className="bl-button" disabled={!!c.busy} onClick={() => void c.regenerate(activeIndex, 'narration')}>重新生成旁白</button></div></div><div><label htmlFor="scene-title">场景标题</label><input id="scene-title" value={activeScene.title} disabled={!!c.busy} maxLength={100} onChange={(event) => c.editScene(activeIndex, 'title', event.target.value)} /><label htmlFor="scene-narration">旁白</label><textarea id="scene-narration" value={activeScene.narration} rows={4} disabled={!!c.busy} maxLength={1200} onChange={(event) => c.editScene(activeIndex, 'narration', event.target.value)} /><label htmlFor="scene-image">画面描述</label><textarea id="scene-image" value={activeScene.imagePrompt} rows={4} disabled={!!c.busy} maxLength={3000} onChange={(event) => c.editScene(activeIndex, 'imagePrompt', event.target.value)} /><details className="bl-job-details"><summary>生成任务与来源</summary><p>配图 Job：{activeAsset.imageJobId || '尚未提交'}</p><p>旁白 Job：{activeAsset.narrationJobId || '尚未提交'}</p></details></div></div></section>}
          <Approval c={c} />
        </section>}
        {(view === 'board' || view === 'result') && <section className="bl-results" aria-label="成片与交付"><div className="section-title"><h2>成片 / RENDERS</h2><span className="meta">本地 Remotion 合成</span></div>{c.video && c.videoUrl ? <div className="bl-render"><video controls src={c.videoUrl} preload="metadata" aria-label="生成的解说短片" /><div className="bl-render-footer"><span>{c.video.width} × {c.video.height} · {duration(c.video.durationSeconds)}</span><button className="bl-primary" onClick={exportVideo}><Download size={16} />导出视频</button></div></div> : <div className="bl-empty"><Film size={36} /><h3>成片会出现在这里</h3><p>先逐场景检查画面与旁白，再确认素材并合成。</p><button className="bl-button" onClick={() => setView('assets')}>审阅分镜与素材<ArrowRight size={15} /></button></div>}{c.completeAssets && <div className="bl-render-action"><p>使用当前配图与旁白合成，不再次生成 AI 素材。</p><button className="bl-primary" disabled={!!c.busy || c.needsConfirmation || c.project.checkpoints.scene_plan?.status !== 'completed'} onClick={() => void c.render()}><Clapperboard size={16} />{c.project.checkpoints.compose?.status === 'failed' ? '重试合成' : c.project.checkpoints.assets?.status === 'completed' ? '重新合成' : '确认素材并合成'}</button></div>}</section>}
      </>}
    </>}
    <footer className="bl-footer"><span>OpenMontage · Backlot</span><span>AI 经 Nimi 执行 · 制作由你确认</span></footer>
  </div>{lightbox && activeImage && <dialog className="bl-lightbox" aria-label="配图预览" ref={(element) => { if (element && !element.open) element.showModal(); }} onCancel={() => setLightbox(false)} onClick={(event) => { if (event.target === event.currentTarget) setLightbox(false); }}><button autoFocus aria-label="关闭配图预览" onClick={() => setLightbox(false)}><X size={24} /></button><img src={activeImage} alt={activeScene?.title || '场景配图'} /></dialog>}<AIConfigPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onCommitted={c.configurationCommitted} /></main>;
}

function Approval({ c }: { c: Controller }) {
  const pending = !c.completeAssets || c.needsConfirmation;
  if (!pending) return <p className="bl-approval-note"><Check size={16} />素材已齐备，请试听并审阅后前往成片区域确认合成。</p>;
  return <div className="bl-approval"><div><h3>{c.needsConfirmation ? '这就是你准备制作的方案吗？' : '从上次停止的地方继续'}</h3><p>{c.modelSummary}</p><p className="bl-muted">确认后生成缺少的素材；保留已完成素材。费用按所选服务计量，当前没有可用报价。</p>{!c.voiceReady && <p className="bl-error">请先在材料页选择可用的旁白音色。</p>}</div><button className="bl-primary" disabled={!c.loaded || !!c.busy || !c.displayedConfig || !c.voiceReady} onClick={() => void c.generateAssets()}>{c.needsConfirmation ? '确认方案并生成素材' : '继续或重试素材'}<ArrowRight size={16} /></button></div>;
}

function PipelineChooser({ c, onChoose }: { c: Controller; onChoose: (id: string) => void }) {
  return <section className="bl-pipeline-catalog"><div className="bl-library-intro"><div><h2>选择这次制作的方式</h2><p>沿用 OpenMontage 的原有流程。各阶段、审批和工具要求来自随包的管线定义。</p></div></div>
    {c.pipelineError && <p className="bl-error">管线目录未加载：{c.pipelineError}</p>}
    {!c.pipelines.length && !c.pipelineError && <p className="bl-muted">正在读取原版管线…</p>}
    {c.pipelines.map((pipeline) => { const available = ['hybrid', 'nimi-image-explainer'].includes(pipeline.id); return <article className="bl-pipeline-row" key={pipeline.id}><div><h3>{pipelineNames[pipeline.id] || pipeline.id}</h3><p>{pipeline.description}</p><details><summary>{pipeline.stages.length} 个原版阶段 · 查看流程</summary><p>{pipeline.stages.map((stage) => (stageNames[stage.name] || stage.name) + (stage.gated ? '（需确认）' : '')).join(' → ')}</p></details></div><div><span className="chip">{pipeline.id === 'nimi-image-explainer' ? '已验证基础流程' : pipeline.id === 'hybrid' ? '基础路径集成中' : '工具尚未接入 App'}</span><button className="bl-button" disabled={!available || !c.loaded || !!c.busy} onClick={() => onChoose(pipeline.id)}>{available ? '使用此流程' : '迁移待办'}<ArrowRight size={15} /></button></div></article>; })}
  </section>;
}

const artifactNames: Record<string, string> = { brief: '创作方案', decision_log: '制作选择', proposal_packet: '制作提案', script: '剧本', scene_plan: '分镜方案', asset_manifest: '素材清单', edit_decisions: '剪辑方案', render_report: '渲染结果', final_review: '成片审阅', publish_log: '交付记录' };

function ReadArtifact({ name, value }: { name: string; value: Record<string, unknown> }) {
  const sections = Array.isArray(value.sections) ? value.sections as Record<string, unknown>[] : null;
  const points = Array.isArray(value.key_points) ? value.key_points as string[] : [];
  return <article className={name === 'script' || name === 'brief' ? 'script-card bl-workflow-document' : 'panel'}>
    <div className={name === 'script' || name === 'brief' ? 'sp-title' : 'panel-head'}><h3>{typeof value.title === 'string' ? value.title : artifactNames[name] || name}</h3></div>
    <div className={name === 'script' || name === 'brief' ? '' : 'panel-body'}>
      {typeof value.hook === 'string' && <p className="sp-action">{value.hook}</p>}
      {typeof (value.metadata as Record<string, unknown> | undefined)?.fallback_policy === "string" && <p className="sp-action">失败处理：{String((value.metadata as Record<string, unknown>).fallback_policy)}</p>}
      {points.length > 0 && <ul className="bl-artifact-points">{points.map((point, index) => <li key={index}>{point}</li>)}</ul>}
      {sections?.map((section, index) => <section key={String(section.id || index)}><h4 className="sp-slug">{index + 1} — {String(section.label || section.id)}<span className="tc">{duration(Number(section.start_seconds))} – {duration(Number(section.end_seconds))}</span></h4><p className="sp-action">{String(section.text || '')}</p></section>)}
      {name === 'scene_plan' && Array.isArray(value.scenes) && (value.scenes as Record<string, unknown>[]).map((scene, index) => <div className="bl-artifact-item" key={String(scene.id)}><h4>场景 {index + 1}</h4><p>{String(scene.description || '')}</p><p className="bl-muted">{duration(Number(scene.start_seconds))} – {duration(Number(scene.end_seconds))} · {(scene.required_assets as { type: string; source: string }[] || []).map((asset) => asset.type + ' / ' + asset.source).join(' · ')}</p></div>)}
      {name === 'decision_log' && Array.isArray(value.decisions) && (value.decisions as Record<string, unknown>[]).map((decision, index) => <div className="decision" key={index}><p className="d-cat">{String(decision.subject || decision.category || '')}</p><p className="d-pick">{String(decision.selected || '')}</p><p className="d-why">{String(decision.reason || '')}</p></div>)}
      {name === 'edit_decisions' && Array.isArray(value.cuts) && <ol className="bl-artifact-points">{(value.cuts as Record<string, unknown>[]).map((cut) => <li key={String(cut.id)}><strong>{String(cut.source)}</strong> · 源素材 {Number(cut.in_seconds).toFixed(1)}–{Number(cut.out_seconds).toFixed(1)} 秒 · {Number(cut.speed || 1)}×{cut.reason ? <p className="bl-muted">{String(cut.reason)}</p> : null}</li>)}</ol>}
      {name === 'final_review' && <p>{value.status === 'pass' ? '已确认成片符合当前方案。' : '技术合成已完成，请检查画面、声音和内容后确认。'}</p>}
      {name === 'publish_log' && Array.isArray(value.entries) && (value.entries as Record<string, unknown>[]).map((entry, index) => <p key={index}>{entry.status === 'exported' ? '已导出到 Nimi 项目' : '待确认导出'}{typeof entry.export_path === 'string' && <span className="bl-muted"> · {entry.export_path.split('/').at(-1)}</span>}</p>)}
      <details className="bl-job-details"><summary>查看完整产物</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
    </div>
  </article>;
}

function ArtifactEditor({ name, value, sources, onChange }: { name: string; value: Record<string, unknown>; sources?: SourceMedia[]; onChange: (value: Record<string, unknown>) => void }) {
  const update = (path: (string | number)[], replacement: unknown) => { const next = structuredClone(value); let cursor: any = next; for (const part of path.slice(0, -1)) cursor = cursor[part]; cursor[path.at(-1)!] = replacement; onChange(next); };
  if (name === 'brief') return <div className="panel-body"><label>片名<input value={String(value.title || '')} onChange={(e) => update(['title'], e.target.value)} /></label><label>开场与切入点<textarea value={String(value.hook || '')} onChange={(e) => update(['hook'], e.target.value)} /></label><label>主要内容<textarea rows={5} value={(value.key_points as string[] || []).join('\n')} onChange={(e) => update(['key_points'], e.target.value.split('\n').filter(Boolean))} /></label><label>失败时的处理<textarea value={String((value.metadata as Record<string, unknown> | undefined)?.fallback_policy || "")} onChange={(e) => onChange({ ...value, metadata: { ...value.metadata as Record<string, unknown>, fallback_policy: e.target.value } })} /></label>{Array.isArray(value.angle_options) && (value.angle_options as { name: string; description: string }[]).map((option) => <label className="bl-check" key={option.name}><input type="radio" name="angle" checked={value.selected_angle === option.name} onChange={() => update(['selected_angle'], option.name)} /><span><strong>{option.name}</strong><br />{option.description}</span></label>)}</div>;
  if (name === 'script') return <div className="panel-body">{(value.sections as Record<string, unknown>[] || []).map((section, index) => <div className="bl-artifact-item" key={String(section.id)}><label>段落 {index + 1} · 标题<input value={String(section.label || '')} onChange={(e) => update(['sections', index, 'label'], e.target.value)} /></label><label>文字与旁白<textarea rows={4} value={String(section.text || '')} onChange={(e) => update(['sections', index, 'text'], e.target.value)} /></label></div>)}</div>;
  if (name === 'scene_plan') return <div className="panel-body">{(value.scenes as Record<string, unknown>[] || []).map((scene, index) => <div className="bl-artifact-item" key={String(scene.id)}><label>场景 {index + 1} · 画面描述<textarea rows={3} value={String(scene.description || '')} onChange={(e) => update(['scenes', index, 'description'], e.target.value)} /></label><div className="bl-fields">{(["transition_in", "transition_out"] as const).map((key) => <label key={key}>{key === "transition_in" ? "入场方式" : "离场方式"}<input value={String(scene[key] || "cut")} onChange={(e) => update(["scenes", index, key], e.target.value)} /></label>)}</div>{(scene.required_assets as Record<string, unknown>[] || []).map((asset, assetIndex) => <label key={assetIndex}>{String(asset.type)} · 来源<select aria-label={"场景 " + (index + 1) + " " + String(asset.type) + " 来源"} value={String(asset.source_asset_id || (asset.source === "generate" ? "generate" : ""))} onChange={(e) => { const next = { ...asset, source: e.target.value === "generate" ? "generate" : "provided", source_asset_id: e.target.value === "generate" ? undefined : e.target.value }; update(["scenes", index, "required_assets", assetIndex], next); }}><option value="" disabled>选择实际素材</option><option value="generate">通过 Nimi 生成</option>{(asset.type === "narration" ? [] : sources || []).filter((source) => source.mimeType.startsWith(asset.type === "video" ? "video/" : asset.type === "image" ? "image/" : "audio/")).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>素材说明<textarea rows={2} value={String(asset.description || '')} onChange={(e) => update(['scenes', index, 'required_assets', assetIndex, 'description'], e.target.value)} /></label>)}</div>)}</div>;
  if (name === 'edit_decisions') return <div className="panel-body">{(value.cuts as Record<string, unknown>[] || []).map((cut, index) => <div className="bl-artifact-item" key={String(cut.id)}><h4>{String(cut.id)} · {String(cut.source)}</h4><div className="bl-fields">{(['in_seconds', 'out_seconds', 'speed'] as const).map((key) => <label key={key}>{({ in_seconds: '源素材入点（秒）', out_seconds: '源素材出点（秒）', speed: '播放速度' })[key]}<input type="number" min={key === 'speed' ? 0.1 : 0} step={0.1} value={Number(cut[key] ?? (key === 'speed' ? 1 : 0))} onChange={(e) => update(['cuts', index, key], Number(e.target.value))} /></label>)}</div></div>)}</div>;
  return <div className="panel-body"><p className="bl-muted">此产物由真实执行结果产生，请通过对应阶段重新执行。</p></div>;
}

function WorkflowClip({ asset, title }: { asset: SceneGeneration; title: string }) {
  const visual = asset.source || asset.video || asset.image; const url = useMediaUrl(visual); const audio = useMediaUrl(asset.narration);
  return <article className="scene-card"><div className="sc-slate"><span className="num">{title}</span></div>{url ? visual!.mimeType.startsWith('video/') ? <video controls preload="metadata" className="thumb" src={url} aria-label={title + '视频'} /> : <img className="thumb" src={url} alt={title} /> : <div className="thumb bl-media-empty"><Film size={24} />等待画面素材</div>}{audio && <audio controls src={audio} preload="metadata" aria-label={title + '旁白'} />}<details className="bl-job-details"><summary>任务与来源</summary><p>{asset.source?.name || asset.videoJobId || asset.imageJobId || '尚未提交'}</p><p>{asset.narrationJobId}</p></details></article>;
}

function WorkflowMusic({ state }: { state?: SceneGeneration }) {
  const media = state?.source || state?.music; const url = useMediaUrl(media);
  return url ? <section className="panel"><div className="panel-head"><h3>配乐</h3></div><div className="panel-body"><audio controls src={url} aria-label="制作配乐" /><p className="bl-muted">{state?.source?.name || 'Nimi 生成的配乐'}{media?.durationSeconds ? ' · ' + duration(media.durationSeconds) : ''}</p></div></section> : null;
}

function OriginalPipelineBoard({ c, view, stageView, onSelectStage }: { c: Controller; view: View; stageView: string | null; onSelectStage: (name: string | null) => void }) {
  const next = c.pipeline ? nextPipelineStage(c.project, c.pipeline) : undefined;
  const selected = viewedPipelineStage(c, view, stageView);
  const stage = c.pipeline?.stages.find((item) => item.name === selected);
  const saved = stage ? c.project.checkpoints[stage.name] : undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [reviewed, setReviewed] = useState([false, false, false]);
  useEffect(() => { setEditing(false); setDraft(structuredClone(saved?.artifacts || {}) as Record<string, Record<string, unknown>>); setReviewed([false, false, false]); }, [c.project.id, selected, saved?.timestamp]);
  if (!c.pipeline || !stage) return <p className="bl-error">{c.pipelineError || '正在读取当前管线。'}</p>;
  const ready = c.pipeline.stages.slice(0, c.pipeline.stages.indexOf(stage)).every((item) => c.project.checkpoints[item.name]?.status === 'completed');
  const awaiting = saved?.status === 'awaiting_human';
  const run = () => void c.runOriginalStage(stage.name).then(() => onSelectStage(null));
  const approve = () => void c.approveOriginalStage(stage.name).then(() => onSelectStage(null));
  const download = () => { if (!c.videoUrl) return; const anchor = document.createElement('a'); anchor.href = c.videoUrl; anchor.download = projectTitle(c.project).replace(/[<>:"/\\|?*]/g, '-') + '.mp4'; anchor.click(); };
  return <section className="bl-original-workflow"><div className="bl-workflow-heading"><div><h2>{stageNames[stage.name] || stage.name}</h2><p>{pipelineNames[c.pipeline.id]} · {stage.gated ? '原版流程要求确认后推进' : '原版流程的执行阶段'}</p></div><span className="chip">{stageLabel(saved?.status, c.workingStage === stage.name, !!saved?.metadata?.scheduling_stopped_by_user)}</span></div>
    <div className="board"><div className="main-col">
      {stage.name === 'assets' && <><div className="filmstrip">{c.project.assets.map((asset, index) => <WorkflowClip key={index} asset={asset} title={'场景 ' + (index + 1)} />)}</div><WorkflowMusic state={c.project.musicState} /></>}
      {(stage.name === 'compose' || stage.name === 'publish') && c.videoUrl && <div className="bl-render"><video controls src={c.videoUrl} aria-label="当前管线成片" /><div className="bl-render-footer"><span>{c.video?.width} × {c.video?.height} · {duration(c.video?.durationSeconds || 0)}</span><button className="bl-button" onClick={download}><Download size={16} />下载 MP4</button></div></div>}
      {Object.entries(saved?.artifacts || {}).map(([name, artifact]) => editing && ['brief', 'script', 'scene_plan', 'edit_decisions'].includes(name) ? <section className="panel" key={name}><div className="panel-head"><h3>{artifactNames[name]}</h3></div><ArtifactEditor name={name} sources={c.project.sources} value={draft[name] || artifact as Record<string, unknown>} onChange={(value) => setDraft((current) => ({ ...current, [name]: value }))} /></section> : <ReadArtifact key={name} name={name} value={artifact as Record<string, unknown>} />)}
      {!saved && <div className="bl-empty"><Clapperboard size={36} /><h3>准备{stageNames[stage.name] || stage.name}</h3><p>{ready ? '使用已确认的前置产物与当前 AI 配置准备本阶段。' : '请先完成前面的阶段。'}</p></div>}
      <div className="bl-approval"><div><h3>{editing ? '保存这次修订' : awaiting ? stage.name === 'compose' ? '检查成片后再交付' : '确认当前阶段' : saved?.status === 'completed' ? '这一阶段已完成' : '执行当前阶段'}</h3><p>{c.modelSummary}</p><p className="bl-muted">费用按配置的服务计量；未提供报价。未接入的工具会明确停止，不会伪造执行结果。</p>{stage.name === 'compose' && awaiting && ['画面已检查', '声音符合方案', '内容符合制作意图'].map((label, index) => <label className="bl-check" key={label}><input type="checkbox" checked={reviewed[index]} onChange={(e) => setReviewed((value) => value.map((old, i) => i === index ? e.target.checked : old))} />{label}</label>)}</div><div className="bl-actions">
        {editing ? <><button className="bl-primary" disabled={!!c.busy} onClick={() => void c.reviseOriginalArtifact(stage.name, draft).then(() => setEditing(false))}>保存修订</button><button className="bl-button" onClick={() => setEditing(false)}>取消编辑</button></> : <>
          {saved && Object.keys(saved.artifacts).length > 0 && ['idea', 'script', 'scene_plan', 'edit'].includes(stage.name) && <button className="bl-button" disabled={!!c.busy} onClick={() => setEditing(true)}>修订内容</button>}
          {awaiting ? <button className="bl-primary" disabled={!!c.busy || (stage.name === 'compose' && !reviewed.every(Boolean))} onClick={approve}>{stage.name === 'publish' ? '确认并导出到项目' : '确认本阶段'}<Check size={16} /></button> : <button className="bl-primary" disabled={!!c.busy || !ready} onClick={run}>{saved?.status === 'completed' ? '重新执行此阶段' : saved ? '继续或重试此阶段' : '开始本阶段'}<ArrowRight size={16} /></button>}
          {saved?.status === 'completed' && stage.name === 'scene_plan' && c.needsConfirmation && <button className="bl-primary" disabled={!!c.busy} onClick={approve}>重新确认分镜与配置</button>}
          {saved?.status === 'completed' && next && <button className="bl-button" onClick={() => onSelectStage(next.name)}>进入{stageNames[next.name] || next.name}<ArrowRight size={16} /></button>}
        </>}
      </div></div>
    </div><aside><Decisions c={c} /><Activity c={c} /><section className="panel"><div className="panel-head"><h3>当前接入范围</h3></div><div className="panel-body"><p className="bl-muted">已连接图像、视频、旁白、基础剪辑、文本转写和段落字幕。字级字幕对齐、复杂图层、额外渲染器及其他专用工具仍在迁移。</p></div></section></aside></div>
  </section>;
}
