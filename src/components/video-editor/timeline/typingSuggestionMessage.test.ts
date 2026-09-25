import { describe, expect, it } from "vitest";
import { describeTypingSuggestionOutcome } from "./typingSuggestionMessage";

/**
 * The suggestion engine has always counted what the typing path did and
 * nobody has ever been told. A burst that produced no zoom is the single most
 * confusing outcome of this feature: nothing appears, and there is no way to
 * tell a recording with no typing from typing the engine would not place.
 */
describe("describeTypingSuggestionOutcome", () => {
	it("says nothing at all about a recording that held no typing", () => {
		expect(describeTypingSuggestionOutcome(undefined, false)).toBeNull();
	});

	it("says nothing when every burst became a zoom, because that needs no explaining", () => {
		expect(
			describeTypingSuggestionOutcome(
				{
					burstsDetected: 4,
					burstsApplied: 4,
					burstsDeclinedForFocus: 0,
					burstsLimitedByClick: 0,
				},
				false,
			),
		).toBeNull();
	});

	it("explains a burst that had nowhere trustworthy to point", () => {
		const message = describeTypingSuggestionOutcome(
			{
				burstsDetected: 5,
				burstsApplied: 4,
				burstsDeclinedForFocus: 1,
				burstsLimitedByClick: 0,
			},
			false,
		);

		expect(message).toBe(
			"1 of 5 typing moments produced no zoom, because nothing recorded where the typing was.",
		);
	});

	it("counts more than one the same way", () => {
		const message = describeTypingSuggestionOutcome(
			{
				burstsDetected: 5,
				burstsApplied: 2,
				burstsDeclinedForFocus: 3,
				burstsLimitedByClick: 0,
			},
			false,
		);

		expect(message).toBe(
			"3 of 5 typing moments produced no zoom, because nothing recorded where the typing was.",
		);
	});

	it("explains a zoom that a click region cut short, which is not a fault", () => {
		const message = describeTypingSuggestionOutcome(
			{
				burstsDetected: 3,
				burstsApplied: 3,
				burstsDeclinedForFocus: 0,
				burstsLimitedByClick: 2,
			},
			false,
		);

		expect(message).toBe("2 typing zooms were shortened to make room for a click zoom.");
	});

	/**
	 * The most important one. A zoom that stops following because the track ran
	 * out is indistinguishable from a zoom that is broken, and someone will
	 * report the second when it was the first.
	 */
	it("leads with a truncated track, which explains a zoom that stops following", () => {
		const message = describeTypingSuggestionOutcome(
			{
				burstsDetected: 2,
				burstsApplied: 2,
				burstsDeclinedForFocus: 0,
				burstsLimitedByClick: 0,
			},
			true,
		);

		expect(message).toBe(
			"The caret track hit its limit, so later typing zooms may stop following the text.",
		);
	});

	it("says both when both happened, the truncation first", () => {
		const message = describeTypingSuggestionOutcome(
			{
				burstsDetected: 5,
				burstsApplied: 4,
				burstsDeclinedForFocus: 1,
				burstsLimitedByClick: 0,
			},
			true,
		);

		expect(message).toBe(
			"The caret track hit its limit, so later typing zooms may stop following the text. 1 of 5 typing moments produced no zoom, because nothing recorded where the typing was.",
		);
	});

	it("mentions a truncated track even for a recording the engine found no typing in", () => {
		expect(describeTypingSuggestionOutcome(undefined, true)).toBe(
			"The caret track hit its limit, so later typing zooms may stop following the text.",
		);
	});
});
