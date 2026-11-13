import { useState } from 'react';
import {useMontagePlatform} from './platform.js';
import type { SourceMedia } from './generation.js';
import type { useProductionController } from './use-production.js';

export function SourceTranscriptionCard({ source, c }: { source: SourceMedia; c: ReturnType<typeof useProductionController> }) {
  const platform=useMontagePlatform();
  const [deliveryError,setDeliveryError]=useState('');
  const result = source.transcription; const request = source.transcriptionRequest;
  const saved = request || result;
  const [start, setStart] = useState(saved?.startSeconds || 0);
  const [end, setEnd] = useState(saved?.endSeconds || source.durationSeconds || 0);
  const [language, setLanguage] = useState(saved?.language || '');
  const sameRange = saved && start === saved.startSeconds && end === saved.endSeconds && language === saved.language;
  const selection = c.displayedConfig?.effectiveSelections.find((item) => item.capabilityContract === 'audio.transcribe');
  const model = selection?.resource?.oneofKind === 'cloud' ? selection.resource.cloud.target.label + ' / ' + selection.resource.cloud.connector.label : selection?.resource?.oneofKind === 'local' ? selection.resource.local.label : '未配置';
  const downloadText = async () => {
    if(result?.text===undefined)return;
    setDeliveryError('');
    try {await platform.deliverFile(new Blob([result.text],{type:'text/plain;charset=utf-8'}),source.name.replace(/\.[^.]+$/,'')+'.txt');}
    catch(cause){setDeliveryError(cause instanceof Error?cause.message:String(cause));}
  };
  return <section className="bl-source-transcript bl-artifact-item" aria-label={source.name + ' 转写'}>
    <h4>{source.name}</h4>{deliveryError&&<p role="alert" className="bl-error">{deliveryError}</p>}<p className="bl-muted">{source.durationSeconds?.toFixed(2)} 秒 · 新转写使用：{model}</p>
    <div className="bl-fields"><label>开始（秒）<input type="number" min={0} step={0.01} value={start} disabled={c.locked} onChange={(e) => setStart(Number(e.target.value))} /></label><label>结束（秒）<input type="number" min={0} step={0.01} value={end} disabled={c.locked} onChange={(e) => setEnd(Number(e.target.value))} /></label><label>语言<input value={language} disabled={c.locked} placeholder="留空自动识别" onChange={(e) => setLanguage(e.target.value)} /></label></div>
    <p className="bl-muted">当前入口提供文本转写。自动字级时间对齐尚未接入；段落字幕可在字幕页创建和校对。</p>
    <div className="bl-actions"><button className="bl-button" disabled={c.locked || selection?.state !== 'ready'} onClick={() => void c.transcribeSourceFile(source.id, { startSeconds: start, endSeconds: end, language, timestamps: false })}>{saved?.jobId && sameRange ? '读取或继续原转写任务' : saved ? '转写此范围（新任务）' : '转写此范围'}</button>{result && !request && sameRange && <button className="bl-button" disabled={c.locked || selection?.state !== 'ready'} onClick={() => void c.transcribeSourceFile(source.id, { startSeconds: start, endSeconds: end, language, timestamps: false }, true)}>重新转写（新任务）</button>}{selection?.state !== 'ready' && <span className="bl-muted">请在 AI 设置中选择转写能力。</span>}</div>
    {saved?.pendingSubmission && <p className="bl-error">提交结果待核对，已暂停重复提交。</p>}
    {request && result && <button className="bl-button" disabled={c.locked || !!request.pendingSubmission} onClick={() => void c.keepSavedTranscription(source.id)}>保留已保存的转写</button>}
    {request?.error && <p className="bl-error">本次转写未完成：{request.error}。已保存的文字保留。</p>}
    {result?.text !== undefined && <><label>{request ? '已保存的转写（上一次结果）' : '转写文字'}{result.edited ? ' · 已修订' : ''}<textarea rows={5} value={result.text} disabled={c.locked} onChange={(e) => c.editTranscription(source.id, e.target.value)} /></label><p className="bl-muted">用于后续方案的源材料；已确认剧本不会被自动重写。转写不会按字数虚构字幕时间。</p></>}
    {result?.text !== undefined && <div className="bl-actions"><button className="bl-button" onClick={downloadText}>下载转写文本</button>{result.edited && result.originalText !== undefined && <button className="bl-button" disabled={c.locked} onClick={() => c.editTranscription(source.id, result.originalText!)}>还原识别文本</button>}</div>}
    {saved?.jobId && <details className="bl-job-details"><summary>任务与来源</summary><p>Nimi Job：{saved.jobId}</p><p>源素材范围：{saved.startSeconds}–{saved.endSeconds} 秒</p></details>}
  </section>;
}
