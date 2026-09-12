import { useEffect, useRef, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import type { useProductionController } from './use-production.js';
import { projectTitle } from './project-store.js';
import type { SubtitleDraft } from './subtitles.js';

export function SubtitleEditor({ c }: { c: ReturnType<typeof useProductionController> }) {
  const draft = c.project.subtitleDraft;
  const [exporting, setExporting] = useState(false); const [error, setError] = useState('');
  const [previewDraft, setPreviewDraft] = useState(true);
  const [replaceRequested, setReplaceRequested] = useState(false);
  const burned = !!c.project.output?.subtitlesApplied;
  const video = useRef<HTMLVideoElement>(null); const track = useRef<TextTrack | null>(null); const attachedVideo = useRef<HTMLVideoElement | null>(null);
  const cues = draft?.cues;
  useEffect(() => {
    if (!video.current) return;
    if (!track.current || attachedVideo.current !== video.current) { track.current = video.current.addTextTrack('subtitles', '字幕预览'); attachedVideo.current = video.current; }
    const textTrack = track.current;
    for (const cue of [...(textTrack.cues || [])]) textTrack.removeCue(cue);
    for (const cue of cues || []) if (Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start) textTrack.addCue(new VTTCue(cue.start, cue.end, cue.text));
    textTrack.mode = previewDraft && !burned ? 'showing' : 'disabled';
    return () => { textTrack.mode = 'disabled'; };
  }, [cues, c.videoUrl, burned, previewDraft]);
  const disabled = !!c.busy || exporting;
  const update = (next: SubtitleDraft) => c.updateProject({ subtitleDraft: next });
  const add = () => { const current = draft || { cues: [], origin: 'manual' as const, fontSize: 36, position: 'bottom-center' as const }; const start = current.cues.at(-1)?.end || 0; update({ ...current, cues: [...current.cues, { start, end: start + 2, text: '' }] }); };
  const download = async (format: 'srt' | 'vtt') => {
    setExporting(true); setError('');
    try {
      const files = await c.exportSubtitleDraft(); const url = URL.createObjectURL(new Blob([files[format]], { type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = projectTitle(c.project).replace(/[<>:"/\\|?*]/g, '-') + '.' + format; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setExporting(false); }
  };
  return <section className="bl-subtitle-editor"><div className="bl-workflow-heading"><div><h2>字幕</h2><p>依据实际旁白时间创建段落字幕，逐条校对文字与起止时间。</p></div><span className="chip">{cues?.length || 0} 条</span></div>
    {error && <p role="alert" className="bl-error">{error}</p>}
    <div className="bl-actions"><button className="bl-button" disabled={disabled || replaceRequested || !c.project.assets.some((asset) => asset.narration)} onClick={() => { if (draft) setReplaceRequested(true); else void c.createNarrationSubtitles(); }}>{draft ? '重新从旁白生成（替换当前字幕）' : '从旁白创建字幕'}</button><button className="bl-button" disabled={disabled} onClick={add}><Plus size={15} />添加字幕</button><button className="bl-button" disabled={disabled || !cues?.length} onClick={() => void download('srt')}><Download size={15} />导出 SRT</button><button className="bl-button" disabled={disabled || !cues?.length} onClick={() => void download('vtt')}>导出 VTT</button></div>
    {replaceRequested && <div className="bl-approval" role="group" aria-label="确认替换字幕"><div><h3>替换当前字幕草稿？</h3><p>当前文字、起止时间和样式会被旁白生成的字幕替换。已合成的视频不受影响。</p></div><div className="bl-actions"><button className="bl-button" disabled={disabled} onClick={() => setReplaceRequested(false)}>保留当前字幕</button><button className="bl-primary" disabled={disabled} onClick={() => { setReplaceRequested(false); void c.createNarrationSubtitles(); }}>确认替换字幕</button></div></div>}
    {c.videoUrl && <div className="bl-render bl-subtitle-preview"><video ref={video} controls src={c.videoUrl} aria-label="字幕时间预览" />{burned ? <p className="bl-muted">正在播放已烧录字幕的成片。草稿修改后，重新合成以查看效果。</p> : <label className="bl-check"><input type="checkbox" checked={previewDraft} onChange={(e) => setPreviewDraft(e.target.checked)} />预览草稿字幕时间；烧录样式以成片为准。</label>}</div>}
    {!cues?.length && <div className="bl-empty"><h3>先准备字幕文字与时间</h3><p>已有旁白可直接创建段落字幕，也可以手动添加；这里不会根据全文长度猜测字级时间戳。</p></div>}
    {draft && <><div className="bl-fields"><label>位置<select value={draft.position} disabled={disabled} onChange={(e) => update({ ...draft, position: e.target.value as SubtitleDraft['position'] })}><option value="bottom-center">底部居中</option><option value="top-center">顶部居中</option><option value="center">画面中央</option></select></label><label>合成字号<input type="number" min={12} max={96} value={draft.fontSize} disabled={disabled} onChange={(e) => update({ ...draft, fontSize: Number(e.target.value) })} /></label></div>
      <div className="bl-caption-list">{draft.cues.map((cue, index) => <div className="bl-caption-row" key={index}><span className="meta">{index + 1}</span><label>开始<input aria-label={'字幕 ' + (index + 1) + ' 开始'} type="number" min={0} step={0.01} value={cue.start} disabled={disabled} onChange={(e) => update({ ...draft, cues: draft.cues.map((value, i) => i === index ? { ...value, start: Number(e.target.value) } : value) })} /></label><label>结束<input aria-label={'字幕 ' + (index + 1) + ' 结束'} type="number" min={0} step={0.01} value={cue.end} disabled={disabled} onChange={(e) => update({ ...draft, cues: draft.cues.map((value, i) => i === index ? { ...value, end: Number(e.target.value) } : value) })} /></label><label>文字<textarea rows={2} aria-label={'字幕 ' + (index + 1) + ' 文字'} value={cue.text} disabled={disabled} onChange={(e) => update({ ...draft, cues: draft.cues.map((value, i) => i === index ? { ...value, text: e.target.value } : value) })} /></label><button className="bl-button" aria-label={'删除字幕 ' + (index + 1)} disabled={disabled} onClick={() => update({ ...draft, cues: draft.cues.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>)}</div>
      <div className="bl-approval"><div><h3>将字幕加入成片</h3><p>保存 SRT/VTT，并用当前素材重新合成；完成后检查字幕与画面。</p></div><div className="bl-actions"><button className="bl-primary" disabled={disabled || !draft.cues.length || c.project.checkpoints.assets?.status !== 'completed'} onClick={() => void c.applySubtitles()}>应用字幕并合成</button>{c.project.subtitleTrack && <button className="bl-button" disabled={disabled} onClick={() => { setPreviewDraft(false); void c.applySubtitles(true); }}>移除字幕并合成</button>}</div></div>
    </>}
  </section>;
}
