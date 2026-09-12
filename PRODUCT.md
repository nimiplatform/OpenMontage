# OpenMontage Nimi App implementation context

<!-- impeccable:product-schema 1 -->

This brief records the user's agreed implementation direction. Nimi platform semantics remain with Nimi's canonical authority; existing OpenMontage pipeline artifacts and this fork's product requirements retain their own ownership.

## Platform

web

The renderer runs inside the Desktop-supervised Electron Nimi App. The first release target is Windows x86_64.

## Users and purpose

Creators choose an OpenMontage production workflow, shape supplied material into a script and scene plan, review source/generated media, edit and compose their deliverables. The completed App should work without an external coding assistant or a manually installed development environment.

## Confirmed scope

The final goal is to replace the relevant platform/AI substrate with Nimi while retaining and presenting OpenMontage's existing product capabilities as fully as practical. Existing production workflows, tools, editing and outputs are the migration baseline. A single working explainer and a restored visual shell do not complete the product migration.

The first product flow is an image-based explainer with narration and an explicit approval before asset generation. Text, image and speech consumption use the protected Nimi Local App client; FFmpeg and Remotion stay local media tools. Nimi and OpenMontage accounts are separate. No OpenMontage registration or team roles are introduced for this integration.

## Interface direction

Preserve OpenMontage / Backlot as the product foundation: dark editorial workspace, paper screenplay, stage rail, storyboard filmstrip, project library, decisions and activity, results and revisions. Reuse the applicable code and visual language in `backlot/ui` and state aggregation in `backlot/state.py`. Kit supplies platform integration, AIConfig and suitable shared controls; it does not replace OpenMontage's identity with a generic Kit form. Chinese copy serves the current acceptance.

The Backlot project library, screenplay, stage rail, storyboard review, decisions/activity and results now replace the initial engineering form. The original pipeline catalogue and hybrid's seven stages are the next integration slice, including video, source footage and actual editing. Prototype scene-count and duration controls are not final product limits. M1 is an intermediate technical milestone. Migrating the remaining original capabilities is core work for this request, not an optional post-release extension; outstanding capability gaps must stay visible and must not be redefined away.

## Evidence and limits

Protected Nimi generation, a user-reviewed 720p narrated sample, storage, checkpoints, Job cancellation/recovery and production build/pack have passed their scoped checks. The restored Backlot UI has run a real four-scene project through editing, approval, generation, selective revision, composition, playback and export. Confirmed decisions survive revisions and refresh. Complete P2, account/session changes and formal release/installation acceptance remain unfinished. Decisions and activity reflect real product actions; costs are unavailable unless an actual source supplies them.

A basic original hybrid task has now run its seven stages with imported source video, real Nimi-generated video/image/narration, source trims, scaling/motion, local composition and project export. The user confirmed the 15-second result's moving image and narration. This validates that bounded path; the remaining original workflows and tools are still core unfinished migration work.

Source text transcription and paragraph/manual subtitle editing now extend the same Backlot workspace. A real Nimi transcription produced editable Chinese text; failed replacement requests preserve the saved result. Subtitle cues use actual narration placement/duration, support SRT/VTT export and local burn/remove, and distinguish editable preview from an already captioned output. This is paragraph timing, not automatic word alignment. Multilingual dubbing and the remaining specialized workflows stay in the migration scope.
