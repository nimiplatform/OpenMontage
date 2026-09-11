"""One-shot JSON worker for local media composition; AI stays in the Nimi App.

The Electron Host materializes inputs in one temporary production directory.
This worker consumes those files and the existing OpenMontage media tools. It
does not open a server, select an AI provider, or hold a Nimi client.
"""

from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import struct
import sys
import wave
from typing import Any


def probe_media(file_path: Path) -> dict[str, Any]:
    executable = shutil.which("ffprobe")
    if not executable:
        raise RuntimeError("The local media runtime is missing ffprobe.")
    result = subprocess.run(
        [executable, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(file_path)],
        capture_output=True, text=True, timeout=20, check=True,
    )
    return json.loads(result.stdout)


def audio_duration(file_path: Path) -> float:
    probe = probe_media(file_path)
    if not any(stream.get("codec_type") == "audio" for stream in probe.get("streams", [])):
        raise ValueError(f"The narration file has no audio stream: {file_path.name}")
    duration = float(probe.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError(f"The narration duration is invalid: {file_path.name}")
    decoded = subprocess.run(
        [shutil.which("ffmpeg"), "-v", "error", "-i", str(file_path), "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"],
        capture_output=True, timeout=30, check=True,
    )
    with wave.open(io.BytesIO(decoded.stdout), "rb") as audio:
        samples = audio.readframes(min(audio.getnframes(), math.ceil(duration * 16000) + 16000))
    peak = max((abs(sample[0]) for sample in struct.iter_unpack("<h", samples)), default=0)
    if peak <= 4:
        raise ValueError(f"Narration is effectively silent: {file_path.name}. Check speech volume and regenerate this narration.")
    return duration


def project_file(root: Path, relative_path: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path:
        raise ValueError("A media file name is required.")
    path = (root / relative_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("The media file must exist inside this production directory.")
    return path


def build_timeline(root: Path, scenes: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from PIL import Image

    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 12:
        raise ValueError("A production requires between one and twelve scenes.")
    cuts: list[dict[str, Any]] = []
    tracks: list[dict[str, Any]] = []
    cursor = 0.0
    for index, scene in enumerate(scenes):
        image = project_file(root, scene.get("image"))
        audio = project_file(root, scene.get("audio"))
        with Image.open(image) as picture:
            picture.verify()
        duration = audio_duration(audio)
        tracks.append({"path": str(audio), "role": "speech", "start_seconds": cursor, "volume": 1.0})
        cuts.append({
            "id": f"scene-{index + 1}",
            "source": str(image),
            "in_seconds": cursor,
            "out_seconds": cursor + duration,
            "transform": {"animation": ["zoom-in", "pan-left", "zoom-out"][index % 3]},
        })
        cursor += duration
    if cursor > 180:
        raise ValueError("This composition supports at most three minutes of narration.")
    return {"version": "1.0", "render_runtime": "remotion", "cuts": cuts}, tracks


def render(request: dict[str, Any]) -> dict[str, Any]:
    from schemas.artifacts import validate_artifact
    from tools.audio.audio_mixer import AudioMixer
    from tools.video.video_compose import VideoCompose

    root = Path(request["project_dir"]).resolve()
    if not root.is_dir():
        raise ValueError("The production directory does not exist.")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("The local media runtime needs both ffmpeg and ffprobe.")
    decisions, tracks = build_timeline(root, request["scenes"])
    validate_artifact("edit_decisions", decisions)
    artifacts = root / "artifacts"
    artifacts.mkdir(exist_ok=True)
    (artifacts / "edit_decisions.json").write_text(json.dumps(decisions, indent=2), encoding="utf-8")

    narration = root / "narration.wav"
    mixed = AudioMixer().execute({"operation": "mix", "tracks": tracks, "normalize": True, "output_path": str(narration)})
    if not mixed.success:
        raise RuntimeError(mixed.error or "Narration mixing failed.")
    audio_duration(narration)

    # Renderer props are derived from the schema-validated edit artifact; the
    # renderer's audio and overlay fields are not written into that artifact.
    props = {**decisions, "audio": {"narration": {"src": str(narration), "volume": 1.0}}}
    output = root / "renders" / "final.mp4"
    result = VideoCompose().execute({
        "operation": "remotion_render",
        "composition_data": props,
        "profile": "generic_720p",
        "output_path": str(output),
        "remotion_timeout_ms": 120_000,
        "remotion_entry_point": os.environ.get("OPENMONTAGE_REMOTION_ENTRY", "src/nimi-image-explainer.tsx"),
        "remotion_composition_id": "NimiImageExplainer",
        "remotion_browser_executable": os.environ.get("OPENMONTAGE_REMOTION_BROWSER", ""),
    })
    if not result.success:
        raise RuntimeError(result.error or "Remotion composition failed.")

    probe = probe_media(output)
    video = next((stream for stream in probe.get("streams", []) if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in probe.get("streams", []) if stream.get("codec_type") == "audio"), None)
    if not video or not audio or (video.get("width"), video.get("height")) != (1280, 720):
        raise RuntimeError("The composition did not produce the requested 720p video and narration.")
    duration = float(probe.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("The rendered video has no valid duration.")
    return {"output": "renders/final.mp4", "width": 1280, "height": 720, "durationSeconds": duration, "sizeBytes": output.stat().st_size}


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or request.get("operation") not in {"render", "checkpoint"}:
            raise ValueError("The worker accepts only render and checkpoint operations.")
        with redirect_stdout(sys.stderr):
            if request["operation"] == "checkpoint":
                from app_runtime.checkpoint_worker import checkpoint
                result = checkpoint(request)
            else:
                result = render(request)
        json.dump({"ok": True, **result}, sys.stdout)
        sys.stdout.write("\n")
        return 0
    except Exception as error:
        json.dump({"ok": False, "message": str(error)}, sys.stdout)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
