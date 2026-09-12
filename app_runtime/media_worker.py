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


def prepare_audio(request: dict[str, Any]) -> dict[str, Any]:
    root = Path(request["project_dir"]).resolve()
    source = project_file(root, request["source"])
    info = probe_media(source)
    if not any(stream.get("codec_type") == "audio" for stream in info.get("streams", [])):
        raise ValueError("The source has no audio stream to transcribe.")
    total = float(info.get("format", {}).get("duration", 0))
    start = float(request.get("startSeconds") or 0)
    end = float(request.get("endSeconds") if request.get("endSeconds") is not None else total)
    if not all(math.isfinite(value) for value in [start, end, total]) or start < 0 or end <= start or end > total + 0.05:
        raise ValueError("Select an audio range within the source duration.")
    if (end - start) * 32000 + 44 > 32 * 1024 * 1024:
        raise ValueError("This range exceeds Nimi's current inline audio limit. Select a shorter range to transcribe.")
    output = root / "transcription.wav"
    subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-i", str(source), "-ss", str(start), "-t", str(end - start), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(output)], capture_output=True, timeout=120, check=True)
    return {"durationSeconds": audio_duration(output), "sourceOffsetSeconds": start}


def validate_subtitle_cues(cues: Any) -> list[dict[str, Any]]:
    if not isinstance(cues, list) or not cues:
        raise ValueError("Add at least one subtitle cue before export.")
    for cue in cues:
        if not isinstance(cue, dict) or not isinstance(cue.get("text"), str) or not cue["text"].strip():
            raise ValueError("Each subtitle cue needs text.")
        start, end = float(cue.get("start", -1)), float(cue.get("end", -1))
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise ValueError("Each subtitle cue needs a valid start and end time.")
    return sorted(cues, key=lambda cue: cue["start"])


def export_subtitles(request: dict[str, Any]) -> dict[str, Any]:
    from tools.subtitle.subtitle_gen import SubtitleGen
    root = Path(request["project_dir"]).resolve()
    cues = validate_subtitle_cues(request.get("cues"))
    for format in ["srt", "vtt"]:
        result = SubtitleGen().execute({"segments": cues, "format": format, "max_words_per_cue": 1, "output_path": str(root / ("subtitles." + format))})
        if not result.success:
            raise RuntimeError(result.error or "Subtitle export failed.")
    return {"cueCount": len(cues)}


def build_timeline(root: Path, scenes: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from PIL import Image

    if not isinstance(scenes, list) or not scenes:
        raise ValueError("A production requires at least one scene.")
    cuts: list[dict[str, Any]] = []
    tracks: list[dict[str, Any]] = []
    cursor = 0.0
    for index, scene in enumerate(scenes):
        visual = project_file(root, scene.get("visual"))
        video_duration = None
        if scene.get("visualMimeType", "").startswith("video/"):
            info = probe_media(visual)
            if not any(stream.get("codec_type") == "video" for stream in info.get("streams", [])):
                raise ValueError(f"The source has no video stream: {visual.name}")
            video_duration = float(info.get("format", {}).get("duration", 0))
        else:
            with Image.open(visual) as picture:
                picture.verify()
        audio = project_file(root, scene["audio"]) if scene.get("audio") else None
        speech_duration = audio_duration(audio) if audio else 0.0
        requested = float(scene.get("durationSeconds") or 0)
        offset = float(scene.get("sourceInSeconds") or 0)
        speed = float(scene.get("speed") or 1)
        duration = (requested if scene.get("durationLocked") else max(speech_duration, requested)) or video_duration or 0
        if not math.isfinite(duration) or duration <= 0 or not math.isfinite(offset) or offset < 0:
            raise ValueError("Every scene needs a valid positive duration and source offset.")
        if not math.isfinite(speed) or speed <= 0:
            raise ValueError("Playback speed must be positive.")
        if video_duration is not None and duration * speed + offset > video_duration + 0.05:
            raise ValueError(f"Scene {index + 1}: the video is shorter than the narration or selected cut. Adjust the script or generate a longer clip.")
        if audio and not scene.get("explicitAudio"):
            tracks.append({"path": str(audio), "role": "speech", "start_seconds": cursor, "volume": 1.0})
        cuts.append({
            "id": f"scene-{index + 1}", "source": str(visual),
            "in_seconds": cursor, "out_seconds": cursor + duration,
            "transform": scene.get("transform") or {"animation": "static" if video_duration is not None else ["zoom-in", "pan-left", "zoom-out"][index % 3]},
            "backgroundColor": scene.get("backgroundColor") or "#0F172A",
        })
        cursor += duration
    return {"version": "1.0", "render_runtime": "remotion", "cuts": cuts}, tracks


def apply_edit_decisions(request: dict[str, Any]) -> list[dict[str, Any]]:
    """Resolve canonical source trims into the worker's sequential render inputs."""
    from schemas.artifacts import validate_artifact
    edits = request.get("editDecisions")
    if not edits:
        return request["scenes"]
    validate_artifact("edit_decisions", edits)
    if edits["render_runtime"] != "remotion" or edits.get("composition_mode") == "atelier":
        raise ValueError("This App render path requires the approved Remotion composition. Other render paths are still being migrated.")
    if edits.get("overlays") or edits.get("audio", {}).get("sfx") or edits.get("transitions"):
        raise ValueError("The selected overlay, SFX or transition has not been migrated yet. It will not be silently omitted.")
    if edits.get("subtitles", {}).get("enabled"):
        if edits["subtitles"].get("source") != "project-subtitles" or edits["subtitles"].get("style", "sentence") != "sentence":
            raise ValueError("Select the project's reviewed sentence subtitles. Other subtitle sources and word highlighting are not connected yet.")
        validate_subtitle_cues((request.get("subtitles") or {}).get("cues"))
    lookup = {scene.get("visualAssetId"): scene for scene in request["scenes"]}
    scenes = []
    for cut in edits["cuts"]:
        source = lookup.get(cut["source"])
        if not source:
            raise ValueError(f"The cut references an unavailable visual asset: {cut['source']}")
        if cut.get("layer", "primary") != "primary" or any(cut.get(key) not in (None, "", "none", "cut") for key in ["transition_in", "transition_out"]):
            raise ValueError("Layered cuts and this transition are not yet connected to this App renderer.")
        transform = cut.get("transform") or {}
        if transform.get("crop") or transform.get("position", "center") != "center":
            raise ValueError("The requested crop or positioning is not yet connected to this App renderer.")
        if transform.get("animation", "static") not in {"static", "none", "zoom-in", "zoom-out", "pan-left", "pan-right", "ken-burns", "ken-burns-slow-zoom", "parallax"}:
            raise ValueError("The requested motion is not connected to the selected renderer.")
        speed = float(cut.get("speed", 1))
        start, end = float(cut["in_seconds"]), float(cut["out_seconds"])
        if speed <= 0 or end <= start:
            raise ValueError("Each cut must have a positive source range and playback speed.")
        scenes.append({**source, "durationSeconds": (end - start) / speed, "sourceInSeconds": start, "speed": speed, "transform": transform, "backgroundColor": cut.get("backgroundColor"), "durationLocked": True, "explicitAudio": "narration" in edits.get("audio", {})})
    return scenes


def render(request: dict[str, Any]) -> dict[str, Any]:
    from schemas.artifacts import validate_artifact
    from tools.audio.audio_mixer import AudioMixer
    from tools.video.video_compose import VideoCompose

    root = Path(request["project_dir"]).resolve()
    if not root.is_dir():
        raise ValueError("The production directory does not exist.")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("The local media runtime needs both ffmpeg and ffprobe.")
    selected_scenes = apply_edit_decisions(request)
    decisions, tracks = build_timeline(root, selected_scenes)
    edits = request.get("editDecisions") or {}
    narration_config = edits.get("audio", {}).get("narration")
    if narration_config is not None:
        voices = {scene.get("narrationAssetId"): scene.get("audio") for scene in request["scenes"] if scene.get("audio")}
        referenced = {segment["asset_id"] for segment in narration_config.get("segments", [])}
        if voices.keys() - referenced:
            raise ValueError("The edit omits generated narration. Add its segments or explicitly revise the narration plan before rendering.")
        for segment in narration_config.get("segments", []):
            name = voices.get(segment["asset_id"])
            if not name:
                raise ValueError("The edit references an unavailable narration asset.")
            audio_path = project_file(root, name)
            length = audio_duration(audio_path)
            start = float(segment["start_seconds"])
            if segment.get("end_seconds") is not None and float(segment["end_seconds"]) < start + length - 0.05:
                raise ValueError("The edit would truncate narration. Revise the narration or its timing first.")
            tracks.append({"path": str(audio_path), "role": "speech", "start_seconds": start, "volume": 1.0})
    validate_artifact("edit_decisions", decisions)
    artifacts = root / "artifacts"
    artifacts.mkdir(exist_ok=True)
    (artifacts / "edit_decisions.json").write_text(json.dumps(request.get("editDecisions") or decisions, indent=2), encoding="utf-8")

    narration = root / "narration.wav"
    if (edits.get("audio", {}).get("music") or edits.get("music")) and not request.get("music"):
        raise ValueError("The edit requests music, but no music asset is available.")
    if request.get("music"):
        music = project_file(root, request["music"])
        audio_duration(music)
        music_config = edits.get("audio", {}).get("music") or edits.get("music") or {}
        if music_config.get("asset_id", "global-music") != "global-music":
            raise ValueError("The edit references an unavailable music asset.")
        tracks.append({"path": str(music), "role": "music", "start_seconds": 0, "volume": music_config.get("volume", 0.18), "fade_in_seconds": music_config.get("fade_in_seconds", 0), "fade_out_seconds": music_config.get("fade_out_seconds", 0)})
    audio_props = {}
    if tracks:
        total_duration = max(cut["out_seconds"] for cut in decisions["cuts"])
        for track in tracks:
            if track["role"] == "speech" and float(track["start_seconds"]) + audio_duration(Path(track["path"])) > total_duration + 0.05:
                raise ValueError("Narration extends beyond the edited video. Adjust the edit before rendering.")
        mixed = AudioMixer().execute({"operation": "full_mix", "tracks": tracks, "normalize": True, "target_duration": total_duration, "ducking": edits.get("audio", {}).get("music", {}).get("ducking", {"enabled": True}), "output_path": str(narration)})
        if not mixed.success:
            raise RuntimeError(mixed.error or "Audio mixing failed.")
        audio_duration(narration)
        audio_props = {"narration": {"src": str(narration), "volume": 1.0}}

    props = {**decisions, "audio": audio_props, "cuts": [
        {**cut, "mediaType": "video" if scene.get("visualMimeType", "").startswith("video/") else "image",
         "sourceInSeconds": scene.get("sourceInSeconds") or 0, "speed": scene.get("speed") or 1, "muteSource": bool(scene.get("audio"))}
        for cut, scene in zip(decisions["cuts"], selected_scenes)
    ]}
    if request.get("subtitles") and edits.get("subtitles", {}).get("enabled", True):
        subtitle_input = request["subtitles"]
        cues = validate_subtitle_cues(subtitle_input.get("cues"))
        total_duration = max(cut["out_seconds"] for cut in decisions["cuts"])
        if any(cue["end"] > total_duration + 0.05 for cue in cues):
            raise ValueError("A subtitle extends beyond the edited video. Adjust its timing before rendering.")
        props["subtitles"] = {**edits.get("subtitles", {}), "cues": cues, "font_size": subtitle_input["fontSize"], "position": subtitle_input["position"]}
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
    if not video or (tracks and not audio) or (video.get("width"), video.get("height")) != (1280, 720):
        raise RuntimeError("The composition did not produce the requested 720p video and narration.")
    duration = float(probe.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("The rendered video has no valid duration.")
    return {"output": "renders/final.mp4", "width": 1280, "height": 720, "durationSeconds": duration, "sizeBytes": output.stat().st_size, "hasAudio": audio is not None}


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict) or request.get("operation") not in {"render", "checkpoint", "pipeline-context", "prepare-audio", "export-subtitles"}:
            raise ValueError("The requested media or pipeline operation is not supported.")
        with redirect_stdout(sys.stderr):
            if request["operation"] == "prepare-audio":
                result = prepare_audio(request)
            elif request["operation"] == "export-subtitles":
                result = export_subtitles(request)
            elif request["operation"] == "pipeline-context":
                from app_runtime.pipeline_context import pipeline_context
                result = pipeline_context(request)
            elif request["operation"] == "checkpoint":
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
