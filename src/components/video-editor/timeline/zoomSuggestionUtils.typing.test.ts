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

describe("typing bursts as their own suggestions", () => {
	const CLICK_AT_5000 = withMoves([makeClick(5_000, 0.3, 0.3)], TOTAL_MS);
	const CLICK_FOCUS = { cx: 0.3, cy: 0.3 };
	const CLICK_REGION = { start: 4_500, end: 5_500, focus: CLICK_FOCUS };

	it("creates a region beside the click's own, focused on the anchoring click", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: CLICK_AT_5000,
			typingEvents: makeTypingRun(5_500, 40, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toEqual([
			CLICK_REGION,
			{ start: 5_500, end: 11_850, focus: CLICK_FOCUS, trigger: "typing" },
		]);
		expect(result.typing).toEqual({
			burstsDetected: 1,
			burstsApplied: 1,
			burstsDeclinedForFocus: 0,
			burstsLimitedByClick: 0,
		});
	});

	it("gives way to the next click's region and picks up again after it", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), makeClick(9_000, 0.7, 0.7)],
				TOTAL_MS,
			),
			typingEvents: makeTypingRun(5_500, 50, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		// Both click regions are exactly what they would be without any typing,
		// and the typing resumes on the far side of the second one rather than
		// stopping there. A burst used to end at the first click it met, which
		// silenced every word typed after it.
		expect(result.suggestions).toEqual([
			CLICK_REGION,
			{ start: 5_500, end: 8_500, focus: CLICK_FOCUS, trigger: "typing" },
			{ start: 8_500, end: 9_500, focus: { cx: 0.7, cy: 0.7 } },
			{ start: 9_500, end: 13_350, focus: CLICK_FOCUS, trigger: "typing" },
		]);
		// One burst, two regions. The count is of bursts, and the time under
		// the click region is still time the typing lost.
		expect(result.typing).toMatchObject({ burstsApplied: 1, burstsLimitedByClick: 1 });
	});

	it("drops a typing region with too little room left beside the click", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: CLICK_AT_5000,
			typingEvents: makeTypingRun(5_000, 3, 100),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.suggestions).toEqual([CLICK_REGION]);
		expect(result.typing).toEqual({
			burstsDetected: 1,
			burstsApplied: 0,
			burstsDeclinedForFocus: 0,
			burstsLimitedByClick: 1,
		});
	});

	it("gives a burst after a thinking pause its own region on the same field", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: CLICK_AT_5000,
			typingEvents: [...makeTypingRun(5_500, 5, 100), ...makeTypingRun(12_000, 5, 100)],
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.suggestions).toEqual([
			CLICK_REGION,
			{ start: 5_500, end: 6_400, focus: CLICK_FOCUS, trigger: "typing" },
			// Both begin on their first keystroke. The second read 11_500 while
			// typing regions padded ahead of the burst, which the author saw as
			// the camera moving before the typing did.
			{ start: 12_000, end: 12_900, focus: CLICK_FOCUS, trigger: "typing" },
		]);
		expect(result.typing).toMatchObject({
			burstsDetected: 2,
			burstsApplied: 2,
			burstsDeclinedForFocus: 0,
		});
	});

	it("gives way to a reserved span and picks up again after it", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: CLICK_AT_5000,
			typingEvents: makeTypingRun(5_500, 40, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
			reservedSpans: [{ start: 10_000, end: 11_000 }],
		});

		expect(result.suggestions).toEqual([
			CLICK_REGION,
			{ start: 5_500, end: 10_000, focus: CLICK_FOCUS, trigger: "typing" },
			{ start: 11_000, end: 11_850, focus: CLICK_FOCUS, trigger: "typing" },
		]);
		expect(result.typing).toMatchObject({ burstsApplied: 1, burstsLimitedByClick: 1 });
	});

	it("suggests nothing for a burst with no trustworthy focus and counts the decline", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: CLICK_AT_5000,
			typingEvents: makeTypingRun(20_000, 20, 100),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.suggestions).toEqual([CLICK_REGION]);
		expect(result.typing).toEqual({
			burstsDetected: 1,
			burstsApplied: 0,
			burstsDeclinedForFocus: 1,
			burstsLimitedByClick: 0,
		});
	});

	it("returns no-interactions for typing with no clicks at all, with the burst counted as declined", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves([], TOTAL_MS),
			typingEvents: makeTypingRun(5_000, 20, 100),
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

	it("still drops the click's own region when it overlaps a reserved span, leaving only the typing region", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: CLICK_AT_5000,
			typingEvents: makeTypingRun(5_500, 10, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
			reservedSpans: [{ start: 4_000, end: 6_000 }],
		});

		// The click region 4500 to 5500 is dropped exactly as it is today. The
		// typing region survives because it can start after the reserved span.
		expect(result.suggestions).toEqual([
			{ start: 6_000, end: 7_350, focus: CLICK_FOCUS, trigger: "typing" },
		]);
	});

	it("ignores modifier only key presses, because their flag says they are not typing", () => {
		const modifierPresses = Array.from({ length: 12 }, (_unusedSlot, index) =>
			makeKeystroke(5_500 + index * 100, { keyProducesCharacter: false }),
		);
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: CLICK_AT_5000,
			typingEvents: modifierPresses,
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.suggestions).toEqual([CLICK_REGION]);
		expect(result.typing).toEqual({
			burstsDetected: 0,
			burstsApplied: 0,
			burstsDeclinedForFocus: 0,
			burstsLimitedByClick: 0,
		});
	});
});

describe("where a typing region begins", () => {
	/**
	 * A click zoom pads ahead of the click because the camera should be settled
	 * at the instant the click lands, and a pointer travelling to a target makes
	 * that early move read as intent. Typing has no such approach: nothing on
	 * screen moves before the first keystroke, so a camera that has already
	 * zoomed reads as a fault. The author saw exactly that on 23 September 2026
	 * and described it as moving in advance of the typing.
	 */
	it("begins at the first keystroke rather than a pad ahead of it", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves([makeClick(8_000, 0.4, 0.4)], TOTAL_MS),
			typingEvents: makeTypingRun(9_000, 12),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		const typingRegion = result.suggestions.find((region) => region.trigger === "typing");

		expect(typingRegion).toBeDefined();
		expect(typingRegion?.start).toBe(9_000);
	});

	/**
	 * The trailing pad stays. Snapping out on the last keystroke cuts away the
	 * moment someone reads back what they just typed.
	 */
	it("still holds for a pad after the last keystroke", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves([makeClick(8_000, 0.4, 0.4)], TOTAL_MS),
			typingEvents: makeTypingRun(9_000, 12),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		const typingRegion = result.suggestions.find((region) => region.trigger === "typing");

		// Twelve keystrokes 120 ms apart put the last at 10_320.
		expect(typingRegion?.end).toBe(10_820);
	});
});

describe("typing that continues past a click", () => {
	/**
	 * The author switched browser tabs and carried on typing, three times in
	 * one recording on 25 September 2026, and every burst after the first
	 * click got no zoom. Their typing ran from 12797 to 32402 ms and produced
	 * a single region ending at 17515, where the first click region began.
	 *
	 * A burst was shrunk to the first free stretch ahead of it and never
	 * split, so one click in the middle of a long burst silenced everything
	 * after it. Switching tabs is a click, so this is the ordinary case of
	 * working across two windows, not an edge case.
	 */
	it("gives every free stretch of a long burst its own region", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), makeClick(12_000, 0.6, 0.3)],
				TOTAL_MS,
			),
			typingEvents: makeTypingRun(5_500, 120, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		const typingRegions = result.suggestions.filter((region) => region.trigger === "typing");

		// One before the second click's region, one after it.
		expect(typingRegions).toHaveLength(2);
		expect(typingRegions[0].end).toBeLessThanOrEqual(11_500);
		expect(typingRegions[1].start).toBeGreaterThanOrEqual(12_500);
	});

	it("never overlaps the click regions it makes room for", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[
					makeClick(5_000, 0.3, 0.3),
					makeClick(12_000, 0.6, 0.3),
					makeClick(18_000, 0.7, 0.4),
				],
				TOTAL_MS,
			),
			typingEvents: makeTypingRun(5_500, 160, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		const clickRegions = result.suggestions.filter((region) => region.trigger !== "typing");
		const typingRegions = result.suggestions.filter((region) => region.trigger === "typing");

		for (const typing of typingRegions) {
			for (const click of clickRegions) {
				const overlaps = typing.start < click.end && typing.end > click.start;
				expect(overlaps).toBe(false);
			}
		}
		expect(typingRegions.length).toBeGreaterThan(1);
	});

	/**
	 * Each stretch is its own moment and the caret says where it was. Switching
	 * tabs moves the caret, so a burst carried across a click must not keep
	 * pointing where it started.
	 */
	it("takes each stretch's focus from the caret inside it", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), makeClick(12_000, 0.6, 0.3)],
				TOTAL_MS,
			),
			typingEvents: makeTypingRun(5_500, 120, 150),
			caretTrack: [
				{ timeMs: 5_600, cx: 0.2, cy: 0.2 },
				{ timeMs: 13_000, cx: 0.8, cy: 0.6 },
			],
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		const typingRegions = result.suggestions.filter((region) => region.trigger === "typing");

		expect(typingRegions[0].focus).toEqual({ cx: 0.2, cy: 0.2 });
		expect(typingRegions[1].focus).toEqual({ cx: 0.8, cy: 0.6 });
	});

	it("drops a stretch too short to be worth a zoom", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5_000, 0.3, 0.3), makeClick(6_000, 0.6, 0.3)],
				TOTAL_MS,
			),
			typingEvents: makeTypingRun(5_400, 30, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		const typingRegions = result.suggestions.filter((region) => region.trigger === "typing");

		for (const region of typingRegions) {
			expect(region.end - region.start).toBeGreaterThanOrEqual(400);
		}
	});
});

describe("the counters still describe bursts once a burst can make several regions", () => {
	/**
	 * Splitting a burst across the gaps between clicks made `burstsApplied`
	 * count regions rather than bursts, so it read 6 against 2 detected on the
	 * author's recording of 25 September 2026. A count that exceeds the total
	 * it is a fraction of is worse than no count.
	 */
	it("counts a burst split into several regions as one burst", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[
					makeClick(5_000, 0.3, 0.3),
					makeClick(12_000, 0.6, 0.3),
					makeClick(18_000, 0.7, 0.4),
				],
				TOTAL_MS,
			),
			typingEvents: makeTypingRun(5_500, 160, 150),
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		const typingRegions = result.suggestions.filter((region) => region.trigger === "typing");

		expect(typingRegions.length).toBeGreaterThan(1);
		expect(result.typing?.burstsDetected).toBe(1);
		expect(result.typing?.burstsApplied).toBe(1);
	});

	it("never reports more bursts applied than were detected", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[
					makeClick(5_000, 0.3, 0.3),
					makeClick(9_000, 0.6, 0.3),
					makeClick(14_000, 0.7, 0.4),
				],
				TOTAL_MS,
			),
			typingEvents: [...makeTypingRun(5_500, 80, 150), ...makeTypingRun(20_000, 20, 150)],
			totalMs: TOTAL_MS,
			defaultDurationMs: 2_000,
		});

		expect(result.typing?.burstsApplied).toBeLessThanOrEqual(
			result.typing?.burstsDetected ?? 0,
		);
	});
});
