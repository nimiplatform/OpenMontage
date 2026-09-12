import { AbsoluteFill, Audio, Composition, OffthreadVideo, Sequence, registerRoot, useCurrentFrame, useVideoConfig } from 'remotion';
import { ImageScene, imageMotion } from './components/ImageScene';
import { resolveAsset } from './lib/resolveAsset';
import type { Caption } from '@remotion/captions';

type ImageExplainerProps = {
  cuts: { id: string; source: string; in_seconds: number; out_seconds: number; mediaType?: 'image' | 'video'; sourceInSeconds?: number; speed?: number; muteSource?: boolean; backgroundColor?: string; transform?: { animation?: string; scale?: number } }[];
  audio?: { narration?: { src: string; volume?: number } };
  subtitles?: { cues: { start: number; end: number; text: string }[]; font?: string; font_size?: number; color?: string; background?: string; position?: string };
};

function SubtitleOverlay({ subtitles }: { subtitles: NonNullable<ImageExplainerProps['subtitles']> }) {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const captions: Caption[] = subtitles.cues.map((cue) => ({ text: cue.text, startMs: cue.start * 1000, endMs: cue.end * 1000, timestampMs: null, confidence: null }));
  const text = captions.filter((cue) => cue.startMs <= frame / fps * 1000 && cue.endMs > frame / fps * 1000).map((cue) => cue.text).join('\n');
  if (!text) return null;
  return <AbsoluteFill style={{ padding: '48px 64px', alignItems: 'center', justifyContent: subtitles.position === 'top-center' ? 'flex-start' : subtitles.position === 'center' ? 'center' : 'flex-end', pointerEvents: 'none' }}>
    <div style={{ maxWidth: '100%', padding: '10px 18px', background: subtitles.background || '#000000b3', color: subtitles.color || '#ffffff', fontFamily: subtitles.font || 'Arial, Microsoft YaHei, sans-serif', fontSize: subtitles.font_size || 36, fontWeight: 600, lineHeight: 1.4, whiteSpace: 'pre-wrap', textAlign: 'center' }}>{text}</div>
  </AbsoluteFill>;
}

function VideoCut({ cut }: { cut: ImageExplainerProps['cuts'][number] }) {
  const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig();
  const motion = imageMotion(cut.transform?.animation || 'static', Math.min(1, Math.max(0, frame / durationInFrames)));
  return <AbsoluteFill style={{ overflow: 'hidden', background: cut.backgroundColor || '#0F172A' }}><OffthreadVideo src={resolveAsset(cut.source)} startFrom={Math.round((cut.sourceInSeconds || 0) * fps)} playbackRate={cut.speed || 1} muted={cut.muteSource}
    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${motion.scale * (cut.transform?.scale ?? 1)}) translate(${motion.translateX}px, ${motion.translateY}px)` }} /></AbsoluteFill>;
}

function ImageExplainer({ cuts, audio, subtitles }: ImageExplainerProps) {
  const { fps } = useVideoConfig();
  return <AbsoluteFill style={{ background: '#0F172A' }}>
    {cuts.map((cut) => <Sequence key={cut.id} from={Math.round(cut.in_seconds * fps)} durationInFrames={Math.max(1, Math.round(cut.out_seconds * fps) - Math.round(cut.in_seconds * fps))}>
      {cut.mediaType === 'video'
        ? <VideoCut cut={cut} />
        : <ImageScene src={cut.source} animation={cut.transform?.animation} scale={cut.transform?.scale} backgroundColor={cut.backgroundColor} />}
    </Sequence>)}
    {audio?.narration ? <Audio src={resolveAsset(audio.narration.src)} volume={audio.narration.volume ?? 1} /> : null}
    {subtitles ? <SubtitleOverlay subtitles={subtitles} /> : null}
  </AbsoluteFill>;
}

// The installed image-only workflow uses the same image treatment without loading
// unrelated composition demos or fetching typography that it never renders.
registerRoot(() => <Composition id="NimiImageExplainer" component={ImageExplainer} width={1280} height={720} fps={30} durationInFrames={30}
  defaultProps={{ cuts: [] } as ImageExplainerProps}
  calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(Math.max(0, ...props.cuts.map((cut) => cut.out_seconds)) * 30)) })}
/>);
