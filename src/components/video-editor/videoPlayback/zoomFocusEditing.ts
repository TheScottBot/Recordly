/**
 * Which zoom regions offer a draggable focus, and what dragging one means.
 *
 * Pure, so the rule lives in one place rather than being repeated in the
 * overlay, the pointer handler and the command that stores the result.
 */

import { clampFocusToDepth, type ZoomFocus, type ZoomRegion } from "../types";

/**
 * A click zoom follows the pointer, so a fixed focus would be meaningless and
 * it offers no handle. A typing zoom does offer one: its focus is inferred
 * from the click that preceded the typing, which is a good guess rather than
 * a certainty, and the person is the one who can see whether it landed right.
 * A manual zoom has always offered one.
 */
export function isZoomFocusAdjustable(region: ZoomRegion | null | undefined): region is ZoomRegion {
	if (!region) {
		return false;
	}

	return region.mode === "manual" || region.trigger === "typing";
}

/**
 * Applies a dragged focus. A typing zoom becomes manual in the process:
 * the person has chosen this point, so nothing may move it afterwards,
 * including the caret track this work is heading towards.
 */
export function applyZoomFocusEdit(region: ZoomRegion, focus: ZoomFocus): ZoomRegion {
	return {
		...region,
		focus: clampFocusToDepth(focus, region.depth),
		mode: region.trigger === "typing" ? "manual" : region.mode,
	};
}
