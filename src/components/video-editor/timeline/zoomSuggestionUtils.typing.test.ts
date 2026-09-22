import { describe, expect, it } from "vitest";
import {
	makeClick,
	makeKeystroke,
	makeMove,
	makeTypingRun,
	withMoves,
} from "./telemetryTestFixtures";
import { buildInteractionZoomSuggestions } from "./zoomSuggestionUtils";

const TOTAL_MS = 30_000;

type SuggestionInput = Parameters<typeof buildInteractionZoomSuggestions>[0];

/**
 * Click only inputs and the exact output the engine produced for each before
 * typing existed, captured from the untouched module on 21 September 2026
 * with the same fixtures. The strings are the contract: a recording with no
 * typing must produce these bytes, whatever the typing path does.
 */
const CLICK_ONLY_BASELINE: Array<{ name: string; input: SuggestionInput; expected: string }> = [
	{
		name: "emptyTelemetry",
		input: { cursorTelemetry: [], totalMs: TOTAL_MS, defaultDurationMs: 2_000 },
		expected: '{"status":"no-telemetry","suggestions":[]}',
	},
	{
		name: "zeroDuration",
		input: {
			cursorTelemetry: withMoves([makeClick(1_000)], 0),
			totalMs: 0,
			defaultDurationMs: 2_000,
		},
		expected: '{"status":"no-slots","suggestions":[]}',
	},
	{
		name: "movesOnly",
		input: {
			cursorTelemetry: withMoves(
				[makeMove(500, 0.2, 0.2), makeMove(900, 0.7, 0.7)],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		},
		expected: '{"status":"no-interactions","suggestions":[]}',
	},
	{
		name: "singleClick",
		input: {
			cursorTelemetry: withMoves([makeClick(5_000, 0.25, 0.75)], TOTAL_MS),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		},
		expected:
			'{"status":"ok","suggestions":[{"start":4500,"end":5500,"focus":{"cx":0.25,"cy":0.75}}]}',
	},
	{
		name: "twoClustersMixedKinds",
		input: {
			cursorTelemetry: withMoves(
				[
					makeClick(2_000, 0.1, 0.1),
					makeClick(2_300, 0.12, 0.11, "double-click"),
					makeClick(3_500, 0.4, 0.4, "right-click"),
					makeClick(9_000, 0.8, 0.2),
					makeClick(9_400, 0.81, 0.21, "mouseup"),
					makeClick(10_500, 0.6, 0.6, "middle-click"),
				],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		},
		expected:
			'{"status":"ok","suggestions":[{"start":1500,"end":4000,"focus":{"cx":0.12,"cy":0.11}},{"start":8500,"end":11000,"focus":{"cx":0.8,"cy":0.2}}]}',
	},
	{
		name: "reservedOverlap",
		input: {
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), makeClick(20_000, 0.7, 0.7)],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
			reservedSpans: [{ start: 4_000, end: 6_000 }],
		},
		expected:
			'{"status":"ok","suggestions":[{"start":19500,"end":20500,"focus":{"cx":0.7,"cy":0.7}}]}',
	},
	{
		name: "allReserved",
		input: {
			cursorTelemetry: withMoves([makeClick(5_000, 0.3, 0.3)], TOTAL_MS),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
			reservedSpans: [{ start: 0, end: TOTAL_MS }],
		},
		expected: '{"status":"no-slots","suggestions":[]}',
	},
	{
		name: "boundaryClamping",
		input: {
			cursorTelemetry: withMoves(
				[makeClick(100, 0.5, 0.5), makeClick(TOTAL_MS - 100, 0.5, 0.5)],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		},
		expected:
			'{"status":"ok","suggestions":[{"start":0,"end":600,"focus":{"cx":0.5,"cy":0.5}},{"start":29400,"end":30000,"focus":{"cx":0.5,"cy":0.5}}]}',
	},
	{
		name: "customGapAndPad",
		input: {
			cursorTelemetry: withMoves(
				[makeClick(5_000), makeClick(6_200), makeClick(8_000)],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
			mergeGapMs: 1_000,
			padMs: 250,
		},
		expected:
			'{"status":"ok","suggestions":[{"start":4750,"end":5250,"focus":{"cx":0.5,"cy":0.5}},{"start":5950,"end":6450,"focus":{"cx":0.5,"cy":0.5}},{"start":7750,"end":8250,"focus":{"cx":0.5,"cy":0.5}}]}',
	},
];

function suggestionsOnly(result: ReturnType<typeof buildInteractionZoomSuggestions>) {
	return JSON.stringify({ status: result.status, suggestions: result.suggestions });
}

describe("click only recordings are untouched by the typing path", () => {
	for (const { name, input, expected } of CLICK_ONLY_BASELINE) {
		it(`produces byte identical output for ${name}`, () => {
			const result = buildInteractionZoomSuggestions(input);

			expect(suggestionsOnly(result)).toBe(expected);
			expect(result.typing).toBeUndefined();
		});
	}
});

describe("typing bursts merged into interaction zoom suggestions", () => {
	it("extends the end of the click cluster the burst anchors to, keeping the click's focus", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[
					makeClick(5_000, 0.3, 0.3),
					...makeTypingRun(5_500, 40, 150, { cx: 0.9, cy: 0.9 }),
				],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toEqual([
			{ start: 4_500, end: 5_500 + 39 * 150 + 500, focus: { cx: 0.3, cy: 0.3 } },
		]);
		expect(result.typing).toEqual({
			burstsDetected: 1,
			burstsApplied: 1,
			burstsDeclinedForFocus: 0,
			burstsLimitedByClick: 0,
		});
	});

	it("suggests nothing for a burst with no trustworthy focus and counts the decline", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), ...makeTypingRun(20_000, 20, 100)],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.suggestions).toEqual([
			{ start: 4_500, end: 5_500, focus: { cx: 0.3, cy: 0.3 } },
		]);
		expect(result.typing).toEqual({
			burstsDetected: 1,
			burstsApplied: 0,
			burstsDeclinedForFocus: 1,
			burstsLimitedByClick: 0,
		});
	});

	it("returns no-interactions for typing with no clicks at all, with the burst counted as declined", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(makeTypingRun(5_000, 20, 100), TOTAL_MS),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.status).toBe("no-interactions");
		expect(result.suggestions).toEqual([]);
		expect(result.typing).toEqual({
			burstsDetected: 1,
			burstsApplied: 0,
			burstsDeclinedForFocus: 1,
			burstsLimitedByClick: 0,
		});
	});

	it("lets a later click cluster win where the extension would run into it", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[
					makeClick(5_000, 0.3, 0.3),
					...makeTypingRun(5_500, 50, 150),
					makeClick(9_000, 0.7, 0.7),
				],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		// The second click's own region, 8500 to 9500, is exactly what it was.
		// The typing extension stops where that region begins.
		expect(result.suggestions).toEqual([
			{ start: 4_500, end: 8_500, focus: { cx: 0.3, cy: 0.3 } },
			{ start: 8_500, end: 9_500, focus: { cx: 0.7, cy: 0.7 } },
		]);
		expect(result.typing).toMatchObject({ burstsApplied: 1, burstsLimitedByClick: 1 });
	});

	it("falls back to the click's own region when the extended region overlaps a reserved span", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), ...makeTypingRun(5_500, 50, 150)],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
			reservedSpans: [{ start: 10_000, end: 11_000 }],
		});

		expect(result.suggestions).toEqual([
			{ start: 4_500, end: 5_500, focus: { cx: 0.3, cy: 0.3 } },
		]);
		expect(result.typing).toMatchObject({ burstsApplied: 0, burstsLimitedByClick: 1 });
	});

	it("still drops the click's own region when it overlaps a reserved span, as today", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), ...makeTypingRun(5_500, 10, 150)],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
			reservedSpans: [{ start: 4_000, end: 6_000 }],
		});

		expect(result.status).toBe("no-slots");
		expect(result.suggestions).toEqual([]);
	});

	it("ignores modifier only key presses that reach the engine, because their flag survives normalisation", () => {
		const modifierPresses = Array.from({ length: 12 }, (_unusedSlot, index) =>
			makeKeystroke(5_500 + index * 100, { keyProducesCharacter: false }),
		);
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves([makeClick(5_000, 0.3, 0.3), ...modifierPresses], TOTAL_MS),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.suggestions).toEqual([
			{ start: 4_500, end: 5_500, focus: { cx: 0.3, cy: 0.3 } },
		]);
		expect(result.typing).toEqual({
			burstsDetected: 0,
			burstsApplied: 0,
			burstsDeclinedForFocus: 0,
			burstsLimitedByClick: 0,
		});
	});

	it("extends each cluster by the burst that anchors to its own click", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[
					makeClick(5_000, 0.3, 0.3),
					...makeTypingRun(5_500, 5, 100),
					makeClick(9_000, 0.35, 0.35),
					...makeTypingRun(9_400, 5, 100),
				],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		// The clicks are 4000 ms apart, beyond the 2500 ms merge gap, so they
		// form two clusters. Each burst anchors to the click before it and
		// extends that cluster only.
		expect(result.suggestions).toEqual([
			{ start: 4_500, end: 5_900 + 500, focus: { cx: 0.3, cy: 0.3 } },
			{ start: 8_500, end: 9_800 + 500, focus: { cx: 0.35, cy: 0.35 } },
		]);
		expect(result.typing).toMatchObject({ burstsDetected: 2, burstsApplied: 2 });
	});

	it("leaves a cluster alone when its own clicks already run past the burst", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[
					makeClick(5_000, 0.3, 0.3),
					...makeTypingRun(5_200, 3, 100),
					makeClick(7_000, 0.3, 0.3),
				],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.suggestions).toEqual([
			{ start: 4_500, end: 7_500, focus: { cx: 0.3, cy: 0.3 } },
		]);
		expect(result.typing).toMatchObject({ burstsDetected: 1, burstsApplied: 1 });
	});
});
