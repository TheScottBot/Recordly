import { describe, expect, it } from "vitest";
import { normalizeCaretSamples } from "./typingTelemetryContract";

describe("normalizeCaretSamples", () => {
	it("keeps a well formed sample", () => {
		expect(normalizeCaretSamples([{ timeMs: 1_200, cx: 0.4, cy: 0.62 }])).toEqual([
			{ timeMs: 1_200, cx: 0.4, cy: 0.62 },
		]);
	});

	it("rebuilds each sample so a stray field cannot survive a round trip", () => {
		const normalized = normalizeCaretSamples([
			{ timeMs: 10, cx: 0.5, cy: 0.5, typedText: "a secret", windowTitle: "Bank" },
		]);

		expect(normalized).toEqual([{ timeMs: 10, cx: 0.5, cy: 0.5 }]);
	});

	/**
	 * A caret outside the captured area is not a caret worth following: the
	 * person has typed into another window, and clamping would pin the camera
	 * to an edge and hold it there, which reads as a stuck zoom.
	 */
	it("drops a sample outside the captured area rather than clamping it to an edge", () => {
		expect(normalizeCaretSamples([{ timeMs: 10, cx: 1.4, cy: 0.5 }])).toEqual([]);
		expect(normalizeCaretSamples([{ timeMs: 10, cx: 0.5, cy: -0.2 }])).toEqual([]);
	});

	it("drops a sample whose position is missing or not finite", () => {
		expect(
			normalizeCaretSamples([
				{ timeMs: 10, cy: 0.5 },
				{ timeMs: 20, cx: Number.NaN, cy: 0.5 },
				{ timeMs: 30, cx: 0.5, cy: Number.POSITIVE_INFINITY },
				"not a sample",
				null,
			]),
		).toEqual([]);
	});

	it("sorts by time, because the track is read as a path through the frame", () => {
		const normalized = normalizeCaretSamples([
			{ timeMs: 900, cx: 0.2, cy: 0.2 },
			{ timeMs: 100, cx: 0.1, cy: 0.1 },
		]);

		expect(normalized.map((sample) => sample.timeMs)).toEqual([100, 900]);
	});

	it("returns nothing for input that is not an array", () => {
		expect(normalizeCaretSamples(undefined)).toEqual([]);
		expect(normalizeCaretSamples({ caretSamples: [] })).toEqual([]);
	});
});
