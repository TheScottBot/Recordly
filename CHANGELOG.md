# Changelog

All notable changes to Recordly from the zoom on typing work onward. Earlier
releases are described on the GitHub releases page and are not reconstructed
here.

The format follows Keep a Changelog. Per tag: any contract built against,
every change to shared code since the previous tag, and which author gates
were cleared at which commit.

## Unreleased

### Contract

- Typing telemetry sidecar, `<recording>.typing.json`, version 1. Holds one
  entry per key press: the time since the recording started, and whether the
  key produces a character. No position, and nothing about which key. Absent
  when a recording holds no typing. Deleted with its recording.
- The cursor telemetry sidecar is unchanged at version 2. Typing was added
  without touching it, so every recording ever made reads and writes the same
  shape. A version it does not know is now refused and reported rather than
  loaded.

### Shared code

- `src/lib/cursorTelemetryContract.ts` is the single declaration of the
  interaction grammar, the point shape and the supported versions. The
  Electron types, the renderer types, the ambient declarations and the runtime
  allowlist all derive from it.
- `parseCursorTelemetrySidecar` is the read from disk boundary for the
  sidecar; `get-cursor-telemetry` uses it and returns a failure with the
  rejection reason instead of silently loading an unknown version.
- `src/components/video-editor/timeline/typingBurstUtils.ts` groups
  typing events into bursts and gives a burst the focus of the
  left or double click that preceded it within 2500 ms, or no focus at all.
  Not yet wired into zoom suggestions.
- `src/components/video-editor/timeline/timeGapClustering.ts` is the gap
  clustering rule shared by click clusters and typing bursts.

### Added

- Keyboard capture during recording, off by default, on Windows and Linux.
  When on, each key press adds one entry to the recording's typing sidecar
  carrying the time and whether the key produces a character; never which
  key, and never a position. Stored as `keyboardCaptureEnabled` in
  `recordings-settings.json`; the on screen control follows. See
  `PRIVACY.md`.
- Zoom suggestions now cover typing. A burst of typing gets its own zoom
  region beside the click that anchored it, focused on that click and drawn
  in pink on the timeline, labelled Typing, so it reads differently from the
  purple a click produces. Typing never changes a click region: it takes only
  the room left beside one. Typing after a pause of up to ten seconds keeps
  the field it was typing into. A burst with no click to anchor it produces
  no suggestion. A recording with no typing produces exactly the suggestions
  it did before, pinned by a byte identical regression test.

### Author gates cleared

None yet.
