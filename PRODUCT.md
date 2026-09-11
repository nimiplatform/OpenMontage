# OpenMontage Nimi App implementation context

<!-- impeccable:product-schema 1 -->

This brief records the user's agreed implementation direction. Nimi platform semantics remain with Nimi's canonical authority; existing OpenMontage pipeline artifacts and this fork's product requirements retain their own ownership.

## Platform

web

The renderer runs inside the Desktop-supervised Electron Nimi App. The first release target is Windows x86_64.

## Users and purpose

Creators turn supplied material into an explainer video through a proposal, scene review, AI image/voice generation and local composition. The completed App should work without an external coding assistant or a manually installed development environment.

## Confirmed scope

The first product flow is an image-based explainer with narration and an explicit approval before asset generation. Text, image and speech consumption use the protected Nimi Local App client; FFmpeg and Remotion stay local media tools. Nimi and OpenMontage accounts are separate. No OpenMontage registration or team roles are introduced for this integration.

## Interface direction

Extend the existing Nimi Kit interface with the production flow described in the accepted plan. Use Kit controls and the OpenMontage name/assets. The task is implementation, not a rebrand or a new visual-concept exercise. Chinese copy serves the current development acceptance; further locale coverage is not yet verified.

## Evidence and limits

The official base shell builds and has been launched through Desktop. The local media worker has rendered real fixture inputs to a valid 720p MP4. These are separate from Nimi AI generation and from formal release/installation acceptance, which remain unverified.
