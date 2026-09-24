// Where the caret is, sampled while someone is typing.
//
// A typing zoom anchored to the click before the typing holds one fixed
// point, and text scrolls: type enough lines and the words that began at the
// top of the page finish at the bottom with the camera still pointed at the
// top. Following the caret is the only thing that answers that.
//
// Reports physical screen pixels. Turning those into the captured area's
// coordinates needs the display scale factor and the recorded window bounds,
// neither of which this process has, so it does not guess.
#pragma once

#include <functional>
#include <string>

namespace recordly {

// Called with a line to write to stdout. Supplied by the caller so this file
// owns no locking: stdout is shared with the cursor shape loop.
using LineEmitter = std::function<void(const std::string &)>;

// Runs until `stop` returns true. Samples only while `sampling` returns true,
// so a machine that is not being typed at pays nothing. Blocking UI
// Automation calls happen here and must not be on the cursor shape thread.
void RunCaretSamplerLoop(const std::function<bool()> &stop,
                         const std::function<bool()> &sampling,
                         const LineEmitter &emit);

} // namespace recordly
