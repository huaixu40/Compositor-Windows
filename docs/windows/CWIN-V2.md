# Compositor Windows project v2

This is the Windows adaptation's independent format. Robbie Tilton's original
macOS `.comp` format and schema are unchanged.

## Container

`.cwin` v2 is a ZIP containing `manifest.json` and flat resources under `assets/`.
The writer uses stored ZIP entries (PNG is already compressed). The reader also
accepts deflated entries. v1 JSON documents remain readable; save upgrades to a
new v2 copy, and the desktop refuses to overwrite an imported source path.
Older Windows releases cannot read v2.

Required manifest fields:

```json
{
  "format": "com.compositor.windows",
  "version": 2,
  "colorSpace": "legacy-srgb",
  "width": 1600,
  "height": 1000,
  "name": "Untitled",
  "layers": [],
  "assets": {
    "assets/r1.png": { "size": 1234, "sha256": "64 lowercase hex characters" }
  }
}
```

`layers` are ordered front to back. Each retains the v1 id, name, position,
scale, rotation, flip, opacity, blend, visibility, maskEnabled, filters and
optional adjustment fields. `image` and `mask` now reference PNG resources or
are null. `children` retains hierarchy. Optional document `selection` references
a document-sized coverage PNG. Masks preserve the existing grayscale semantics.

## Original resources and future semantic content

Optional layer `highPrecision` stores `width`, `height`, `channels: 4`,
`type: "uint16" | "float32"`, `byteOrder: "little-endian"` and a `.bin` resource.
Pixels are tightly packed RGBA in row-major order; Float32 samples must be finite.
Windows x64 writes little-endian native typed arrays. Missing byteOrder from early
development files is interpreted as little-endian; other orders are rejected.
The PNG preview and original data are separate; saving never substitutes one for
the other. Original arrays are immutable across history snapshots: future
development jobs must replace arrays, not mutate shared resources.

Optional `raw` stores original bytes via `resource`, filename/decoder metadata
and development `parameters`. Optional `text`, `path`, `effects`, and `warp` JSON
are preserved but have no supported editing/rendering schema in 0.4. Preservation
of these fields does **not** imply corresponding tool or PSD support. RAW decode
and high-precision processing remain future work. Export uses the 8-bit preview
and warns when a document contains original high-precision/RAW resources.

## Validation and limits

- Archive and cumulative uncompressed resources: 512 MiB; each entry: 256 MiB;
  manifest: 8 MiB; at most 2500 entries. Only `manifest.json` and flat alphanumeric,
  underscore/hyphen `.png` or `.bin` asset paths are allowed. Duplicate entries,
  extra unlisted resources, missing data and size/SHA256 mismatches are rejected.
- The decoder validates image dimensions before decoding: at most 8192 px per
  side / 16 MP per image, 64 MP combined preview and mask pixels, 500 layers,
  nesting 32. Additional original data is constrained by the resource byte limit.
- Each semantic metadata field is limited to 1 million JSON characters.
- Hashes detect corrupt resources; they are not a publisher signature.
- ZIP/PSD processing runs in a dedicated disposable Worker with a 120-second
  timeout. Cancellation terminates it; file output is written only after a complete
  result and document revision check. Desktop output uses a temporary file followed
  by rename. Failed parsing leaves the current document in place.

Implementation: `windows/src/project-v2.js`, `windows/src/jobs/worker.js` and
`windows/src/formats.js`. See `windows/test/render-project.cjs` for round trips,
high-precision fixtures, corruption rejection and cancellation checks.
