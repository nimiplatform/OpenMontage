# Third-party runtime components

The Backlot renderer bundles Inter, JetBrains Mono and Courier Prime from the [Google Fonts repository](https://github.com/google/fonts) under the SIL Open Font License. License texts are included in `licenses/*-OFL.txt`; fonts load locally, without a runtime Google Fonts request.

OpenMontage's root license is AGPL-3.0. Third-party components retain their own licenses; the root license does not relicense them.

The Windows media package currently contains:

| Component | Version | License and source |
| --- | --- | --- |
| Python | 3.14.4 | PSF License and bundled notices in `python/LICENSE.txt`; [release and source](https://www.python.org/downloads/release/python-3144/) |
| Node.js | 24.15.0 | MIT and third-party notices in `node/LICENSE`; [release and source](https://nodejs.org/dist/v24.15.0/) |
| Pillow | 12.3.0 | HPND and bundled dependency notices in its Python distribution metadata; [source](https://github.com/python-pillow/Pillow/tree/12.3.0) |
| jsonschema | 4.26.0 | MIT; [source](https://github.com/python-jsonschema/jsonschema) |
| PyYAML | 6.0.3 | MIT; [source](https://github.com/yaml/pyyaml) |
| Remotion | 4.0.484 | Remotion License in `licenses/REMOTION-LICENSE.md`; [exact source](https://github.com/remotion-dev/remotion/tree/v4.0.484) |
| FFmpeg and FFprobe | n7.1, bundled by Remotion 4.0.484 | GPL-2.0-or-later; `licenses/FFMPEG-GPL-2.0.txt`; [license and source information](https://www.remotion.dev/docs/miscellaneous/ffmpeg-license) |
| Media-tool FFmpeg and FFprobe | 9.0.1, Gyan essentials build | GPLv3; bundled `ffmpeg/LICENSE`; [exact build](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.1), [FFmpeg source](https://github.com/FFmpeg/FFmpeg/commit/bf1b838f2a), [build and dependency information](https://www.gyan.dev/ffmpeg/builds/) |

Python dependency notices remain in `python/Lib/site-packages/*dist-info`. Remotion and other JavaScript dependency metadata/notices remain with their packages under `app/remotion-composer/node_modules`. The supplied Chrome Headless Shell includes its own license files under `browser`.

The publisher confirmed eligibility for the Remotion Free License on 2026-09-12. Its terms continue to apply to use and redistribution; see the [license FAQ](https://www.remotion.dev/docs/license/faq). This App does not offer a general service for uploading arbitrary Remotion projects.

Remotion retains its own unchanged compositor binaries. The Python media tools use the separately bundled Gyan FFmpeg build because audio ducking, fades and other original OpenMontage tools require filters absent from Remotion's reduced build. Its license and documentation remain alongside its binaries. Redistribution must include the corresponding-source access required by the respective GPL licenses, including linked-library sources and build information; validate this distribution package before public release.

- [FFmpeg n7.1 source and license](https://github.com/FFmpeg/FFmpeg/tree/n7.1).
- [Remotion's FFmpeg source, patches and dependency build scripts](https://github.com/remotion-dev/rust-ffmpeg-splitter).
- [Exact Remotion release source](https://github.com/remotion-dev/remotion/tree/v4.0.484), which records the compositor dependencies.

Remotion documents this FFmpeg distribution as GPLv2+ and explains its use of the `fdk-aac-free` variant in the linked license page. Preserve these notices and corresponding-source directions when redistributing the package. Codec patent rights are separate from copyright licenses.
