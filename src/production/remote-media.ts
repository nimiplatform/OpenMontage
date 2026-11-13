import type { NimiAppScope } from '@nimiplatform/kit/core/app-session';
import type { OpenMontageMedia, MediaRenderResult, PreparedAudio } from '../../src-electron/media-contract.js';
import { MediaOperationStateError } from './render-recovery.js';

function within<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    if(signal.aborted){void promise.catch(()=>undefined);reject(signal.reason);return;}
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
const pause=(signal:AbortSignal)=>within(new Promise<void>(resolve=>setTimeout(resolve,150)),signal);
function encode(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}

/** PC media service for one captured public App scope. Reconnect never repeats a write. */
export function createRemoteMedia(scope:NimiAppScope):OpenMontageMedia{
  const api=scope.client.integration;
  const renders = new Map<string, { control: AbortController; targetRef?: string; submitted: boolean }>();
  async function targetFor(operation: string, signal: AbortSignal, pinned?: string) {
    const rows = (await within(api.listCatalog(), signal)).filter(row => row.integrationId === 'openmontage.media.v1' && row.available);
    const allowed = rows.filter(row => row.permittedOperations.includes(operation) && (!pinned || row.targetRef === pinned));
    if (!allowed.length) throw new Error(pinned ? '原 PC 媒体服务暂不可用或许可已变化。请恢复该服务后再读取原结果。' : `请在 PC 打开 OpenMontage，并在 Home → 集成中允许此来源使用 ${operation}。`);
    if (allowed.length !== 1) throw new Error('请在 Home 中仅保留要使用的一个 OpenMontage 媒体服务许可。');
    return allowed[0]!.targetRef;
  }
  async function call<T>(operation: string, input: unknown, pinned?: string, userSignal?: AbortSignal): Promise<T> {
    const signal = AbortSignal.any([scope.signal, ...(userSignal ? [userSignal] : []), AbortSignal.timeout(60_000)]);
    signal.throwIfAborted();
    const targetRef = await targetFor(operation, signal, pinned);
    signal.throwIfAborted();
    let result = await within(api.invoke({ targetRef, operation, inputJson: JSON.stringify(input) }), signal);
    while (result.status === 'accepted') { await pause(signal); result = await within(api.getCall({ callId: result.callId }), signal); }
    if (result.status !== 'completed') throw new Error(`PC 媒体操作未完成（${result.errorCode || result.status}），请查看 PC App 或检查当前操作。不会自动重新提交。`);
    return JSON.parse(result.resultJson) as T;
  }
  async function upload(bytes:Uint8Array,mimeType:string,targetRef:string,signal?:AbortSignal){
    if(!bytes.byteLength||bytes.byteLength>128*1024*1024)throw new Error('媒体必须在 128 MiB 以内。');
    const {id}=await call<{id:string}>('upload',{action:'begin',size:bytes.byteLength,mimeType},targetRef,signal);
    for(let offset=0;offset<bytes.length;offset+=65536)await call('upload',{action:'append',id,offset,data:encode(bytes.subarray(offset,offset+65536))},targetRef,signal);
    await call('upload',{action:'finish',id},targetRef,signal);return id;
  }
  async function read(id:string,targetRef:string,signal?:AbortSignal){
    let offset=0,size=0,digest='',mimeType='';const chunks:Uint8Array[]=[];
    do{
      const part=await call<{offset:number;nextOffset:number;size:number;digest:string;mimeType:string;data:string}>('result.read',{id,offset},targetRef,signal);
      if(!offset){size=part.size;digest=part.digest;mimeType=part.mimeType;}
      if(!Number.isSafeInteger(size)||size<1||size>128*1024*1024||part.offset!==offset||part.size!==size||part.digest!==digest||part.mimeType!==mimeType)throw new Error('PC 返回的媒体范围不一致。');
      const bytes=Uint8Array.from(atob(part.data),c=>c.charCodeAt(0));
      if(!bytes.length||bytes.length>131072||part.nextOffset!==offset+bytes.length||part.nextOffset>size)throw new Error('媒体未完整传输。');
      chunks.push(bytes);offset=part.nextOffset;
    }while(offset<size);
    const bytes=new Uint8Array(size);offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const actual='sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
    scope.signal.throwIfAborted();if(actual!==digest)throw new Error('媒体完整性校验失败，未返回部分文件。');return {bytes,mimeType};
  }
  async function completed(id:string,targetRef:string,signal=scope.signal): Promise<Record<string, unknown> & {bytes:Uint8Array;mimeType:string}>{
    try{
      while(true){
        const job=await call<{state:string;result?:Record<string,unknown>&{blobId:string};error?:string}>('operation.read',{id},targetRef,signal);
        if(job.state==='completed'&&job.result){const {blobId,...metadata}=job.result;return {...metadata,...await read(blobId,targetRef,signal)};}
        if(job.state==='failed'||job.state==='unknown')throw new MediaOperationStateError(job.state,job.error||'此 PC 服务没有可确认的原合成记录。请检查 PC 是否重启，不会自动重做。');
        if(job.state!=='running')throw new Error('PC 返回了无效的媒体操作状态。');
        await pause(signal);
      }
    }catch(cause){if(cause instanceof MediaOperationStateError)throw cause;if(signal.aborted)throw new MediaOperationStateError('unconfirmed',scope.signal.aborted?'连接中断，PC 合成结果尚未确认。请重连后读取原合成结果。':'已停止等待结果。请读取原合成，确认 PC 的实际停止状态。');throw new Error(`PC 媒体操作 ${id} 未确认完成，不能自动重做。${String(cause)}`);}
  }
  async function renderResult(id: string, targetRef: string, signal?: AbortSignal): Promise<MediaRenderResult> {
    const result = await completed(id, targetRef, signal);
    if (result.mimeType !== 'video/mp4' || result.width !== 1280 || result.height !== 720 || typeof result.durationSeconds !== 'number' || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0)
      throw new Error('PC 返回的成片元数据无效。');
    return {bytes:result.bytes,mimeType:'video/mp4',width:1280,height:720,durationSeconds:result.durationSeconds,hasAudio:result.hasAudio===true};
  }
  return {
    releaseRender: async (id,targetRef) => {await call('operation.release',{id},targetRef);},
    inspect: () => call('inspect', {}),
    pipelineContext: input => call('pipeline', input),
    checkpoint: input => call('checkpoint', { input }),
    exportSubtitles: input => call('subtitles', input),
    async readRenderResult(id, targetRef) {
      const active = {control:new AbortController(),targetRef,submitted:true}; renders.set(id,active);
      try {return await renderResult(id,targetRef,AbortSignal.any([scope.signal,active.control.signal]));}
      finally {renders.delete(id);}
    },
    cancel: async (id, pinned) => {
      const active = renders.get(id);
      if (active) {
        active.control.abort(new DOMException('用户停止了媒体传送。', 'AbortError'));
        if (!active.submitted) return;
      }
      await call('operation.stop', { id }, active?.targetRef || pinned);
    },
    async render(input, beforeSubmit, onSubmitted) {
      const total = input.scenes.reduce((sum, scene) => sum + scene.visual.byteLength + (scene.narration?.byteLength || 0), input.music?.bytes.byteLength || 0);
      if (total > 64 * 1024 * 1024) throw new Error('当前合成输入总计不能超过 64 MiB。');
      const active = { control: new AbortController(), targetRef: undefined as string | undefined, submitted: false };
      const signal = AbortSignal.any([scope.signal, active.control.signal]);
      renders.set(input.renderId, active);
      try {
        const targetRef = await targetFor('render.start', signal); active.targetRef = targetRef;
        const scenes = [];
        for (const scene of input.scenes) scenes.push({ ...scene,
          visual: await upload(scene.visual, scene.visualMimeType, targetRef, signal),
          narration: scene.narration ? await upload(scene.narration, scene.narrationMimeType!, targetRef, signal) : undefined,
          visualMimeType: undefined, narrationMimeType: undefined });
        const music = input.music ? await upload(input.music.bytes, input.music.mimeType, targetRef, signal) : undefined;
        signal.throwIfAborted();
        await beforeSubmit?.(targetRef);
        signal.throwIfAborted();
        active.submitted = true;
        const started = await call<{id:string}>('render.start', { ...input, scenes, music }, targetRef, signal);
        if (started.id !== input.renderId) throw new Error('PC 返回的合成编号不一致。');
        onSubmitted?.();
        return await renderResult(input.renderId, targetRef, signal);
      } finally { renders.delete(input.renderId); }
    },
    async prepareAudio(input) {
      const active = {control:new AbortController(),targetRef:undefined as string|undefined,submitted:false};
      const signal = AbortSignal.any([scope.signal,active.control.signal]); renders.set(input.operationId,active);
      try {
        const targetRef = await targetFor('audio.start',signal); active.targetRef=targetRef;
        const source = await upload(input.bytes,input.mimeType,targetRef,signal);
        signal.throwIfAborted(); active.submitted=true;
        await call('audio.start',{operationId:input.operationId,source,startSeconds:input.startSeconds,endSeconds:input.endSeconds},targetRef,signal);
        const result=await completed(input.operationId,targetRef,signal);
        if(result.mimeType!=='audio/wav'||typeof result.durationSeconds!=='number'||!Number.isFinite(result.durationSeconds)||result.durationSeconds<=0
          ||typeof result.sourceOffsetSeconds!=='number'||!Number.isFinite(result.sourceOffsetSeconds)||result.sourceOffsetSeconds<0)throw new Error('PC 返回的音频元数据无效。');
        return {bytes:result.bytes,mimeType:'audio/wav',durationSeconds:result.durationSeconds,sourceOffsetSeconds:result.sourceOffsetSeconds};
      } finally {renders.delete(input.operationId);}

    },
  };
}
