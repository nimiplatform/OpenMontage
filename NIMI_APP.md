# OpenMontage for Nimi

Create a short narrated video from your own source material. Nimi provides the platform session, App Access, model configuration and AI execution. OpenMontage owns the production workflow and approvals. The Nimi platform account is separate from any application-specific account or permissions; this first version does not add a business-account system.

## Use the App

1. Open OpenMontage through Nimi. Configure text, image and speech capabilities in **AI 设置**, then choose a narration voice.
2. Paste facts or a prepared summary and choose a target duration of 30, 45 or 60 seconds.
3. Prepare and edit the three-scene plan. Confirm it to generate missing images and narration.
4. Review the materials and confirm local composition. Preview the result and export MP4.

Actual duration follows the generated narration and is shown with the result. The current output is 1280 × 720. Model charges depend on your configured service; the App does not invent a quote or promise free generation.

Projects, checkpoints, job references and generated media use Nimi storage. Unchanged media is retained when retrying. A changed plan invalidates its downstream checkpoints and affected media. An uncertain submission is paused to avoid blind duplication. A stop request pauses further scheduling; owner responses determine whether a Nimi job or local process actually stopped.

## Current scope

This version supports the `nimi-image-explainer` pipeline: supplied facts, three images, narration, approval, composition and export. Video generation, music, transcription, avatars and other upstream workflows are not exposed in this App version. The original upstream tools and documentation remain in the repository.

The Windows package includes Python, Node, Remotion, Chrome Headless Shell and Remotion's FFmpeg/FFprobe binaries. Ordinary-machine Catalog installation and update acceptance are still pending. This is a development candidate, not a completed public release.

## Development

Use Node 24 and pnpm 10.34.5. Public dependencies are app-tools 0.5.1, SDK 0.11.0 and Kit 0.7.0. No Nimi workspace overrides or modified installed packages are used. The App's single-package workspace isolates it from enclosing workspaces.

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
