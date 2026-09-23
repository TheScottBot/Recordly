import { describe, expect, it } from "vitest";
import {
	isSupportedTypingTelemetryVersion,
	normalizeTypingEvents,
	SUPPORTED_TYPING_TELEMETRY_VERSIONS,
	TYPING_TELEMETRY_VERSION,
} from "./typingTelemetryContract";

describe("typing telemetry contract", () => {
	it("starts at version 1, because this file has never existed before", () => {
		expect(TYPING_TELEMETRY_VERSION).toBe(1);
		expect(SUPPORTED_TYPING_TELEMETRY_VERSIONS).toEqual([1]);
		expect(isSupportedTypingTelemetryVersion(1)).toBe(true);
	});

	it("does not treat an unknown, missing or non numeric version as supported", () => {
		for (const rejected of [0, 2, undefined, "1", Number.NaN, null]) {
			expect(isSupportedTypingTelemetryVersion(rejected)).toBe(false);
		}
	});

	it("keeps only the time and the character flag, because that is all a typing event may hold", () => {
		const events = normalizeTypingEvents([
			{ timeMs: 120, keyProducesCharacter: true },
			{ timeMs: 260, keyProducesCharacter: false },
			{ timeMs: 400 },
		]);

		expect(events).toEqual([
			{ timeMs: 120, keyProducesCharacter: true },
			{ timeMs: 260, keyProducesCharacter: false },
			{ timeMs: 400, keyProducesCharacter: undefined },
		]);
	});

	it("erases any field a caller tries to smuggle in beside them", () => {
		const events = normalizeTypingEvents([
			{
				timeMs: 120,
				keyProducesCharacter: true,
				keycode: 30,
				cx: 0.5,
				cy: 0.5,
				character: "a",
			},
		]);

		expect(Object.keys(events[0]).sort()).toEqual(["keyProducesCharacter", "timeMs"]);
	});

	it("repairs a time that is not a finite number and orders events by time", () => {
		const events = normalizeTypingEvents([
			{ timeMs: 300 },
			{ timeMs: -50 },
			{ timeMs: Number.NaN },
			{ timeMs: 100 },
		]);

		expect(events.map((event) => event.timeMs)).toEqual([0, 0, 100, 300]);
	});

	it("ignores anything that is not an array of objects", () => {
		expect(normalizeTypingEvents(null)).toEqual([]);
		expect(normalizeTypingEvents("events")).toEqual([]);
		expect(normalizeTypingEvents([null, 42, "x"])).toEqual([]);
	});

	it("rejects a flag that is not a boolean rather than coercing it", () => {
		const events = normalizeTypingEvents([{ timeMs: 10, keyProducesCharacter: "yes" }]);

		expect(events[0].keyProducesCharacter).toBeUndefined();
	});
});
