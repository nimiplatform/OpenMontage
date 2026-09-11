import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveAsset } from "../lib/resolveAsset";

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)",
      pointerEvents: "none",
    }}
  />
);

// ---------------------------------------------------------------------------
// Enhanced Image Scene — spring physics, parallax, variety
// ---------------------------------------------------------------------------

export const ImageScene: React.FC<{ src: string; animation?: string }> = ({
  src,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Smooth spring fade-in
  const fadeIn = spring({ frame, fps, config: { damping: 18, stiffness: 80 } });

  // Fade-out for crossfade effect
  const fadeOutStart = durationInFrames - 8;
  const fadeOut = interpolate(frame, [fadeOutStart, durationInFrames], [1, 0.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  const anim = animation || "zoom-in";

  // Progress with easing — smoother than linear
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (anim === "zoom-in") {
    scale = 1 + progress * 0.18;
  } else if (anim === "zoom-out") {
    scale = 1.18 - progress * 0.18;
  } else if (anim === "pan-left") {
    translateX = interpolate(progress, [0, 1], [40, -40]);
    scale = 1.15;
  } else if (anim === "pan-right") {
    translateX = interpolate(progress, [0, 1], [-40, 40]);
    scale = 1.15;
  } else if (anim === "ken-burns" || anim === "ken-burns-slow-zoom") {
    // Cinematic Ken Burns: gentle zoom + diagonal drift
    scale = 1 + progress * 0.22;
    translateX = interpolate(progress, [0, 1], [0, -25]);
    translateY = interpolate(progress, [0, 1], [0, -15]);
  } else if (anim === "parallax") {
    // Subtle parallax — foreground moves faster
    translateY = interpolate(progress, [0, 1], [15, -15]);
    scale = 1.1;
  }
  // "static" or "none" → just display

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#0F172A" }}>
      <Img
        src={resolveAsset(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: fadeIn * fadeOut,
          transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
          willChange: "transform, opacity",
        }}
      />
      <Vignette />
    </AbsoluteFill>
  );
};
