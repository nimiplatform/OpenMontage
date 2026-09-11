import { AbsoluteFill, Audio, Composition, Sequence, registerRoot, useVideoConfig } from 'remotion';
import { ImageScene } from './components/ImageScene';
import { resolveAsset } from './lib/resolveAsset';

type ImageExplainerProps = {
  cuts: { id: string; source: string; in_seconds: number; out_seconds: number; transform?: { animation?: string } }[];
  audio?: { narration?: { src: string; volume?: number } };
};

function ImageExplainer({ cuts, audio }: ImageExplainerProps) {
  const { fps } = useVideoConfig();
  return <AbsoluteFill style={{ background: '#0F172A' }}>
    {cuts.map((cut) => <Sequence key={cut.id} from={Math.round(cut.in_seconds * fps)} durationInFrames={Math.max(1, Math.round(cut.out_seconds * fps) - Math.round(cut.in_seconds * fps))}>
      <ImageScene src={cut.source} animation={cut.transform?.animation} />
    </Sequence>)}
    {audio?.narration ? <Audio src={resolveAsset(audio.narration.src)} volume={audio.narration.volume ?? 1} /> : null}
  </AbsoluteFill>;
}

// The installed image-only workflow uses the same image treatment without loading
// unrelated composition demos or fetching typography that it never renders.
registerRoot(() => <Composition id="NimiImageExplainer" component={ImageExplainer} width={1280} height={720} fps={30} durationInFrames={30}
  defaultProps={{ cuts: [] } as ImageExplainerProps}
  calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(Math.max(0, ...props.cuts.map((cut) => cut.out_seconds)) * 30)) })}
/>);
