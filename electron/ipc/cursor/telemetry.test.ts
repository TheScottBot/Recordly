import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURSOR_TELEMETRY_VERSION } from "../constants";

const { writeFile, rm } = vi.hoisted(() => ({
	writeFile: vi.fn(),
	rm: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		writeFile,
		rm,
	},
}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
		getAllDisplays: () => [],
	})),
}));

import { CURSOR_INTERACTION_TYPES } from "../../../src/lib/cursorTelemetryContract";
import { activeCursorSamples, setActiveCursorSamples, setCursorCaptureStartTimeMs } from "../state";
import {
	buildVersionThreeSidecar,
	buildVersionTwoSidecar,
	VERSION_THREE_KEYSTROKE_SAMPLES,
	VERSION_TWO_SIDECAR_SAMPLES,
} from "./cursorTelemetryTestFixtures";
import {
	getCursorCaptureElapsedMs,
	normalizeCursorTelemetrySamples,
	parseCursorTelemetrySidecar,
	pauseCursorCapture,
	pauseCursorCaptureAtBoundary,
	pushCursorSample,
	resetCursorCaptureClock,
	resumeCursorCapture,
	writeCursorTelemetry,
} from "./telemetry";

describe("cursor telemetry pause clock", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		setCursorCaptureStartTimeMs(1_000);
		setActiveCursorSamples([]);
		resetCursorCaptureClock();
	});

	it("subtracts paused time from elapsed cursor timestamps", () => {
		expect(getCursorCaptureElapsedMs(1_120)).toBe(120);

		pauseCursorCapture(1_200);
		expect(getCursorCaptureElapsedMs(1_450)).toBe(200);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("ignores duplicate pause or resume transitions", () => {
		pauseCursorCapture(1_150);
		pauseCursorCapture(1_250);
		resumeCursorCapture(1_500);
		resumeCursorCapture(1_650);

		expect(getCursorCaptureElapsedMs(1_900)).toBe(550);
	});

	it("drops cursor samples captured after the renderer pause boundary", () => {
		pushCursorSample(0.1, 0.1, 120, "move");
		pushCursorSample(0.2, 0.2, 205, "move");
		pushCursorSample(0.3, 0.3, 260, "move");

		pauseCursorCaptureAtBoundary(1_200);

		expect(getCursorCaptureElapsedMs(1_500)).toBe(200);
		expect(activeCursorSamples.map((sample) => sample.timeMs)).toEqual([120]);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("normalizes cursor telemetry samples before persisting them", async () => {
		const samples = normalizeCursorTelemetrySamples([
			{ timeMs: 30, cx: 2, cy: -1, interactionType: "click", cursorType: "pointer" },
			{ timeMs: -10, cx: Number.NaN, cy: 0.2, interactionType: "drag", cursorType: "ibeam" },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
		]);

		expect(samples).toEqual([
			{ timeMs: 0, cx: 0.5, cy: 0.2, interactionType: undefined, cursorType: undefined },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
			{ timeMs: 30, cx: 1, cy: 0, interactionType: "click", cursorType: "pointer" },
		]);

		await writeCursorTelemetry("/tmp/recording.mp4", samples);

		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.cursor.json",
			JSON.stringify(
				{
					version: CURSOR_TELEMETRY_VERSION,
					samples,
				},
				null,
				2,
			),
			"utf-8",
		);
		expect(rm).not.toHaveBeenCalled();
	});

	it("removes the sidecar when saving an empty cursor telemetry payload", async () => {
		await writeCursorTelemetry("/tmp/recording.mp4", []);

		expect(rm).toHaveBeenCalledWith("/tmp/recording.cursor.json", { force: true });
		expect(writeFile).not.toHaveBeenCalled();
	});
});

describe("cursor telemetry contract in the sidecar reader and writer", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
	});

	it("preserves every declared interaction value through normalisation", () => {
		// Guards against the allowlist being hand written again: if it ever
		// stops deriving from the declaration, the first value it forgets fails here.
		const samples = normalizeCursorTelemetrySamples(
			CURSOR_INTERACTION_TYPES.map((interactionType, index) => ({
				timeMs: index * 10,
				cx: 0.5,
				cy: 0.5,
				interactionType,
			})),
		);

		expect(samples.map((sample) => sample.interactionType)).toEqual([
			...CURSOR_INTERACTION_TYPES,
		]);
	});

	it("erases an interaction value that is not declared, including near misses", () => {
		const samples = normalizeCursorTelemetrySamples([
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "keydown" },
			{ timeMs: 10, cx: 0.5, cy: 0.5, interactionType: "typing" },
			{ timeMs: 20, cx: 0.5, cy: 0.5, interactionType: "KEYSTROKE" },
		]);

		expect(samples.map((sample) => sample.interactionType)).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});

	it("keeps the character producing flag only on keystroke samples and only as a boolean", () => {
		const samples = normalizeCursorTelemetrySamples([
			{
				timeMs: 0,
				cx: 0.5,
				cy: 0.5,
				interactionType: "keystroke",
				keyProducesCharacter: true,
			},
			{
				timeMs: 10,
				cx: 0.5,
				cy: 0.5,
				interactionType: "keystroke",
				keyProducesCharacter: false,
			},
			{ timeMs: 20, cx: 0.5, cy: 0.5, interactionType: "keystroke" },
			{
				timeMs: 30,
				cx: 0.5,
				cy: 0.5,
				interactionType: "keystroke",
				keyProducesCharacter: "yes",
			},
			{ timeMs: 40, cx: 0.5, cy: 0.5, interactionType: "click", keyProducesCharacter: true },
		]);

		expect(samples.map((sample) => sample.keyProducesCharacter)).toEqual([
			true,
			false,
			undefined,
			undefined,
			undefined,
		]);
	});

	it("writes the sidecar as version 3", async () => {
		await writeCursorTelemetry("/tmp/recording.mp4", VERSION_TWO_SIDECAR_SAMPLES);

		const [, writtenContent] = writeFile.mock.calls[0];
		expect(JSON.parse(writtenContent as string).version).toBe(3);
	});

	it("reads a version 2 sidecar and produces exactly the samples it produces today", () => {
		const result = parseCursorTelemetrySidecar(buildVersionTwoSidecar());

		expect(result.status).toBe("ok");
		expect(result.samples).toEqual(
			normalizeCursorTelemetrySamples(VERSION_TWO_SIDECAR_SAMPLES),
		);
		expect(result.samples).toHaveLength(VERSION_TWO_SIDECAR_SAMPLES.length);
	});

	it("round trips a version 3 sidecar carrying keystroke samples", () => {
		const result = parseCursorTelemetrySidecar(buildVersionThreeSidecar());

		expect(result.status).toBe("ok");
		expect(result.samples).toEqual(VERSION_THREE_KEYSTROKE_SAMPLES);
	});

	it("refuses a sidecar whose version is not supported and says why", () => {
		for (const unsupportedVersion of [1, 4, undefined, "3", null]) {
			const result = parseCursorTelemetrySidecar({
				version: unsupportedVersion,
				samples: VERSION_TWO_SIDECAR_SAMPLES,
			});

			expect(result).toEqual({
				status: "rejected",
				reason: "unsupported-version",
				version: unsupportedVersion,
				samples: [],
			});
		}
	});

	it("refuses a sidecar that is not an object holding a samples array", () => {
		for (const malformedSidecar of [
			null,
			42,
			"samples",
			[],
			{ version: 2 },
			{ version: 2, samples: "x" },
		]) {
			const result = parseCursorTelemetrySidecar(malformedSidecar);

			expect(result.status).toBe("rejected");
			expect(result.reason).toBe("malformed");
			expect(result.samples).toEqual([]);
		}
	});
});
