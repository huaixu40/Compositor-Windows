# Windows 0.4 preview validation

Date: 2026-10-27. Windows x64, Electron 44.8.0 / Chromium 152,
NVIDIA GeForce RTX 4060 Laptop GPU (8188 MiB). Original author and license:
Robbie Tilton / Compositor, Copyright (c) 2026 Wonder Assembly LLC, MIT.
This is an unofficial adaptation, not an upstream release.

## Automated evidence

Source and portable builds run the same suites:

| Suite | Result | Evidence |
|---|---|---|
| Existing PSD, edit, history, language and file protection regressions | 21 / 21 | `validation-source-v0.4.0.json`, `validation-v0.4.0.json` |
| Actual Electron mouse/keyboard/clipboard interactions | 14 / 14 | `interaction-source-v0.4.0.json`, `interaction-portable-v0.4.0.json` |
| GPU, project v2, Worker jobs, cancellation and recovery | 44 / 44 | `render-source-v0.4.0.json`, `render-portable-v0.4.0.json` |

The rendering suite obtains an actual NVIDIA adapter, compares 16 blend modes,
groups/masks, seven GPU filters plus the Canvas blur compatibility path, and four
PSD adjustment types. It checks unchanged frames redraw zero tiles and a small
move redraws one tile. A 30-filter stack allocates only two intermediate textures.

Device loss uses an actual WebGPU device destroy. Allocation failure and adapter
unavailability are injected failures, not forced machine-wide VRAM exhaustion.
They retain document pixels/history and permit retry. The real Cancel button is
tested against a controlled pending job; a separate real ZIP Worker task is
canceled during progress. A real layer-name edit invalidates a controlled pending
result. This split makes races repeatable; it is not a large-document stress test.

v2 checks exact Uint16/Float32 values, independent RAW fixture bytes, semantic
metadata, v1 migration without changing the source, and corrupt-resource rejection.
RAW test bytes are synthetic, not a decodable camera sample. Background PSD
import/export and PNG export are compared to CPU pixels. Settings survive reload.

## Rendering accuracy and performance

All comparisons use premultiplied RGBA, values 0–255. Blend fixture maximum
difference is 1.2; filter fixtures are below 2.48. The rotated-edge fixture has
maximum 11, mean 0.0141 and 23 channels differing by more than 3. Its test limit
is max 16 / mean 0.1. See `rotated-edge-v0.4.0.png` (CPU, GPU, difference ×8).
CPU compatibility mode and exported files retain the previous Canvas reference.
This is not a claim of pixel-identical Metal, Core Image or Photoshop rendering.

`performance-v0.4.0.json` records an actual 120-step mouse drag over a 1920×1080
five-layer sample, including exposure filters, in a 1950×1092 CSS viewport at
DPR 1.5. Source run: 189 received pointer moves / 189 changed GPU submissions,
71.88 updates/s; p95 CPU submission 0.5 ms, queue completion 4.6 ms. This sample
meets the 30 updates/s target. The approximately 240 Hz RAF cadence is display
timing, **not** editor rendering throughput. It does not establish performance
for every document, selection, tool, fallback or machine.

Estimated editor texture allocation: 26,058,752 bytes. Process memory and an
`nvidia-smi` snapshot are in the report. System GPU usage includes other apps;
GPU-process working set/private bytes are not per-editor VRAM measurements.

## Scope and remaining checks

- WebGPU implements the Windows compositor, masks, blends, transforms and seven
  filters; blur remains Canvas for legacy appearance. Export uses CPU in a Worker.
  Complex group changes currently redraw all tiles; source textures are not
  virtualized. CPU fallback and large blur work can still stall live edits.
- Worker jobs cover PSD read/write, image export, ZIP packing and validation.
  Preview PNG encoding and bitmap preparation are asynchronous on the UI side.
  File jobs block editing but keep cancellation available and check revisions.
- High-precision/original resources are preserved; current editing/display stays
  8-bit. Camera RAW decoding and development are not implemented in 0.4.
- Chinese text insertion is verified. Native Windows IME candidate-window behavior
  has not been manually accepted. Other GPUs and Windows devices are untested.
- **未完成 Adobe Photoshop 实机互操作验收。** PSD remains 8-bit RGB; no PSB,
  CMYK or full ICC support. Text/path/effects imports retain 0.3 conversion notices.
- Stages 0.5–0.7 (editable text, paths, perspective/mesh transforms, RAW, healing,
  local segmentation and ten effects) remain pending. No empty enabled tools are
  presented as implemented features.

## Reproduction

From `windows/`: `npm ci`, `npm test`, `npm run test:interaction`,
`npm run test:render`, `npm run test:performance`, `npm run package`.
Run the portable exe with `--self-test`; set `COMPOSITOR_EXE` to that exe for
the interaction, rendering and benchmark scripts. Test profiles are isolated.
The release includes notices, usage instructions, validation reports and a
SHA256 checksum file beside its ZIP. Keep previous releases and source files.
