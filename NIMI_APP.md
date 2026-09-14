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

The earlier live Dashscope sample used a Runtime with the native video parameter mapping and `wan2.7-t2v` catalog entry. Use a Runtime compatible with the selected SDK/Kit/native combination and the task's configured capabilities; dependency and build checks do not replace live provider or installed Runtime acceptance.

The Windows x86_64 and macOS Apple Silicon packages include Python, Node, Remotion, Chrome Headless Shell and FFmpeg/FFprobe. The media tools use a pinned full-filter FFmpeg distribution for the original mixing operations; Remotion keeps its own compositor binaries. Ordinary-machine Catalog installation and update acceptance are still pending. Catalog availability requires the separate Registry admission process.

## Development

This fork tracks [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage)
from upstream baseline `08e2151fa02de28a5d6a312b3d575692bf147ad7`. The downstream
App mainline is `nimi`; Nimi App versions are independent of upstream tags.
For an upstream update, select an exact commit and review code, dependency,
license, CI and instruction-entry changes together. Do not import upstream
release tags automatically or reintroduce the original provider path.

Development tasks follow AGENTS.md and the actual package commands. The broad
upstream production guide is scoped to production knowledge and does not run
as a mandatory onboarding step for every coding task. The current hybrid
slice can validate tooling changes; the remaining product workflows above
retain their separate completion requirements.

Use Node 24 and pnpm 10.34.5. Public dependencies are app-tools 0.5.3, SDK 0.12.0 and Kit/native 0.8.0, with nimi-coding pinned to 0.6.3. Public builds use no Nimi workspace overrides. A declared pnpm patch for the build-only `@electron/osx-sign` 2.7.0 bounds its file scanning, preventing EMFILE on the bundled Python/Node trees. It preserves signing coverage and is recorded in the lockfile; re-evaluate it when upgrading that dependency. The App's single-package workspace isolates it from enclosing workspaces.

App Tools maintains the project lifecycle skill and its independent AGENTS block. Nimi-coding 0.6.3 maintains its own AGENTS block; CLAUDE.md routes to the App instructions without a duplicate retired managed block. Studio's one-turn text display ignores opaque continuity metadata and rejects undeclared tool output; it does not introduce a tool-execution workflow.

```powershell
corepack pnpm@10.34.5 install --frozen-lockfile
py -3 -m venv .venv
.venv/Scripts/python -m pip install -r app_runtime/requirements-media.txt
npm --prefix remotion-composer ci
corepack pnpm@10.34.5 run sync
corepack pnpm@10.34.5 run check
corepack pnpm@10.34.5 run test:app
corepack pnpm@10.34.5 run app:build -- --target windows-x86_64
corepack pnpm@10.34.5 run dev -- --cdp-port 9236
```

On macOS Apple Silicon, use the same public dependency installation and lifecycle commands, with this native media setup and target:

```sh
python3 -m venv .venv
.venv/bin/python3 -m pip install -r app_runtime/requirements-media.txt
npm --prefix remotion-composer ci
pnpm exec nimi-app build --target macos-aarch64 --production
pnpm exec nimi-app pack --target macos-aarch64 --production
pnpm run dev -- --cdp-port 9236
```

`predev` prepares the pinned native FFmpeg/FFprobe distribution. Production builds bundle Python 3.14.4, Node 24.15.0, the locked composer and its headless browser; installed users do not need a separate Python, Node or Homebrew setup. Archive checksums are pinned for both platforms. Use a Python version supported by the pinned media wheels for development (the packaged build uses 3.14.4).

The official scaffold was integrated using app-tools' existing-App adoption workflow. There is no managed scaffold lock. `sync` maintains package-owned projections; `check`, `dev`, `app:build` and `pack` use the official lifecycle owners. The App-owned build adds the selected media runtime. Native media and checkpoint tests run against that completed package during the build; `test:app` runs the application control tests without requiring media setup.

To reopen an existing development project, list registrations with `pnpm exec nimi-app dev --list-registrations`, then use `pnpm run dev -- --resume <selector> --cdp-port 9236`. Selectors belong to the current Desktop session; list again after restarting Nimi. A new development registration has its own project data. CDP acceptance attaches to the exact Desktop-supervised OpenMontage window. The media path resolver selects the native Python, Node, FFmpeg and browser locations. On macOS, media workers run in owned process groups so cancellation includes their child tools. Packaged media is added before ad-hoc signing; this supplies neither Developer ID nor notarization.

## Release and licensing

Before the first release, follow the [app-tools publishing setup](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#publishing-on-github).
Configure `NIMI_REPOSITORY_ADMIN_TOKEN` in this repository's Actions secrets with
**Administration: Read-only**. It only checks tag protection and Release
immutability; actual Release uploads use GitHub's built-in token. Local
development does not need this credential. A secret in another App repository
is not inherited.

The declared targets are Windows x86_64 and macOS Apple Silicon (ARM64). Intel macOS is not a declared target. Release through the managed protected-tag GitHub workflow, immutable Release assets and the separate Nimi App Registry review. The Nimi platform account does not supply GitHub publishing credentials.

The upstream AGPL license is retained. Bundled components keep their own terms and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The publisher has confirmed Remotion Free License eligibility.

## Support

Report the App version and failed operation through this fork's issue tracker. Include diagnostics when useful, and exclude credentials and private source material.
