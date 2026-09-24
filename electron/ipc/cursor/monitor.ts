import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { BrowserWindow } from "electron";
import { ensureNativeCursorMonitorBinary, getCursorMonitorExePath } from "../paths/binaries";
import {
	currentCursorVisualType,
	isCursorCaptureActive,
	nativeCursorMonitorOutputBuffer,
	nativeCursorMonitorProcess,
	setCurrentCursorVisualType,
	setNativeCursorMonitorOutputBuffer,
	setNativeCursorMonitorProcess,
} from "../state";
import type { CursorVisualType } from "../types";
import {
	createCaretSamplingControl,
	setActiveCaretSamplingControl,
	stopActiveCaretSamplingControl,
} from "./caretSamplingControl";
import { normalizeCaretScreenPoint, pushCaretSample } from "./caretTelemetry";
import { parseCursorMonitorLine } from "./cursorMonitorProtocol";
import { writeHelperCommand } from "./helperStdin";
import { recordCursorMouseDown, recordCursorMouseUp } from "./interaction";
import { getCursorCaptureElapsedMs, isCursorCapturePaused } from "./telemetry";

export function emitCursorStateChanged(cursorType: CursorVisualType) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("cursor-state-changed", { cursorType });
		}
	});
}

export function handleCursorMonitorStdout(chunk: Buffer) {
	setNativeCursorMonitorOutputBuffer(nativeCursorMonitorOutputBuffer + chunk.toString());
	const lines = nativeCursorMonitorOutputBuffer.split(/\r?\n/);
	setNativeCursorMonitorOutputBuffer(lines.pop() ?? "");

	for (const line of lines) {
		const message = parseCursorMonitorLine(line);
		if (!message) {
			continue;
		}

		switch (message.kind) {
			case "mouse-down":
				recordCursorMouseDown(message.button);
				break;
			case "mouse-up":
				recordCursorMouseUp();
				break;
			case "caret":
				recordCaretPosition(message.xPhysicalPixels, message.yPhysicalPixels);
				break;
			case "caret-lost":
				// Deliberately nothing. A gap in the track is how the camera is
				// told to hold the last caret it trusted, rather than jumping
				// back to the click the typing was anchored to.
				break;
			case "cursor-state":
				if (currentCursorVisualType !== message.cursorType) {
					setCurrentCursorVisualType(message.cursorType);
					// sampleCursorStateChange is called from cursor/telemetry.ts via the handler
					emitCursorStateChanged(message.cursorType);
				}
				break;
		}
	}
}

/**
 * Turns a caret position from the helper into a sample on the recording's own
 * clock. Refused positions, which are carets outside the captured area, leave
 * a gap on purpose; see the `caret-lost` case above.
 */
function recordCaretPosition(xPhysicalPixels: number, yPhysicalPixels: number) {
	if (!isCursorCaptureActive || isCursorCapturePaused()) {
		return;
	}

	const point = normalizeCaretScreenPoint({ x: xPhysicalPixels, y: yPhysicalPixels });
	if (!point) {
		return;
	}

	pushCaretSample({
		timeMs: getCursorCaptureElapsedMs(),
		cx: point.cx,
		cy: point.cy,
	});
}

export function stopNativeCursorMonitor() {
	setCurrentCursorVisualType("arrow");

	// Before the process goes, so the quiet timer cannot fire into a closed pipe.
	stopActiveCaretSamplingControl();

	if (!nativeCursorMonitorProcess) {
		return;
	}

	// Guarded for the same reason as the caret commands: this write can fail
	// asynchronously, and a try/catch around it never sees that.
	writeHelperCommand(nativeCursorMonitorProcess.stdin, "stop");
	try {
		nativeCursorMonitorProcess.kill();
	} catch {
		// ignore kill issues
	}

	setNativeCursorMonitorProcess(null);
	setNativeCursorMonitorOutputBuffer("");
}

export async function startNativeCursorMonitor() {
	stopNativeCursorMonitor();

	if (process.platform !== "darwin" && process.platform !== "win32") {
		setCurrentCursorVisualType("arrow");
		return;
	}

	try {
		let helperPath: string;
		if (process.platform === "win32") {
			helperPath = getCursorMonitorExePath();
			try {
				// Use F_OK on Windows — X_OK is meaningless and can give false positives
				await fs.access(helperPath, fsConstants.F_OK);
			} catch {
				console.warn("Windows cursor monitor helper missing:", helperPath);
				setCurrentCursorVisualType("arrow");
				return;
			}
		} else {
			helperPath = await ensureNativeCursorMonitorBinary();
		}

		setNativeCursorMonitorOutputBuffer("");
		setCurrentCursorVisualType("arrow");

		let proc: ReturnType<typeof spawn> | null;
		try {
			proc = spawn(helperPath, [], {
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (spawnError) {
			console.warn("Failed to spawn cursor monitor:", spawnError);
			setNativeCursorMonitorProcess(null);
			setCurrentCursorVisualType("arrow");
			return;
		}

		setNativeCursorMonitorProcess(proc as Parameters<typeof setNativeCursorMonitorProcess>[0]);
		const spawned = proc;
		if (!spawned) {
			setNativeCursorMonitorProcess(null);
			setCurrentCursorVisualType("arrow");
			return;
		}

		spawned.once("error", (error) => {
			console.warn("Native cursor monitor process error:", error);
			if (nativeCursorMonitorProcess === spawned) {
				setNativeCursorMonitorProcess(null);
				setNativeCursorMonitorOutputBuffer("");
				setCurrentCursorVisualType("arrow");
			}
		});

		// Caret sampling is Windows only: it is the only platform whose helper
		// knows the command, and the only one the sampler was written for.
		if (process.platform === "win32") {
			setActiveCaretSamplingControl(
				createCaretSamplingControl({
					send: (command) => {
						writeHelperCommand(spawned.stdin, command);
					},
				}),
			);
		}

		// Node turns an error event with no listener into an uncaught exception,
		// which for the main process means the whole application goes down. A
		// pipe whose reader has exited is ordinary, not exceptional.
		spawned.stdin?.on("error", () => {
			// Nothing to do: the helper has gone and is about to be replaced.
		});

		if (spawned.stdout) spawned.stdout.on("data", handleCursorMonitorStdout);
		if (spawned.stderr) {
			spawned.stderr.on("data", () => {
				// Drain stderr so helper logging cannot block the process.
			});
		}

		spawned.once("close", () => {
			// Before anything else: a pending quiet timer would otherwise fire
			// into a pipe that has gone, which is how the crash of 24 September
			// 2026 happened.
			stopActiveCaretSamplingControl();

			if (nativeCursorMonitorProcess === spawned) {
				setNativeCursorMonitorProcess(null);
				setNativeCursorMonitorOutputBuffer("");
				setCurrentCursorVisualType("arrow");
			}
		});
	} catch (error) {
		console.warn("Failed to start native cursor monitor:", error);
		setNativeCursorMonitorProcess(null);
		setNativeCursorMonitorOutputBuffer("");
		setCurrentCursorVisualType("arrow");
	}
}
