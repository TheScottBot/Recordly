import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
		setPath: vi.fn(),
		isReady: vi.fn(() => true),
	},
}));

// The keyboard capture tests write a real sidecar into a temporary directory,
// so the path the writer resolves is set per test through this holder.
const telemetryPathHolder = vi.hoisted(() => ({
	path: "/tmp/recording.cursor.json",
	typingPath: "/tmp/recording.typing.json",
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => telemetryPathHolder.path),
	getTypingTelemetryPathForVideo: vi.fn(() => telemetryPathHolder.typingPath),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 50, y: 50 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 100, height: 100 } }),
		getAllDisplays: () => [],
	})),
}));

import {
	activeCursorSamples,
	activeTypingEvents,
	setActiveCursorSamples,
	setActiveTypingEvents,
	setCursorCaptureStartTimeMs,
	setIsCursorCaptureActive,
} from "../state";
import { createFakeUiohookModule } from "./fakeUiohookModule";
import {
	repairBundledUiohookBinaryForCurrentArch,
	shouldStartGlobalInteractionHook,
	startInteractionCapture,
	stopInteractionCapture,
} from "./interaction";
import { pauseCursorCapture, resetCursorCaptureClock, resumeCursorCapture } from "./telemetry";
import { writeTypingTelemetry } from "./typingTelemetry";

describe("shouldStartGlobalInteractionHook", () => {
	it("does not start the synchronous uiohook event tap on macOS", () => {
		expect(shouldStartGlobalInteractionHook("darwin")).toBe(false);
	});

	it("keeps global interaction capture enabled on Windows and Linux", () => {
		expect(shouldStartGlobalInteractionHook("win32")).toBe(true);
		expect(shouldStartGlobalInteractionHook("linux")).toBe(true);
	});
});

describe("repairBundledUiohookBinaryForCurrentArch", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots
				.splice(0)
				.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })),
		);
	});

	it("promotes the bundled darwin-arm64 prebuild over a stale incompatible build", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const prebuildPath = path.join(packageRoot, "prebuilds", "darwin-arm64", "node.napi.node");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(prebuildPath), { recursive: true });
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(prebuildPath, "arm64-prebuild");
		await fs.writeFile(buildPath, "x64-build");

		const log = vi.fn();
		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(
				new Error(
					"mach-o file, but is an incompatible architecture (have 'x86_64', need 'arm64')",
				),
				{
					code: "ERR_DLOPEN_FAILED",
				},
			),
			{ packageRoot, platform: "darwin", arch: "arm64", log },
		);

		expect(repaired).toBe(true);
		expect(await fs.readFile(buildPath, "utf8")).toBe("arm64-prebuild");
		expect(log).toHaveBeenCalledWith(
			"[CursorTelemetry] Repaired stale uiohook-napi binary using bundled darwin-arm64 prebuild.",
		);
	});

	it("does not rewrite binaries for unrelated load failures", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-uiohook-"));
		tempRoots.push(tempRoot);

		const packageRoot = path.join(tempRoot, "uiohook-napi");
		const buildPath = path.join(packageRoot, "build", "Release", "uiohook_napi.node");
		await fs.mkdir(path.dirname(buildPath), { recursive: true });
		await fs.writeFile(buildPath, "existing-build");

		const repaired = repairBundledUiohookBinaryForCurrentArch(
			Object.assign(new Error("some other dlopen failure"), {
				code: "ERR_DLOPEN_FAILED",
			}),
			{ packageRoot, platform: "darwin", arch: "arm64" },
		);

		expect(repaired).toBe(false);
		expect(await fs.readFile(buildPath, "utf8")).toBe("existing-build");
	});
});

describe("keyboard capture through the global interaction hook", () => {
	const CAPTURE_STARTED_AT_MS = 10_000;
	// Distinctive numbers, so a leaked keycode is recognisable wherever it lands.
	const FAKE_KEY_TABLE = { A: 7_301, Space: 7_357, Ctrl: 7_329, ArrowLeft: 7_419 };
	const FAKE_HOOK_TIME = 987_654;
	const LEAKED_KEY_IDENTITY =
		/7301|7357|7329|7419|987654|keycode|shiftKey|altKey|ctrlKey|metaKey|"time"/;
	const tempRoots: string[] = [];

	beforeEach(() => {
		vi.useFakeTimers({ now: CAPTURE_STARTED_AT_MS });
		setIsCursorCaptureActive(true);
		setActiveCursorSamples([]);
		setActiveTypingEvents([]);
		setCursorCaptureStartTimeMs(CAPTURE_STARTED_AT_MS);
		resetCursorCaptureClock();
	});

	afterEach(async () => {
		stopInteractionCapture();
		setIsCursorCaptureActive(false);
		vi.useRealTimers();
		vi.restoreAllMocks();
		await Promise.all(
			tempRoots
				.splice(0)
				.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })),
		);
	});

	async function startCaptureWithFakeHook(keyboardCaptureEnabled: boolean | undefined) {
		const fakeModule = createFakeUiohookModule(FAKE_KEY_TABLE);
		await startInteractionCapture({
			platform: "win32",
			keyboardCaptureEnabled,
			loadModuleNamespace: () => fakeModule.namespace,
		});
		return fakeModule;
	}

	it("registers no keyboard listener when keyboard capture is off, which is the default", async () => {
		const fakeModuleWithDefault = await startCaptureWithFakeHook(undefined);
		expect(fakeModuleWithDefault.registeredEventNames()).toEqual(["mousedown", "mouseup"]);
		stopInteractionCapture();

		const fakeModuleWithExplicitOff = await startCaptureWithFakeHook(false);
		expect(fakeModuleWithExplicitOff.registeredEventNames()).toEqual(["mousedown", "mouseup"]);
	});

	it("registers a keydown listener beside the mouse listeners only when keyboard capture is on", async () => {
		const fakeModule = await startCaptureWithFakeHook(true);

		expect(fakeModule.registeredEventNames()).toEqual(["mousedown", "mouseup", "keydown"]);
		expect(fakeModule.startCallCount).toBe(1);
	});

	it("removes the keydown listener and stops the hook on cleanup", async () => {
		const fakeModule = await startCaptureWithFakeHook(true);

		stopInteractionCapture();

		expect(fakeModule.registeredEventNames()).toEqual([]);
		expect(fakeModule.stopCallCount).toBe(1);
	});

	it("records a typing event carrying only the time and the character flag", async () => {
		const fakeModule = await startCaptureWithFakeHook(true);
		vi.setSystemTime(CAPTURE_STARTED_AT_MS + 500);

		fakeModule.emit("keydown", {
			keycode: FAKE_KEY_TABLE.A,
			altKey: false,
			time: FAKE_HOOK_TIME,
		});
		fakeModule.emit("keydown", {
			keycode: FAKE_KEY_TABLE.Ctrl,
			ctrlKey: true,
			time: FAKE_HOOK_TIME,
		});

		// Nothing reaches the cursor telemetry: typing is not a cursor sample.
		expect(activeCursorSamples).toHaveLength(0);
		expect(activeTypingEvents).toEqual([
			{ timeMs: 500, keyProducesCharacter: true },
			{ timeMs: 500, keyProducesCharacter: false },
		]);
		for (const event of activeTypingEvents) {
			expect(Object.keys(event).sort()).toEqual(["keyProducesCharacter", "timeMs"]);
		}
	});

	it("does not record a keystroke when capture is inactive or paused", async () => {
		const fakeModule = await startCaptureWithFakeHook(true);

		pauseCursorCapture(CAPTURE_STARTED_AT_MS + 100);
		fakeModule.emit("keydown", { keycode: FAKE_KEY_TABLE.A });
		expect(activeTypingEvents).toHaveLength(0);

		resumeCursorCapture(CAPTURE_STARTED_AT_MS + 300);
		setIsCursorCaptureActive(false);
		fakeModule.emit("keydown", { keycode: FAKE_KEY_TABLE.A });
		expect(activeTypingEvents).toHaveLength(0);
	});

	it("stamps keystrokes with the capture clock, so paused time is excluded", async () => {
		const fakeModule = await startCaptureWithFakeHook(true);

		pauseCursorCapture(CAPTURE_STARTED_AT_MS + 200);
		resumeCursorCapture(CAPTURE_STARTED_AT_MS + 700);
		vi.setSystemTime(CAPTURE_STARTED_AT_MS + 1_000);
		fakeModule.emit("keydown", { keycode: FAKE_KEY_TABLE.Space });

		expect(activeTypingEvents.map((event) => event.timeMs)).toEqual([500]);
	});

	it("writes a sidecar in which nothing derived from key identity appears", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-keystroke-"));
		tempRoots.push(tempRoot);
		telemetryPathHolder.typingPath = path.join(tempRoot, "recording.typing.json");
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const fakeModule = await startCaptureWithFakeHook(true);

		for (const keycode of [FAKE_KEY_TABLE.A, FAKE_KEY_TABLE.Space, FAKE_KEY_TABLE.ArrowLeft]) {
			vi.setSystemTime(Date.now() + 100);
			fakeModule.emit("keydown", { keycode, time: FAKE_HOOK_TIME, shiftKey: true });
		}
		await writeTypingTelemetry(path.join(tempRoot, "recording.mp4"), activeTypingEvents);

		const writtenSidecar = await fs.readFile(telemetryPathHolder.typingPath, "utf8");
		expect(writtenSidecar).not.toMatch(LEAKED_KEY_IDENTITY);
		for (const event of JSON.parse(writtenSidecar).events) {
			expect(Object.keys(event).sort()).toEqual(["keyProducesCharacter", "timeMs"]);
		}
		const everyLoggedArgument = [...consoleLog.mock.calls, ...consoleWarn.mock.calls].flat();
		expect(JSON.stringify(everyLoggedArgument)).not.toMatch(LEAKED_KEY_IDENTITY);
	});
});
