#include <windows.h>
#include <cstdio>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>
#include <unordered_map>

#include "caret_sampler.h"

static std::atomic<bool> g_running{true};
// Off until the main process asks, because the caret is only worth sampling
// while someone is typing and only when they have allowed keyboard capture.
static std::atomic<bool> g_caretSampling{false};

// stdout is written by the cursor shape loop and the caret thread, and a torn
// line would be unparseable at the other end.
static std::mutex g_stdoutMutex;

static void emitLine(const std::string &line) {
    std::lock_guard<std::mutex> lock(g_stdoutMutex);
    std::cout << line << std::endl;
}

static void stdinListener() {
    std::string line;
    while (std::getline(std::cin, line)) {
        // getline splits on the newline and leaves the carriage return of a
        // CRLF writer behind. A writer that opens the pipe as UTF-8 puts a
        // byte order mark in front of the first line. Either one would make
        // every command match nothing, so both are taken off before the
        // comparisons rather than being assumed absent.
        if (line.rfind("\xEF\xBB\xBF", 0) == 0) {
            line.erase(0, 3);
        }
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) {
            line.pop_back();
        }

        if (line == "stop") {
            g_running.store(false);
            return;
        }
        if (line == "caret-on") {
            g_caretSampling.store(true);
            continue;
        }
        if (line == "caret-off") {
            g_caretSampling.store(false);
            continue;
        }
    }
    g_running.store(false);
}

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    // Without this Windows virtualises some coordinates and not others, so a
    // caret rectangle and a window rectangle come back in different spaces.
    // Measured on 23 September 2026: a shell reported 1464 wide where an
    // Electron window reported 2196, and 1464 times 1.5 is 2196.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    std::unordered_map<HCURSOR, std::string> cursorMap;
    cursorMap[LoadCursor(NULL, IDC_ARROW)]    = "arrow";
    cursorMap[LoadCursor(NULL, IDC_IBEAM)]    = "text";
    cursorMap[LoadCursor(NULL, IDC_HAND)]     = "pointer";
    cursorMap[LoadCursor(NULL, IDC_CROSS)]    = "crosshair";
    cursorMap[LoadCursor(NULL, IDC_NO)]       = "not-allowed";
    cursorMap[LoadCursor(NULL, IDC_SIZEWE)]   = "resize-ew";
    cursorMap[LoadCursor(NULL, IDC_SIZENS)]   = "resize-ns";
    cursorMap[LoadCursor(NULL, IDC_SIZEALL)]  = "open-hand";
    cursorMap[LoadCursor(NULL, IDC_WAIT)]     = "arrow";
    cursorMap[LoadCursor(NULL, IDC_APPSTARTING)] = "arrow";

    std::thread listener(stdinListener);
    listener.detach();

    // Its own thread: a UI Automation call against an unresponsive
    // application blocks, and the cursor shape poll must keep its 50 ms.
    std::thread caretSampler([]() {
        recordly::RunCaretSamplerLoop([]() { return !g_running.load(); },
                                      []() { return g_caretSampling.load(); }, emitLine);
    });
    caretSampler.detach();

    std::string lastType;

    while (g_running.load()) {
        CURSORINFO ci = {};
        ci.cbSize = sizeof(ci);

        if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING)) {
            auto it = cursorMap.find(ci.hCursor);
            std::string type = (it != cursorMap.end()) ? it->second : "arrow";

            if (type != lastType) {
                lastType = type;
                emitLine("STATE:" + type);
            }
        }

        Sleep(50);
    }

    return 0;
}
