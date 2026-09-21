# Changelog

All notable changes to Recordly from the zoom on typing work onward. Earlier
releases are described on the GitHub releases page and are not reconstructed
here.

The format follows Keep a Changelog. Per tag: any contract built against,
every change to shared code since the previous tag, and which author gates
were cleared at which commit.

## Unreleased

### Contract

- Cursor telemetry sidecar version 3. Adds the `keystroke` interaction value
  and the optional `keyProducesCharacter` boolean on a sample. Version 2
  sidecars, written by every earlier release, still load unchanged. Any other
  version is refused and reported rather than loaded.

### Shared code

- `src/lib/cursorTelemetryContract.ts` is the single declaration of the
  interaction grammar, the point shape and the supported versions. The
  Electron types, the renderer types, the ambient declarations and the runtime
  allowlist all derive from it.
- `parseCursorTelemetrySidecar` is the read from disk boundary for the
  sidecar; `get-cursor-telemetry` uses it and returns a failure with the
  rejection reason instead of silently loading an unknown version.

### Added

- Keyboard capture during recording, off by default, on Windows and Linux.
  When on, each key press adds a `keystroke` sample to the cursor telemetry
  carrying the time, the pointer position and whether the key produces a
  character; never which key. Stored as `keyboardCaptureEnabled` in
  `recordings-settings.json`; the on screen control follows. See
  `PRIVACY.md`.

### Author gates cleared

None yet.
