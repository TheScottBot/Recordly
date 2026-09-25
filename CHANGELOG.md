# Changelog

All notable changes to Recordly from the zoom on typing work onward. Earlier
releases are described on the GitHub releases page and are not reconstructed
here.

The format follows Keep a Changelog. Per tag: any contract built against,
every change to shared code since the previous tag, and which author gates
were cleared at which commit.

## Unreleased

### Contract

- Typing telemetry sidecar, `<recording>.typing.json`, version 3. Holds one
  entry per key press: the time since the recording started, and whether the
  key produces a character. Nothing about which key. Absent when a recording
  holds no typing. Deleted with its recording.
- Version 2 adds `caretSamples`, a caret track: the time and the caret
  position as a fraction of the captured area, sampled only while typing.
  The key is left out entirely when nothing was sampled, so its presence
  means a track exists. Version 1 is still read and has no track.
- Version 3 adds `caretTrackTruncated`, written only when the sample cap
  discarded part of the track. A track that ran out is otherwise
  indistinguishable from one that ended, and the zoom simply stops
  following. Versions 1 and 2 are still read and cannot say it.
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
- `electron/ipc/cursor/cursorMonitorProtocol.ts` is the single parser for
  the lines `cursor-monitor` speaks, so the grammar can be tested without
  a spawned process. The monitor no longer carries its own expressions.
- `locateDipPointInCapturedArea` in `electron/ipc/cursor/telemetry.ts` is
  the one mapping from a screen point into the captured area, shared by the
  pointer and the caret so the two can never disagree about where a point in
  the frame is. The pointer clamps at the edge and the caret refuses, which
  is the only difference between them.
- `src/components/video-editor/videoPlayback/caretFollowCamera.ts` decides
  where a typing zoom looks. Pure and deterministic, folded from the start of
  the region on every call rather than carried between frames, because the
  preview and all three export renderers share it.

### Fixed

- A typing zoom no longer drifts to the mouse. Zoom regions follow the
  pointer while zoomed, which is right after a click and wrong during typing,
  when the pointer is parked wherever it was left. A typing region now
  follows the caret instead, in the preview and in every export path, and
  holds the focus it anchored to where there is no caret track to follow.
- The application no longer crashes with an uncaught EPIPE when a recording
  ends. Caret sampling writes commands to the helper's standard input, and a
  write to a pipe whose reader has exited fails asynchronously: it does not
  throw, so a try/catch around the call never sees it, and the stream emits
  an error that becomes an uncaught exception in the main process. Writes now
  go through one guarded helper, the stream has an error listener, and a
  pending quiet timer is cancelled when the helper closes rather than firing
  into a pipe that has gone.
- A burst of typing takes its focus from the caret where there is one, and no
  longer needs a click before it at all. The rule that a burst without a
  preceding click has no trustworthy focus was written when a click was the
  only evidence available; a caret track is better evidence, because a click
  is a guess that someone clicked into the field they then typed in. On the
  author's recording this recovered a burst that had been refused a zoom
  outright, and moved every other typing zoom off a click at the very bottom
  edge of the screen and onto the text. A recording with no track behaves
  exactly as it did.
- Exports follow the caret. The track reached the preview and no export at
  all: every export path hands its configuration to a renderer by copying
  fields one at a time, and the track was added to all three configuration
  types and to none of the three copies, which compiles perfectly. What the
  camera needs is now declared once in `cameraInputs.ts` and spread, so a new
  camera input reaches every path or none of them.
- A typing zoom opens already pointed at the text. It used to open on the
  click that anchored the typing and then move to where the caret actually
  was, which read as the zoom going to the middle and then centring on the
  typing. A zoom now aims at the first caret of its region from the moment it
  opens, the way a click zoom is already aimed at a click that has not
  happened yet. On the author's recording all three typing zooms now open
  exactly where they settle, against a slide of about a quarter of the frame
  before.
- A typing zoom no longer lurches once it is under way, and no longer crawls
  either. The camera used to relocate onto a caret sample in a single frame,
  measured at 0.249 of the frame in one frame of preview. A fixed speed limit
  fixed that and introduced the opposite fault: selecting a page of text and
  typing over it does not move the caret from the bottom to the top, it stops
  being at the bottom, and a camera that crawled across missed what was being
  typed. The camera's speed now rises with how far it has to go, so it covers
  any gap in about a quarter of a second: a small correction is gentle in
  absolute terms and a long relocation is quick, with a floor so the last
  sliver closes and a ceiling so nothing becomes a teleport.
- A typing zoom no longer begins before the typing does. Typing regions
  padded half a second ahead of the first key press, copied from click
  behaviour where it belongs: a click zoom settles before the click lands,
  and the pointer travelling to a target makes that early move read as
  intent. Nothing moves on screen before a key press, so the same padding
  read as a fault. The pad after the last key press stays.

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
- A typing zoom can be dragged to a different focus, since its position is
  inferred from the click before the typing rather than known. Dragging one
  marks it as chosen by hand, so nothing moves it afterwards.
- Typing detection can be turned on and off from the launch window, under
  the More menu, in all eleven locales. It is called typing detection rather
  than keyboard capture because that is what it does. The control cannot be
  changed while a recording is in progress, since the preference is read once
  when recording starts, and it is not shown on macOS where no keyboard
  capture exists. It reads the stored value through the same check the
  capture hook applies, so the menu and the behaviour cannot disagree.
- Caret tracking on Windows, behind the same keyboard capture setting. While
  someone is typing, `cursor-monitor.exe` samples the caret about four times
  a second on its own thread and reports it when it moves; the main process
  places it in the captured area and stores it in the typing sidecar.
  Sampling starts on the first key press and stops two and a half seconds
  after the last, so nothing is sampled while nobody is typing. A caret that
  cannot be placed inside the captured area is dropped rather than stored.
  See `PRIVACY.md`.
- A typing zoom follows the caret, which is what lets it stay with text that
  scrolls. It does not glue itself to the caret: it holds while the caret is
  comfortably inside the frame and moves only when the caret would otherwise
  leave it, by the least it can. A zoom whose focus was dragged by hand is
  not moved by the track, and a recording with no track holds its click
  anchor exactly as before.

### Author gates cleared

- Typing that carries on past a click gets a zoom again. A burst was shrunk
  to the first free stretch ahead of it and never split, so one click in the
  middle silenced every word typed after it. Switching window or browser tab
  is a click, so typing, switching, and typing again is the ordinary case
  rather than an edge one. A burst now fills every stretch left free between
  the click regions, and each stretch takes its focus from the caret inside
  it, so a burst carried across a tab switch no longer points at the tab it
  started in.
- The editor now says what the typing path did, when there is something to
  say. Suggesting zooms reports a typing moment that produced no zoom because
  nothing recorded where the typing was, a typing zoom shortened to make room
  for a click zoom, and a caret track that hit its limit. Those counts have
  been gathered since typing zooms existed and had never been shown to
  anybody. Silence where everything worked.
- An exported recording follows the caret exactly as the preview does.
  Checked on 24 September 2026 by re-rendering a GIF that had not followed
  the page down when Enter pushed the caret to the bottom.
- Typing that continues after a click, a window change or a browser tab
  change keeps its zoom. Checked on 25 September 2026 against a recording of
  typing, switching tab, and typing again three times over: three bursts,
  three zooms, none declined, each pointed at the text it belonged to.
- A typing zoom begins where the text is, moves as the text moves, and keeps
  up when the text is replaced. Checked on 24 September 2026 across typing
  that scrolls a page, selecting a page and typing over it, and swapping
  between tabs while typing. Five bursts in that recording, five zooms, none
  declined.
- A typing zoom follows text that scrolls. Checked on 24 September 2026
  against a recording of typing past the bottom of a window: the camera held
  while the caret walked down inside the dead zone, panned as it raced to the
  bottom, then held for the last three and a half seconds while the page
  scrolled under a caret pinned in place.
- The typing sidecar holds nothing it should not. Checked against the bytes
  of a real recording on 24 September 2026, not against the documentation:
  every key in the file at any depth was `version`, `events`, `timeMs`,
  `keyProducesCharacter`, `caretSamples`, `cx` and `cy`.
