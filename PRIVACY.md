# Privacy

What Recordly collects on your machine while it records, what it does not,
how long it keeps it, and what it cannot protect you from. Recordly is a
desktop application; nothing described here leaves your computer unless you
export or share a file yourself.

## The recording itself

A screen recording is a video of whatever was on the captured screen or
window, with microphone, system audio and webcam if you turned them on. It
contains everything visible, including anything you type into any
application while recording. That is the nature of a screen recording and
no setting changes it.

## Cursor telemetry

Beside every recording Recordly writes a sidecar file, `<recording>.cursor.json`,
so the editor can smooth the cursor, animate clicks and suggest zooms. It
holds, roughly thirty times a second:

- the time since the recording started
- the pointer position, as a fraction of the captured area
- whether that sample was a click, a double click, a right or middle click,
  a mouse release or a plain move
- the cursor shape at the time (arrow, text, pointer, and so on)

It never holds what was on screen or what was typed. Typing is not recorded
in this file at all: it has its own, described next.

## Keyboard capture

Off by default. Recordly captured no keyboard data before this setting
existed, and turning it on is your choice.

When it is on, Recordly writes a second file beside the recording,
`<recording>.typing.json`. Each key press adds one entry holding:

- the time since the recording started
- one yes or no: whether the key normally produces a character (a letter,
  digit, space, punctuation mark, Enter, Backspace or Delete) rather than
  being a modifier, arrow, function or lock key

That is all a key press holds: no position, and nothing about which key it
was. If a recording holds no typing, the file is not written at all. Recordly
does not record which key was pressed, what character it produced, which
modifiers were held, or anything from which the text you typed could be
reconstructed. The key's identity is read once, inside the capture callback,
to produce that single yes or no, and is then discarded. It is never written
to the sidecar, a log line, a crash report or a diagnostic bundle. A test
asserts this on every change.

The purpose is timing only: a burst of key presses tells the editor that you
were typing, so it can suggest a zoom onto the field you had clicked into.

This file may also hold a caret track, which does carry positions. It is
described next, and an earlier version of this page was wrong to say the
file held no position at all.

### The caret track

On Windows, while keyboard capture is on, Recordly also records where the
text caret was, but only while you are typing. Each entry holds:

- the time since the recording started
- the caret position, as a fraction of the captured area

Nothing else. It is a position, never content: Recordly asks Windows where
the caret is, not what is around it. It does not read the text of the field,
what the field is called, or the title of the window you typed into. A test
rebuilds every entry from scratch when the file is read or written, so a
field that has no business being there cannot survive a round trip however
it got in.

The file may also carry one flag saying the track ran into its own size
limit and was cut short. It records that some of the track is missing, not
anything about you, and it exists so that a zoom which stops following the
text can be explained rather than looking like a fault.

Sampling starts on your first key press and stops about two and a half
seconds after your last, so a recording is not sampled while you are not
typing. A position is recorded roughly four times a second, and only when it
has actually moved. If the caret cannot be placed inside the captured area,
which is what happens when you type into some other window, the sample is
dropped rather than stored.

The purpose is that a typing zoom can follow the text. Before this, a typing
zoom held one fixed point, taken from the click you made before you started
typing. Text moves: type enough lines and the words that began at the top of
the page finish at the bottom, with the zoom still pointed at the top. The
caret is the only thing that stays with the text, so it is what the camera
follows.

It is available on Windows only. Recordly reads the caret through the
accessibility interface Windows provides for it, falling back to the older
caret interface where that answers instead. On macOS and Linux no caret is
sampled and a typing zoom holds the click it was anchored to.

Keyboard capture off means no caret sampling either. Sampling is only ever
switched on by a key press, and with keyboard capture off there is no key
press to switch it on.

### What turning it off means

When keyboard capture is off, Recordly registers no keyboard listener at all.
It is not the case that key presses are collected and thrown away later;
they are never collected.

One honest limitation: on Windows and Linux, the library Recordly uses for
click detection (`uiohook-napi`) delivers every input event, keyboard
included, to Recordly's main process whenever a recording is in progress.
That has been true since Recordly first shipped click detection and does not
depend on this setting. With keyboard capture off, Recordly listens to none
of those keyboard events; they arrive and are dropped by the library's own
event emitter because nothing subscribed. Recordly cannot stop the library
delivering them without patching it.

On macOS the global input library is not used at all (it can freeze the
application), and keyboard capture is not yet available there.

### Where the setting lives

In the launch window, under the More menu, as "Enable typing detection" or
"Disable typing detection". It is called typing detection rather than
keyboard capture because that is what it does: it notices that typing is
happening so the editor can zoom onto the field, and it never records which
key was pressed.

It cannot be changed while a recording is in progress. The preference is
read once, when recording starts, so a change part way through would not
affect the recording being made, and a privacy control that looks like it
worked but did not would be worse than one that says it cannot be used yet.
Stop the recording to change it.

The stored value is `keyboardCaptureEnabled` in `recordings-settings.json`
in Recordly's user data folder, and only the exact value `true` turns
capture on. Anything else, including the key being absent, means off. The
control reads it through the same check the capture hook uses, so what the
menu shows and what actually happens cannot disagree; a test asserts that.

The control is not shown on macOS, where keyboard capture does not exist.

## Retention

The sidecars live next to their recording, in your recordings folder, for as
long as the recording does. Recordly can delete only its own automatic
recordings from inside the application, and when it does it deletes both
sidecars with them; the same happens when old automatic recordings are
pruned. A test asserts that the typing file goes with the recording, so
keyboard derived data cannot outlive what it came from. If you delete a
recording file yourself, the sidecars stay until you delete them too.
Nothing is uploaded.

## What this cannot protect against

If you type a password, a private message or anything else sensitive while
recording, the recording contains a video of you doing it, whether or not
keyboard capture is on. With keyboard capture on, the editor may also suggest
a zoom onto the field you were typing into, and the caret track records where
on screen that field was, because Recordly cannot tell a password field from
any other field and does not try to. Review a recording before sharing it,
and pause the recording before typing anything you would not want on screen.

The sidecars are separate files from the video, and exporting writes none
beside the exported file: an exported video carries no telemetry with it.
What that also means is that trimming or cropping in the editor does not
trim the sidecars beside the original recording. They go on describing the
whole recording as it was made, including the parts you cut. If you copy a
recordings folder somewhere, the sidecars go with it unless you leave them
behind.
