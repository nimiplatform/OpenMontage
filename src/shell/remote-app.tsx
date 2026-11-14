import { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiAppSessionProvider, NimiAppAccessGate, NimiAccountControl, useNimiAppSession, type NimiAppSession, type NimiAppScope } from '@nimiplatform/kit/auth/app';
import { NimiThemeProvider, TooltipProvider, NimiToaster, Popover, PopoverContent, PopoverTrigger, Button } from '@nimiplatform/kit/ui';
import { BacklotWorkspace } from '../production/backlot-workspace.js';
import { MontagePlatformProvider, downloadFile } from '../production/platform.js';
import { createRemoteMedia } from '../production/remote-media.js';
import '../styles.css';
import './remote.css';

function AccountMenu(){
  const {snapshot}=useNimiAppSession();
  if(snapshot.identity.status!=='signed-in')return null;
  return <Popover><PopoverTrigger asChild><Button size="sm" tone="secondary" aria-label="账号与连接">{snapshot.identity.user?.displayName||'Nimi 账号'}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-4"><div className="montage-account-controls"><NimiAccountControl language="zh" /></div></PopoverContent></Popover>;
}
function Workspace({kind}:{kind:'web'|'android'}){
  const {session,snapshot}=useNimiAppSession();
  const [deliveryStatus,setDeliveryStatus]=useState('');
  const retained=useRef<NimiAppScope|undefined>(undefined);
  if(snapshot.runtime.status==='connected')retained.current=snapshot.runtime.scope;
  const scope=retained.current,connected=snapshot.runtime.status==='connected';
  const media=useMemo(()=>scope?createRemoteMedia(scope):undefined,[scope]);
  const platform=useMemo(()=>scope&&media?{kind,connected,client:scope.client,media,deliverFile:async(blob:Blob,name:string)=>{
    scope.signal.throwIfAborted();
    if(kind==='android'){
      setDeliveryStatus('正在准备保存到设备的文件…');
      try {
        const {deliverAndroidMedia}=await import('./android-media.js');
        await deliverAndroidMedia(blob,name,scope.signal);
        setDeliveryStatus('文件已保存到所选位置。');
      } catch(cause) {setDeliveryStatus('');throw cause;}
    }
    else await downloadFile(blob,name);
  }}:undefined,[scope,media,kind,connected]);
  return <>
    {deliveryStatus&&<p className="montage-workspace-note" role="status">{deliveryStatus}</p>}
    {!connected&&<section className="montage-connect">{!scope?<NimiAppAccessGate title="OpenMontage" language="zh" externalAccountControl>{()=>null}</NimiAppAccessGate>:<>
      <p>{snapshot.runtime.status==='connecting'?'正在连接 PC…':'PC 已断开。当前项目保留；连接恢复不会重新执行 AI 或制作任务。'}</p>
      <button onClick={()=>snapshot.runtime.status==='connecting'?session.disconnectRuntime():void session.connectRuntime()}>{snapshot.runtime.status==='connecting'?'取消连接':'连接 PC'}</button>
      {snapshot.issue&&<p>{snapshot.issue.message}</p>}
    </>}</section>}
    {platform&&<MontagePlatformProvider platform={platform}><div inert={!connected}><BacklotWorkspace /></div></MontagePlatformProvider>}
  </>;
}
export function mountRemoteMontage(session:NimiAppSession,kind:'web'|'android'){
  document.body.classList.add('montage-remote');
  const root=createRoot(document.getElementById('root')!);
  root.render(<StrictMode><NimiThemeProvider accentPack="nimi-accent"><TooltipProvider><NimiAppSessionProvider session={session}>
    <header className="montage-account-header"><strong>OpenMontage</strong><AccountMenu /></header>
    <p className="montage-workspace-note">{kind==='android'?'Android':'Web'} 项目单独保存，PC 原项目保留在原入口。合成与音频处理需要电脑上的 OpenMontage 保持运行。</p>
    <NimiAppAccessGate title="OpenMontage" language="zh" requireRuntime={false} externalAccountControl><Workspace kind={kind}/></NimiAppAccessGate>
    <NimiToaster />
  </NimiAppSessionProvider></TooltipProvider></NimiThemeProvider></StrictMode>);
  void session.start();return()=>{root.unmount();session.dispose();};
}
