# OpenMontage for Nimi

OpenMontage video production with Nimi providing the platform session, App Access, model configuration and AI execution. OpenMontage owns its production workflows, editorial choices and approvals. The Nimi platform account is separate from any application-specific account or permissions; this integration does not add a business-account system.

## Use the App

1. Open OpenMontage through Nimi. Start or continue a project in the Backlot library. Configure the capabilities your task uses in **AI 设置**.
2. Choose the quick image explainer or the connected basic **混合素材制作** workflow. Supply facts and import source media in **材料**. For source speech, select a range and language, run transcription, then correct or export the recognized text.
3. Prepare and review the idea, script and scene plan. Confirm each required stage before generating its missing assets. Source video, generated video and images can share the hybrid timeline.
4. Review the filmstrip and narration. Edit source ranges, placement and the supported scaling/motion settings; confirm the materials before local composition.
5. In **字幕**, create paragraph cues from actual narration timing or add them manually. Edit text, timing, position and size; export SRT/VTT, or apply subtitles and recompose. Removing burned subtitles also recomposes the video and retains the editable draft.
6. Preview the result in **成片**, confirm it and use the workflow's delivery action. MP4 can be downloaded; subtitle sidecars have their own download actions.

The current output is 1280 × 720. Duration follows actual media and the approved edit. The quick explainer offers 30, 45 or 60 seconds as planning targets, not exact output guarantees. Model charges depend on your configured service; the App does not invent a quote or promise free generation.

Projects, checkpoints, job references and generated media use Nimi storage. Unchanged media is retained when retrying. A changed plan invalidates its downstream checkpoints and affected media. An uncertain submission is paused to avoid blind duplication. A stop request pauses further scheduling; owner responses determine whether a Nimi job or local process actually stopped.

## Current scope

This development build covers the verified integration slices below. The migration target is the broader OpenMontage product with Nimi supplying the relevant platform and AI services; it is not a reduced explainer-only replacement.

The pipeline catalogue lists the original 12 business workflows and their actual stages. `nimi-image-explainer` remains a verified foundation. A basic original `hybrid` task has passed all seven stages in the supervised development App: source-media import, idea/script/scene-plan editing and approvals, real Nimi video/image/narration generation, source trims, scaling/motion, mixed Remotion composition, human review and project export. The quick explainer retains its prototype 1–12 scene control; original workflows are not capped at 12 by that control. Confirmed choices remain visible during revisions, and actual changes are retained in decision history. Missing costs are stated as unavailable.

The verified hybrid sample combines a provided video excerpt, a newly generated video and image, and three narration segments into a 15-second result. This does not cover every hybrid tool or video mode. Music jobs require lyrics in the current public Nimi contract and an available configured music service; real music generation and image-reference video generation remain unverified. Source text transcription now uses Nimi speech recognition, with editable results, TXT export and preservation of the last successful text when a new request fails. Paragraph/manual subtitles support real narration timing, SRT/VTT export and local burn/remove. Automatic word alignment and multilingual dubbing remain unfinished. Retrieval, layered composition, additional transitions, avatars and the other specialized workflows also still require integration. These are core remaining work before final delivery. Keeping original source files or showing the catalogue does not count as an integrated product path.

The live Dashscope video path required Nimi Runtime fix `b36e72781`: native video parameter mapping and the `wan2.7-t2v` catalog entry. The development Runtime contains that fix; formal installed Runtime compatibility still needs release acceptance.

The Windows package includes Python, Node, Remotion, Chrome Headless Shell and FFmpeg/FFprobe. The media tools use a pinned full-filter FFmpeg distribution for the original mixing operations; Remotion keeps its own compositor binaries. Ordinary-machine Catalog installation and update acceptance are still pending. This is a development candidate, not a completed public release.

## Development

Use Node 24 and pnpm 10.34.5. Public dependencies are app-tools 0.5.1, SDK 0.11.0 and Kit 0.7.0. No Nimi workspace overrides or modified installed packages are used. The App's single-package workspace isolates it from enclosing workspaces.

Keep nimi-coding pinned to 0.6.2 while app-tools 0.5.1 requires that exact version. The newer nimi-coding 0.6.3 stops managing `CLAUDE.md`; adopt that change once app-tools supports it.

```powershell
corepack pnpm@10.34.5 install
py -3 -m venv .venv
.venv/Scripts/python -m pip install -r app_runtime/requirements-media.txt
npm --prefix remotion-composer ci
corepack pnpm@10.34.5 run sync
corepack pnpm@10.34.5 run check
corepack pnpm@10.34.5 run test:app
corepack pnpm@10.34.5 run app:build -- --target windows-x86_64
corepack pnpm@10.34.5 run dev -- --cdp-port 9236
```

The official scaffold was integrated using app-tools' existing-App adoption workflow. There is no managed scaffold lock. `sync` maintains package-owned projections; `check`, `dev`, `app:build` and `pack` use the official lifecycle owners. The App-owned build adds the selected media runtime. Native media and checkpoint tests run against that completed package during the build; `test:app` runs the application control tests without requiring media setup.

To reopen an existing development project, list registrations with `pnpm exec nimi-app dev --list-registrations`, then use `pnpm run dev -- --resume <selector> --cdp-port 9236`. A new development registration has its own project data. CDP acceptance attaches to the exact Desktop-supervised OpenMontage window.

## Release and licensing

The target is Windows x86_64. Release through the managed protected-tag GitHub workflow, immutable Release assets and the separate Nimi App Registry review. The Nimi platform account does not supply GitHub publishing credentials.

The upstream AGPL license is retained. Bundled components keep their own terms and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The publisher has confirmed Remotion Free License eligibility.

## Support

Report the App version and failed operation through this fork's issue tracker. Include diagnostics when useful, and exclude credentials and private source material.
