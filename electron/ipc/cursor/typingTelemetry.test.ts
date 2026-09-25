import { beforeEach, describe, expect, it, vi } from "vitest";
import { TYPING_TELEMETRY_VERSION } from "../../../src/lib/typingTelemetryContract";

const { writeFile, rm } = vi.hoisted(() => ({
	writeFile: vi.fn(),
	rm: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: { writeFile, rm },
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp") },
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getTypingTelemetryPathForVideo: vi.fn(() => "/tmp/recording.typing.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
		getAllDisplays: () => [],
	})),
}));

import {
	activeTypingEvents,
	caretTrackTruncated,
	setActiveCaretSamples,
	setActiveTypingEvents,
	setCaretTrackTruncated,
	setPendingCaretSamples,
	setPendingTypingEvents,
} from "../state";
import { MAX_CARET_SAMPLES, pushCaretSample } from "./caretTelemetry";
import {
	parseTypingTelemetrySidecar,
	persistPendingTypingTelemetry,
	pushTypingEvent,
	snapshotTypingTelemetryForPersistence,
	writeTypingTelemetry,
} from "./typingTelemetry";

describe("typing telemetry store", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		setActiveTypingEvents([]);
		setPendingTypingEvents([]);
	});

	it("records only the time and the character flag", () => {
		pushTypingEvent(1_200, true);
		pushTypingEvent(1_350, false);
		pushTypingEvent(1_500, undefined);

		expect(activeTypingEvents).toEqual([
			{ timeMs: 1_200, keyProducesCharacter: true },
			{ timeMs: 1_350, keyProducesCharacter: false },
			{ timeMs: 1_500, keyProducesCharacter: undefined },
		]);
		for (const event of activeTypingEvents) {
			expect(Object.keys(event).sort()).toEqual(["keyProducesCharacter", "timeMs"]);
		}
	});

	it("never records a negative time", () => {
		pushTypingEvent(-40, true);

		expect(activeTypingEvents[0].timeMs).toBe(0);
	});

	it("writes the sidecar beside the recording at the current version", async () => {
		const events = [
			{ timeMs: 100, keyProducesCharacter: true },
			{ timeMs: 250, keyProducesCharacter: false },
		];

		await writeTypingTelemetry("/tmp/recording.mp4", events);

		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.typing.json",
			JSON.stringify({ version: TYPING_TELEMETRY_VERSION, events }, null, 2),
			"utf-8",
		);
	});

	it("removes the sidecar rather than writing an empty one, so absence means no typing", async () => {
		await writeTypingTelemetry("/tmp/recording.mp4", []);

		expect(rm).toHaveBeenCalledWith("/tmp/recording.typing.json", { force: true });
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("reads back a version 1 sidecar", () => {
		const result = parseTypingTelemetrySidecar({
			version: 1,
			events: [{ timeMs: 900, keyProducesCharacter: true }],
		});

		expect(result).toEqual({
			status: "ok",
			version: 1,
			events: [{ timeMs: 900, keyProducesCharacter: true }],
			// Version 1 predates both, so it reads as an empty track that was
			// never cut short.
			caretSamples: [],
			caretTrackTruncated: false,
		});
	});

	it("refuses an unsupported version and says why", () => {
		// 2 moved out of this list when the caret track was added, and 3 when
		// the truncation flag did; 4 is the next version that does not exist.
		for (const unsupportedVersion of [0, 4, undefined, "1", null]) {
			expect(
				parseTypingTelemetrySidecar({ version: unsupportedVersion, events: [] }),
			).toEqual({
				status: "rejected",
				reason: "unsupported-version",
				version: unsupportedVersion,
				events: [],
			});
		}
	});

	it("refuses a shape that is not an object holding an events array", () => {
		for (const malformed of [
			null,
			42,
			"events",
			[],
			{ version: 1 },
			{ version: 1, events: "x" },
		]) {
			const result = parseTypingTelemetrySidecar(malformed);

			expect(result.status).toBe("rejected");
			expect(result.reason).toBe("malformed");
			expect(result.events).toEqual([]);
		}
	});

	it("carries the events across the snapshot the recording stop performs", async () => {
		pushTypingEvent(100, true);
		pushTypingEvent(200, true);

		snapshotTypingTelemetryForPersistence();
		setActiveTypingEvents([]);
		await persistPendingTypingTelemetry("/tmp/recording.mp4");

		const [, written] = writeFile.mock.calls[0];
		expect(JSON.parse(written as string).events).toHaveLength(2);
	});

	it("does not write anything when the recording held no typing", async () => {
		snapshotTypingTelemetryForPersistence();
		await persistPendingTypingTelemetry("/tmp/recording.mp4");

		expect(writeFile).not.toHaveBeenCalled();
	});
});

describe("the caret track in the sidecar", () => {
	it("reads a version 2 track", () => {
		const result = parseTypingTelemetrySidecar({
			version: 2,
			events: [{ timeMs: 10, keyProducesCharacter: true }],
			caretSamples: [
				{ timeMs: 20, cx: 0.4, cy: 0.5 },
				{ timeMs: 10, cx: 0.3, cy: 0.5 },
			],
		});

		expect(result.status).toBe("ok");
		expect(result.caretSamples).toEqual([
			{ timeMs: 10, cx: 0.3, cy: 0.5 },
			{ timeMs: 20, cx: 0.4, cy: 0.5 },
		]);
	});

	it("gives a version 1 file an empty track, because it could not have had one", () => {
		const result = parseTypingTelemetrySidecar({
			version: 1,
			events: [{ timeMs: 10, keyProducesCharacter: true }],
		});

		expect(result.status).toBe("ok");
		expect(result.caretSamples).toEqual([]);
	});

	/**
	 * A caret track that cannot be read is a lost camera path, which is a
	 * degraded zoom. Throwing the typing events away with it would be a
	 * missing zoom, which is worse.
	 */
	it("drops an unreadable track without rejecting the typing events with it", () => {
		const result = parseTypingTelemetrySidecar({
			version: 2,
			events: [{ timeMs: 10, keyProducesCharacter: true }],
			caretSamples: "not an array",
		});

		expect(result.status).toBe("ok");
		expect(result.events).toHaveLength(1);
		expect(result.caretSamples).toEqual([]);
	});

	it("writes the track beside the events", async () => {
		writeFile.mockClear();
		await writeTypingTelemetry(
			"/tmp/recording.webm",
			[{ timeMs: 10, keyProducesCharacter: true }],
			[{ timeMs: 12, cx: 0.5, cy: 0.5 }],
		);

		const written = JSON.parse(writeFile.mock.calls[0][1] as string);
		expect(written.version).toBe(3);
		expect(written.caretSamples).toEqual([{ timeMs: 12, cx: 0.5, cy: 0.5 }]);
	});

	it("leaves the key out entirely when nothing was sampled", async () => {
		writeFile.mockClear();
		await writeTypingTelemetry("/tmp/recording.webm", [{ timeMs: 10 }], []);

		const written = JSON.parse(writeFile.mock.calls[0][1] as string);
		expect(written).not.toHaveProperty("caretSamples");
	});
});

describe("carrying the caret track to disk", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		setActiveTypingEvents([]);
		setPendingTypingEvents([]);
		setActiveCaretSamples([]);
		setPendingCaretSamples([]);
	});

	it("survives the snapshot the recording stop performs, as the events do", async () => {
		pushTypingEvent(100, true);
		pushCaretSample({ timeMs: 120, cx: 0.4, cy: 0.4 });
		pushCaretSample({ timeMs: 360, cx: 0.45, cy: 0.4 });

		snapshotTypingTelemetryForPersistence();
		setActiveTypingEvents([]);
		setActiveCaretSamples([]);
		await persistPendingTypingTelemetry("/tmp/recording.webm");

		const written = JSON.parse(writeFile.mock.calls[0][1] as string);
		expect(written.caretSamples).toEqual([
			{ timeMs: 120, cx: 0.4, cy: 0.4 },
			{ timeMs: 360, cx: 0.45, cy: 0.4 },
		]);
	});

	it("does not write a track for a recording that had no typing in it", async () => {
		pushCaretSample({ timeMs: 120, cx: 0.4, cy: 0.4 });

		snapshotTypingTelemetryForPersistence();
		await persistPendingTypingTelemetry("/tmp/recording.webm");

		expect(writeFile).not.toHaveBeenCalled();
	});
});

describe("a caret track that ran into the sample cap says so", () => {
	beforeEach(() => {
		writeFile.mockReset();
		rm.mockReset();
		setActiveTypingEvents([]);
		setPendingTypingEvents([]);
		setActiveCaretSamples([]);
		setPendingCaretSamples([]);
		setCaretTrackTruncated(false);
	});

	/**
	 * A track that ran out looks exactly like a track that ended, and the zoom
	 * simply stops following. Without this the difference is invisible to
	 * everyone, including whoever is asked to explain it.
	 */
	it("writes the flag when the cap discarded something", async () => {
		setCaretTrackTruncated(true);
		await writeTypingTelemetry(
			"/tmp/recording.webm",
			[{ timeMs: 10, keyProducesCharacter: true }],
			[{ timeMs: 12, cx: 0.5, cy: 0.5 }],
			true,
		);

		const written = JSON.parse(writeFile.mock.calls[0][1] as string);
		expect(written.version).toBe(3);
		expect(written.caretTrackTruncated).toBe(true);
	});

	it("leaves the flag out entirely when nothing was discarded", async () => {
		await writeTypingTelemetry(
			"/tmp/recording.webm",
			[{ timeMs: 10, keyProducesCharacter: true }],
			[{ timeMs: 12, cx: 0.5, cy: 0.5 }],
			false,
		);

		const written = JSON.parse(writeFile.mock.calls[0][1] as string);
		expect(written).not.toHaveProperty("caretTrackTruncated");
	});

	it("reads the flag back", () => {
		const result = parseTypingTelemetrySidecar({
			version: 3,
			events: [{ timeMs: 10 }],
			caretSamples: [{ timeMs: 12, cx: 0.5, cy: 0.5 }],
			caretTrackTruncated: true,
		});

		expect(result.status).toBe("ok");
		expect(result.caretTrackTruncated).toBe(true);
	});

	it("treats anything but exactly true as not truncated, including a version that predates it", () => {
		for (const stored of ["true", 1, undefined, null, 0, {}]) {
			const result = parseTypingTelemetrySidecar({
				version: 3,
				events: [{ timeMs: 10 }],
				caretTrackTruncated: stored,
			});

			expect(result.status === "ok" && result.caretTrackTruncated).toBe(false);
		}

		const versionTwo = parseTypingTelemetrySidecar({ version: 2, events: [{ timeMs: 10 }] });
		expect(versionTwo.status === "ok" && versionTwo.caretTrackTruncated).toBe(false);
	});

	it("records that the cap discarded a sample, rather than dropping it quietly", () => {
		setActiveCaretSamples(
			Array.from({ length: MAX_CARET_SAMPLES }, (_unused, index) => ({
				timeMs: index,
				cx: 0.5,
				cy: 0.5,
			})),
		);

		pushCaretSample({ timeMs: MAX_CARET_SAMPLES, cx: 0.5, cy: 0.5 });

		expect(caretTrackTruncated).toBe(true);
	});

	it("does not claim truncation while the track is still within the cap", () => {
		pushCaretSample({ timeMs: 1, cx: 0.5, cy: 0.5 });

		expect(caretTrackTruncated).toBe(false);
	});
});
