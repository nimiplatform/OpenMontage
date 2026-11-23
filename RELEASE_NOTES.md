# 0.1.4 — Bilingual storefront and fresh Desktop storage fix

- Adds bilingual (English and Simplified Chinese) Nimi App storefront metadata, user introductions (`NIMI_APP.md`, `NIMI_APP.zh.md`), highlights, tags, and 16:9 Backlot studio cover and screenshots for Nimi Home and nimi.ai.
- Upgrades to `@nimiplatform/sdk` `0.24.0-rc.11`, `@nimiplatform/kit` `0.24.0-rc.18`, and `@nimiplatform/app-tools` `0.16.0-rc.15`, bundles the Electron main process as a pure single-file module without redundant root `node_modules` staging, and packs `.nimiapp` with deterministic bounded Deflate compression alongside the shared `storefront-media.zip`.
- Fixes fresh Desktop registrations treating the protected shell carrier's `not-found` and `already-exists` storage responses consistently alongside remote Runtime codes.

# 0.1.3 — Web access to PC video composition

Keep OpenMontage 0.1.3 running on your primary PC to compose video from the hosted Web client. Review the scene materials before rendering, then preview and download the finished video. After a connection loss, reopen the same Web project and check its original composition task before starting another render. PC and Web projects are stored separately.

# 0.1.2 — Windows media production

Migrates to public SDK 0.21.0, Kit/native 0.19.3, App Tools 0.12.2 and Nimi Coding 0.6.5. Reasoning summaries no longer end a text artifact, Job submission uses the current contract, and transcription passes binary bytes. Image source geometry follows the selected Nimi model; the final composition remains 1280×720. Windows supervised Qwen text, Qwen Image 3 Pro and Qwen3 TTS/Cherry produced a real 34.624-second H.264/AAC MP4 which exported and fully decoded. Existing unintegrated workflows retain their earlier limits; this does not claim all twelve pipelines or Catalog installation passed.

# OpenMontage for Nimi 0.1.1

Adds the publisher declaration for audience, AI text/image/audio/video outputs and current data practices. Keeps the supported SDK 0.12 / Kit 0.8 pairing and the existing integration limits below; no new workflow, launch gate or safety certification is introduced. Publication, Registry admission and installed acceptance remain separate steps.

# OpenMontage for Nimi 0.1.0

Nimi provides the platform account, App Access, AI configuration and AI execution. OpenMontage retains production workflows, editorial choices and approvals.

- Work in the Backlot project library, screenplay, stage rail, filmstrip and results views.
- Produce narrated image explainers and the connected basic original hybrid workflow, mixing source footage, generated video and images.
- Review and revise stages, trim source video, apply supported scaling/motion, and retain completed media when retrying.
- Transcribe a source audio/video range through Nimi, correct the recognized text and export TXT. A failed replacement request preserves the last successful result.
- Create paragraph subtitles from actual narration timing or enter cues manually; edit and export SRT/VTT, burn captions into the video, or remove them by recomposing.
- Preserve projects, checkpoints, decisions, job references and media in Nimi storage.
- Render and preview 720p video locally; export MP4 and workflow delivery metadata.
- Build Windows x86_64 and macOS Apple Silicon Apps with Python, Node, Remotion, Chrome Headless Shell and FFmpeg through official app-tools.

The original 12 workflows remain the migration baseline. This candidate does not complete their integration. Automatic word alignment, multilingual dubbing, retrieval, richer composition, avatars and other specialized tasks remain unfinished; reference-image video and music AI generation have not passed real acceptance. Catalogue entries do not imply executable coverage. Formal Catalog installation/update and installed Runtime compatibility are still unverified. Catalog admission is a separate administrator decision; this release does not claim completion of all original workflows.

This version uses public SDK 0.12.0, Kit/native 0.8.0 and App Tools 0.5.3. Both native targets run real packaged media tests. macOS media rendering preserves the package signature, and cancellation cleans up detached browser processes. Optional unconfigured narration does not block text-only planning. Known composer dependency advisories were addressed before publication.
