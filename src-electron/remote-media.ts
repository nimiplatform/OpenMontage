import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';
import { MediaRenderer } from './media-runtime.js';
import type { AudioPreparationInput, MediaRenderInput } from './media-contract.js';

const MAX_BYTES = 128 * 1024 * 1024;
type BlobRecord = { owner: string; file: string; size: number; received: number; mimeType: string; touched: number; digest?: string; result?: boolean };
type MediaJob = { owner: string; state: 'running' | 'completed' | 'failed'; inputIds: string[]; result?: Record<string, unknown>; error?: string; work: Promise<void> };
const object = (properties: Record<string, unknown>, required: string[] = []) => JSON.stringify({ type: 'object', additionalProperties: false, properties, required });
const id = { type: 'string', minLength: 8, maxLength: 80, pattern: '^[a-zA-Z0-9-]+$' };
const result = JSON.stringify({ type: 'object', additionalProperties: true });
const descriptor = (name: string, displayName: string, effect: string, inputSchemaJson: string, description: string) => ({ name, displayName, effect, inputSchemaJson, description, outputSchemaJson: result, supportsCancel: false, retryPolicy: 'none' });

/** App media work only. No Runtime proxy, filesystem path, secret or native data identity crosses this boundary. */
export class RemoteMediaProvider {
  private closed = false;
  private blobs = new Map<string, BlobRecord>();
  private jobs = new Map<string, MediaJob>();
  private currentCall: Promise<unknown> | undefined;
  private closing: Promise<void> | undefined;
  error = '';
  constructor(private services: NimiElectronAppBusinessServices, private media: MediaRenderer, private root: string) { void this.run(); }
  private async run() {
    try {
      await this.services.integration.registerProvider({ integrationId: 'openmontage.media.v1', displayName: 'OpenMontage PC media studio',
        skill: 'Prepare and render OpenMontage media on this PC. Projects and approvals remain owned by the consuming App. Transfer bounded media objects, start one explicitly identified operation, then read its existing result. Never repeat an uncertain render or access another client’s media.',
        operations: [
          descriptor('inspect','Check PC media tools','read',object({}), 'Read Python, FFmpeg and Remotion readiness.'),
          descriptor('pipeline','Read production pipeline','read',object({ pipelineId: { type:'string',maxLength:128 }, stage:{type:'string',maxLength:128} }), 'Read the packaged OpenMontage pipeline and stage instructions.'),
          descriptor('checkpoint','Validate a production checkpoint','write',object({ input:{type:'object',additionalProperties:true} },['input']), 'Validate this App-owned workflow transition with the existing media worker. No project files are shared between client registrations.'),
          descriptor('subtitles','Format subtitle sidecars','read',object({ cues:{type:'array',maxItems:10000,items:{type:'object',additionalProperties:false,properties:{start:{type:'number'},end:{type:'number'},text:{type:'string',maxLength:4000}},required:['start','end','text']}} },['cues']), 'Produce SRT and VTT from actual reviewed cues.'),
          descriptor('upload','Stage source media','write',object({ action:{type:'string',enum:['begin','append','finish']},id,name:{type:'string',maxLength:250},mimeType:{type:'string',maxLength:128},size:{type:'integer',minimum:1,maximum:MAX_BYTES},offset:{type:'integer',minimum:0},data:{type:'string',maxLength:87384} },['action']), 'Stage up to 128 MiB in ordered 64 KiB chunks. IDs are private to the Runtime-verified client and expire with this Host.'),
          descriptor('render.start','Start a reviewed render','write',object({ renderId:id,scenes:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['visual'],properties:{visual:id,narration:id,durationSeconds:{type:'number',minimum:0},sourceInSeconds:{type:'number',minimum:0},visualAssetId:{type:'string',maxLength:128},narrationAssetId:{type:'string',maxLength:128}}}},music:id,editDecisions:{type:'object',additionalProperties:true},subtitles:{type:'object',additionalProperties:true} },['renderId','scenes']), 'Start one reviewed media render using this client’s staged inputs. Read the original renderId after a disconnect; never resubmit it.'),
          descriptor('audio.start','Prepare source audio','write',object({ operationId:id,source:id,startSeconds:{type:'number',minimum:0},endSeconds:{type:'number',minimum:0} },['operationId','source']), 'Extract real audio for transcription. No AI execution occurs in this operation.'),
          descriptor('operation.read','Read media operation','read',object({ id },['id']), 'Read the original operation and actual result reference. An unknown ID must not be treated as success or automatically replayed.'),
          descriptor('operation.stop','Stop media operation','write',object({ id },['id']), 'Cancel only this client’s known PC media operation.'),
          descriptor('operation.release','Release delivered media copies','write',object({ id },['id']), 'Remove only this client’s completed temporary operation after its result is safely saved in the App. Original App assets are not affected.'),
          descriptor('result.read','Read completed media','read',object({ id,offset:{type:'integer',minimum:0} },['id']), 'Read up to 128 KiB of this client’s completed media, with actual size and SHA-256.'),
        ],
      });
      while (!this.closed) {
        const poll = await this.services.integration.pollProvider({ waitMs: 25000 });
        for (const call of poll.calls) {
          if (this.closed) return;
          let resultJson = '{}', errorCode = '';
          try {
            this.currentCall = this.dispatch(call.consumerRef, call.operation, JSON.parse(call.inputJson));
            resultJson = JSON.stringify(await this.currentCall);
            if (Buffer.byteLength(resultJson) > 1024 * 1024) throw new Error('Media operation result exceeds 1 MiB.');
          } catch (cause) { errorCode = 'OPENMONTAGE_MEDIA_FAILED'; this.error = cause instanceof Error ? cause.message : String(cause); }
          finally { this.currentCall = undefined; }
          if (this.closed) return;
          try { await this.services.integration.completeProvider({ callId: call.callId, resultJson, errorCode }); }
          catch (cause) { this.error = String(cause); /* Delivery failure never repeats the media operation. */ }
        }
      }
    } catch (cause) { if (!this.closed) this.error = String(cause); }
  }
  private blob(owner: string, id: string, complete = true) {
    const record = this.blobs.get(id);
    if (!record || record.owner !== owner || (complete && record.received !== record.size)) throw new Error('This client has no complete media with that ID.');
    record.touched = Date.now(); return record;
  }
  private job(owner: string, id: string) {
    const record = this.jobs.get(id);
    if (!record || record.owner !== owner) throw new Error('This client has no media operation with that ID.');
    return record;
  }
  private async dispatch(owner: string, operation: string, input: Record<string, any>): Promise<unknown> {
    if (this.closed || !owner) throw new Error('The PC media scope ended.');
    if (operation === 'inspect') return this.media.inspect();
    if (operation === 'pipeline') return this.media.pipelineContext(input);
    if (operation === 'checkpoint') return this.media.checkpoint(input.input);
    if (operation === 'subtitles') return this.media.exportSubtitles(input as never);
    if (operation === 'upload') {
      if (input.action === 'begin') {
        for (const [key, value] of this.blobs) if (!value.result && Date.now() - value.touched > 30 * 60_000 && ![...this.jobs.values()].some(job => job.state === 'running')) { await rm(value.file,{force:true});this.blobs.delete(key); }
        if (this.blobs.size >= 64 || [...this.blobs.values()].reduce((sum,blob)=>sum+blob.size,0)+input.size > 512*1024*1024 || !['image/png','image/jpeg','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','audio/ogg','audio/flac'].includes(input.mimeType)
          || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_BYTES) throw new Error('Unsupported or excessive staged media.');
        const id = randomUUID(); await mkdir(this.root, { recursive:true });
        this.blobs.set(id,{owner,file:path.join(this.root,id),size:input.size,received:0,mimeType:input.mimeType,touched:Date.now()}); return {id};
      }
      const blob = this.blob(owner,input.id,false);
      if (input.action === 'append') {
        if (blob.digest || input.offset !== blob.received || typeof input.data !== 'string' || input.data.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new Error('Invalid media chunk.');
        const bytes = Buffer.from(input.data,'base64');
        if (!bytes.length || bytes.length > 65536 || blob.received + bytes.length > blob.size) throw new Error('Media chunk exceeds the declared size.');
        await appendFile(blob.file,bytes);blob.received += bytes.length;return {received:blob.received};
      }
      if (input.action !== 'finish' || blob.received !== blob.size) throw new Error('The media upload is incomplete.');
      blob.digest = 'sha256:'+createHash('sha256').update(await readFile(blob.file)).digest('hex');return {id:input.id};
    }
    if (operation === 'operation.read') {
      const job=this.jobs.get(input.id);
      // Missing and another caller's objects have the same non-disclosing result.
      if (!job || job.owner !== owner) return {state:'unknown'};
      return {state:job.state,result:job.result,error:job.error};
    }
    if (operation === 'operation.stop') { this.job(owner,input.id);await this.media.cancel(input.id);return {requested:true}; }
    if (operation === 'operation.release') {
      const job = this.job(owner,input.id);
      if (job.state === 'running') throw new Error('A running operation cannot be released.');
      const ids = new Set([...job.inputIds, ...(typeof job.result?.blobId === 'string' ? [job.result.blobId] : [])]);
      for (const id of ids) {
        const blob = this.blobs.get(id);
        if (blob?.owner === owner) { await rm(blob.file,{force:true});this.blobs.delete(id); }
      }
      this.jobs.delete(input.id);return {released:true};
    }
    if (operation === 'result.read') {
      const blob=this.blob(owner,input.id);if (!blob.digest || !Number.isSafeInteger(input.offset)||input.offset<0||input.offset>=blob.size) throw new Error('Invalid result range.');
      const { open } = await import('node:fs/promises');const file=await open(blob.file,'r');
      try { const size=Math.min(131072,blob.size-input.offset),bytes=Buffer.alloc(size);const read=await file.read(bytes,0,size,input.offset);if(read.bytesRead!==size)throw new Error('Incomplete media result.');return {data:bytes.toString('base64'),offset:input.offset,nextOffset:input.offset+size,size:blob.size,digest:blob.digest,mimeType:blob.mimeType}; }
      finally { await file.close(); }
    }
    if (!['render.start','audio.start'].includes(operation)) throw new Error('Unknown OpenMontage media operation.');
    const id = operation === 'render.start' ? input.renderId : input.operationId;
    if (this.jobs.has(id)) throw new Error('This operation ID already exists; read its original result.');
    if (this.jobs.size >= 32 || [...this.jobs.values()].some(job=>job.state==='running')) throw new Error('Wait for the current media operation to finish.');
    // Bind each opaque input to the real caller before dispatching the worker.
    const read = async (id: string) => {const blob=this.blob(owner,id);if(!blob.digest)throw new Error('Finish the upload first.');return {bytes:new Uint8Array(await readFile(blob.file)),mimeType:blob.mimeType};};
    let work: () => Promise<{bytes:Uint8Array;mimeType:string;[key:string]:unknown}>;
    if (operation === 'render.start') {
      const ids = input.scenes.flatMap((scene: Record<string, string>)=>[scene.visual,...(scene.narration?[scene.narration]:[])]).concat(input.music?[input.music]:[]);
      if (ids.reduce((sum:number,key:string)=>sum+this.blob(owner,key).size,0)>64*1024*1024) throw new Error('The current render input exceeds 64 MiB.');
      const scenes: MediaRenderInput['scenes'][number][]=[];
      for(const scene of input.scenes) {const visual=await read(scene.visual),audio=scene.narration?await read(scene.narration):undefined;scenes.push({...scene,visual:visual.bytes,visualMimeType:visual.mimeType,narration:audio?.bytes,narrationMimeType:audio?.mimeType});}
      const music=input.music?await read(input.music):undefined;
      work=async()=>({...await this.media.render({renderId:input.renderId,scenes,music,editDecisions:input.editDecisions,subtitles:input.subtitles})});
    } else {const source=await read(input.source);work=async()=>({...await this.media.prepareAudio({...input,bytes:source.bytes,mimeType:source.mimeType} as AudioPreparationInput)});}
    const inputIds: string[] = operation === 'render.start' ? input.scenes.flatMap((scene: Record<string,string>)=>[scene.visual,...(scene.narration?[scene.narration]:[])]).concat(input.music?[input.music]:[]) : [input.source];
    const job:MediaJob={owner,state:'running',inputIds,work:Promise.resolve()};this.jobs.set(id,job);
    job.work=(async()=>{try{const result=await work();if(this.closed)return;const blobId=randomUUID();await mkdir(this.root,{recursive:true});const file=path.join(this.root,blobId);await writeFile(file,result.bytes);const digest='sha256:'+createHash('sha256').update(result.bytes).digest('hex');this.blobs.set(blobId,{owner,file,size:result.bytes.byteLength,received:result.bytes.byteLength,mimeType:result.mimeType,touched:Date.now(),digest,result:true});const {bytes,...metadata}=result;job.result={...metadata,blobId};job.state='completed';}catch(cause){job.state='failed';job.error=cause instanceof Error?cause.message:String(cause);}})();
    return {id};
  }
  close(): Promise<void> {
    return this.closing ??= (async()=>{this.closed=true;await this.currentCall?.catch(()=>undefined);await this.media.dispose();await Promise.all([...this.jobs.values()].map(job=>job.work));
      // This directory is a unique Host-owned temporary child, never a project or asset root.
      if (!path.basename(this.root).startsWith('openmontage-remote-')) throw new Error('Unexpected remote media cleanup directory.');
      await rm(this.root,{recursive:true,force:true});this.blobs.clear();this.jobs.clear();})();
  }
}
