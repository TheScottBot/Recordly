/**
 * What to tell someone about the typing zooms they did not get.
 *
 * The suggestion engine has always counted what the typing path did and
 * nobody has ever been told. A burst that produced no zoom is the most
 * confusing outcome this feature has: nothing appears, and there is no way to
 * tell a recording with no typing in it from typing the engine would not
 * place.
 *
 * Silence where everything worked. A sentence only when something did not, so
 * the message means something when it appears.
 */

import type { TypingSuggestionSummary } from "./zoomSuggestionUtils";

export function describeTypingSuggestionOutcome(
	summary: TypingSuggestionSummary | undefined,
	caretTrackTruncated: boolean,
): string | null {
	const sentences: string[] = [];

	// First, because it explains a zoom that starts well and then stops
	// following, which reads as a fault rather than as a limit being reached.
	if (caretTrackTruncated) {
		sentences.push(
			"The caret track hit its limit, so later typing zooms may stop following the text.",
		);
	}

	if (summary) {
		if (summary.burstsDeclinedForFocus > 0) {
			sentences.push(
				`${summary.burstsDeclinedForFocus} of ${summary.burstsDetected} typing moments produced no zoom, because nothing recorded where the typing was.`,
			);
		}

		// Not a fault: a click zoom is the stronger claim about what someone
		// was looking at, and typing takes only the room left beside one.
		if (summary.burstsLimitedByClick > 0) {
			sentences.push(
				`${summary.burstsLimitedByClick} typing zoom${summary.burstsLimitedByClick === 1 ? " was" : "s were"} shortened to make room for a click zoom.`,
			);
		}
	}

	return sentences.length > 0 ? sentences.join(" ") : null;
}
