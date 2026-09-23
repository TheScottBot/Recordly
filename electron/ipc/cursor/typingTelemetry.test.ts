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

import { activeTypingEvents, setActiveTypingEvents, setPendingTypingEvents } from "../state";
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

	it("writes the sidecar beside the recording, at version 1", async () => {
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
		});
	});

	it("refuses an unsupported version and says why", () => {
		for (const unsupportedVersion of [0, 2, undefined, "1", null]) {
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
