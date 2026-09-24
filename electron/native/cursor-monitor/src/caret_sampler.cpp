#include "caret_sampler.h"

#include <windows.h>

#include <oleauto.h>
#include <uiautomation.h>

#include <cstdio>
#include <string>

namespace recordly {
namespace {

// Set RECORDLY_CARET_DEBUG=1 to have the sampler say on stderr which source
// answered and which did not. The main process drains stderr and discards it,
// so this is for running the helper by hand.
bool CaretDebugEnabled() {
    static const bool enabled = GetEnvironmentVariableA("RECORDLY_CARET_DEBUG", nullptr, 0) > 0;
    return enabled;
}

void CaretDebug(const char *message) {
    if (CaretDebugEnabled()) {
        fprintf(stderr, "[caret] %s\n", message);
        fflush(stderr);
    }
}

// A caret is an empty text range, and an empty range reports no rectangles,
// which is why the range is widened to one character before it is measured.
constexpr int kSampleIntervalMs = 250;

struct CaretPoint {
    long x = 0;
    long y = 0;
};

// Release on scope exit, so an early return cannot leak a COM interface.
template <typename Interface> struct Released {
    Interface *ptr = nullptr;

    ~Released() {
        if (ptr != nullptr) {
            ptr->Release();
        }
    }

    Interface **Receive() { return &ptr; }
    Interface *operator->() const { return ptr; }
    explicit operator bool() const { return ptr != nullptr; }
};

// The first rectangle of the widened range. A range that wraps a line reports
// several; the first is the one the caret sits in.
bool FirstRectangleOf(IUIAutomationTextRange *range, CaretPoint *out) {
    SAFEARRAY *rectangles = nullptr;
    if (FAILED(range->GetBoundingRectangles(&rectangles)) || rectangles == nullptr) {
        return false;
    }

    LONG lowerBound = 0;
    LONG upperBound = 0;
    double *values = nullptr;
    bool found = false;

    if (SUCCEEDED(SafeArrayGetLBound(rectangles, 1, &lowerBound)) &&
        SUCCEEDED(SafeArrayGetUBound(rectangles, 1, &upperBound)) &&
        SUCCEEDED(SafeArrayAccessData(rectangles, reinterpret_cast<void **>(&values)))) {
        // Doubles in groups of four: left, top, width, height.
        if (upperBound - lowerBound + 1 >= 4) {
            const double left = values[0];
            const double top = values[1];
            const double width = values[2];
            const double height = values[3];

            // An application that reports an infinite or absurd rectangle is
            // reporting that it does not know, which is not a caret.
            const bool finite = _finite(left) && _finite(top) && _finite(width) && _finite(height);
            if (finite && width >= 0 && height >= 0 && width < 10000 && height < 10000) {
                out->x = static_cast<long>(left + width / 2.0);
                out->y = static_cast<long>(top + height / 2.0);
                found = true;
            }
        }
        SafeArrayUnaccessData(rectangles);
    }

    SafeArrayDestroy(rectangles);
    return found;
}

// The primary source. Answered in every application the probe tested except
// plain shell windows, and it is the only one that followed a scrolling page.
bool SampleFromTextPattern(IUIAutomation *automation, CaretPoint *out) {
    Released<IUIAutomationElement> focused;
    if (FAILED(automation->GetFocusedElement(focused.Receive())) || !focused) {
        CaretDebug("no focused element");
        return false;
    }

    Released<IUnknown> patternUnknown;
    if (FAILED(focused->GetCurrentPattern(UIA_TextPatternId, patternUnknown.Receive())) ||
        !patternUnknown) {
        CaretDebug("focused element has no text pattern");
        return false;
    }

    Released<IUIAutomationTextPattern> textPattern;
    if (FAILED(patternUnknown->QueryInterface(IID_PPV_ARGS(textPattern.Receive()))) ||
        !textPattern) {
        return false;
    }

    Released<IUIAutomationTextRangeArray> selection;
    if (FAILED(textPattern->GetSelection(selection.Receive())) || !selection) {
        return false;
    }

    int rangeCount = 0;
    if (FAILED(selection->get_Length(&rangeCount)) || rangeCount < 1) {
        CaretDebug("selection is empty");
        return false;
    }

    Released<IUIAutomationTextRange> range;
    if (FAILED(selection->GetElement(0, range.Receive())) || !range) {
        return false;
    }

    if (FAILED(range->ExpandToEnclosingUnit(TextUnit_Character))) {
        CaretDebug("could not widen the range to a character");
        return false;
    }

    return FirstRectangleOf(range.ptr, out);
}

// The fallback, and cheap at half a millisecond. It answered only in Notepad,
// the one classic Win32 application the probe tested, but where it answers it
// agrees with the text pattern exactly.
bool SampleFromClassicCaret(CaretPoint *out) {
    GUITHREADINFO info = {};
    info.cbSize = sizeof(info);

    // A thread id of zero means the foreground thread.
    if (!GetGUIThreadInfo(0, &info) || info.hwndCaret == nullptr) {
        CaretDebug("no classic caret on the foreground thread");
        return false;
    }

    const RECT &caret = info.rcCaret;
    if (caret.right <= caret.left && caret.bottom <= caret.top) {
        return false;
    }

    // rcCaret is in the client coordinates of hwndCaret, confirmed by the
    // probe of 23 September 2026 against the text pattern in Notepad.
    POINT point = {caret.left + (caret.right - caret.left) / 2,
                   caret.top + (caret.bottom - caret.top) / 2};
    if (!ClientToScreen(info.hwndCaret, &point)) {
        return false;
    }

    out->x = point.x;
    out->y = point.y;
    return true;
}

} // namespace

void RunCaretSamplerLoop(const std::function<bool()> &stop, const std::function<bool()> &sampling,
                         const LineEmitter &emit) {
    // Multithreaded, because this thread owns the blocking calls and must not
    // be pumping a message loop for the cursor shape thread's benefit.
    const HRESULT comInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comInit)) {
        return;
    }

    IUIAutomation *automation = nullptr;
    if (FAILED(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&automation)))) {
        automation = nullptr;
    }
    CaretDebug(automation != nullptr ? "ui automation ready" : "ui automation unavailable");

    bool hadCaret = false;
    CaretPoint lastReported = {};

    while (!stop()) {
        if (!sampling()) {
            if (hadCaret) {
                CaretDebug("sampling switched off");
            }
            // Leaving a burst clears the memory, so the first sample of the
            // next burst is always reported rather than deduplicated away.
            hadCaret = false;
            Sleep(kSampleIntervalMs);
            continue;
        }

        CaretPoint point = {};
        bool found = false;
        if (automation != nullptr) {
            found = SampleFromTextPattern(automation, &point);
        }
        if (!found) {
            found = SampleFromClassicCaret(&point);
        }

        if (found) {
            // Only on change: a caret that has not moved needs no sample, and
            // the reader holds the last position it was given.
            if (!hadCaret || point.x != lastReported.x || point.y != lastReported.y) {
                emit("CARET:" + std::to_string(point.x) + ":" + std::to_string(point.y));
                lastReported = point;
                hadCaret = true;
            }
        } else if (hadCaret) {
            CaretDebug("no source answered, holding the last caret");
            // Said once, on losing the caret, so the reader can tell a caret
            // that has stopped moving from an application that has stopped
            // answering.
            emit("CARET:none");
            hadCaret = false;
        }

        Sleep(kSampleIntervalMs);
    }

    CaretDebug("sampler loop ended");
    if (automation != nullptr) {
        automation->Release();
    }
    CoUninitialize();
}

} // namespace recordly
