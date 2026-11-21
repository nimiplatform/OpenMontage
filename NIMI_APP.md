# OpenMontage

Produce narrated 720p videos from topic briefs, imported source footage, and AI-generated media in a stage-gated Backlot studio. Review the idea, script, scene plan, and filmstrip assets, approve materials before local composition, then inspect and export your finished video and subtitles.

## What you can do

- **Quick Image Explainer**: Turn a written brief into an editable script and scene plan, generate scene images and narration via Nimi, review or regenerate individual scenes, and render a narrated MP4 locally.
- **Basic Hybrid Production**: Combine imported video, image, and audio files with Nimi-generated clips, images, and narration on one timeline, with editable source trim ranges and playback speed.
- **Source Transcription**: Select a time range on imported audio or video, transcribe speech through Nimi, revise the recognized text, and export `.txt` (previous successful text is kept if a new request fails).
- **Subtitles**: Build paragraph cues from actual narration timing or add cues manually, adjust text, timing, position, and font size, export `.srt` / `.vtt`, or burn captions into the video and recompose locally.

## Getting started

1. Open OpenMontage from Nimi Home on **Windows x64** or **macOS Apple Silicon (arm64)** (Intel macOS is not a declared target).
2. Click **AI 设置** (AI Settings) and select the Nimi-managed Local or Cloud models for the capabilities your workflow uses (text, image, speech synthesis, and optionally speech transcription, video, or music). OpenMontage uses your saved Nimi selections and never substitutes models silently.
3. In Backlot, click **新建制作** (New Production), choose **快速图文解说** (Quick Image Explainer) or **混合素材制作** (Hybrid), provide your brief or import source media, and review and approve each stage before generating missing assets or composing the final video.
4. Preview the rendered MP4 in **成片** (Renders) and export the video and subtitle sidecars using their separate download actions.

Video composition and audio preparation run locally in the desktop App using bundled Python, Node, Remotion, and FFmpeg — no separate media toolchain installation is required.

## Web and Android companion access

- Keep Nimi Home and OpenMontage **0.1.3 or later** open on your primary PC. Earlier PC Catalog version **0.1.0** only consumes AI and does not provide the remote media studio required by Web and Android.
- Sign in with the same Nimi account, confirm the source in Home, and allow `openmontage.media.v1` media operations under **Integrations**.
- For Web, open the [OpenMontage page on nimi.ai](https://nimi.ai/apps/openmontage) and choose **Open in browser** when available. On first use, verify that Home shows `https://openmontage.nimi.xyz` before approving the source.
- On Android, you can create a quick image explainer and save finished MP4 and subtitle files through the system Save picker. Keep the App open until it reports completion; if the system picker briefly disconnects Runtime, returning reconnects without repeating generation or composition. Source import and the complete hybrid workflow on Android are still being verified.
- AI runs on the connected primary PC Runtime; local composition runs in the PC App. If a connection drops during composition, reconnect and choose **读取原合成结果** to check the original operation instead of submitting a duplicate render. Keep the PC App open until the result is saved; closing it can make an uncollected media result unavailable.

## Data handling and costs

- Projects, checkpoints, decision logs, job references, imported source files, and generated or rendered media are stored in Nimi-mediated private storage on your PC.
- PC, Web, and Android registrations keep separate project stores; existing PC projects remain in their original registration.
- Changing an approved plan invalidates affected downstream checkpoints and media, while unchanged assets are retained on retry. Uncertain submissions pause rather than blindly repeating generation.
- Cloud AI services receive only the inputs needed for the selected task and may incur provider charges. Actual cost quotes are unavailable in the interface. Keep Nimi running while working and export finished work you want to keep.

## Current limitations

- Composition outputs a horizontal **1280 × 720** canvas. Planning durations are targets; actual duration follows generated media and approved edits.
- The current Backlot workspace interface is in Simplified Chinese.
- Automatic word-level subtitle alignment, multilingual dubbing, stock-footage retrieval, avatars, layered motion graphics, and the remaining upstream catalogue workflows are not yet integrated; a catalogue entry alone does not establish an executable workflow.
- AI music generation requires lyrics under the current contract; AI music and reference-image video generation remain unverified in end-to-end runs.
- Remote companion transfers are capped at **128 MiB** per individual source/preview file and **64 MiB** for combined composition inputs.

## License and support

OpenMontage for Nimi is adapted from open-source [OpenMontage](https://github.com/OpenMontageInc/OpenMontage) under `AGPL-3.0-only`. For help, report the App version, workflow, and redacted error details (excluding credentials and private footage) on [GitHub Issues](https://github.com/nimiplatform/OpenMontage/issues).
