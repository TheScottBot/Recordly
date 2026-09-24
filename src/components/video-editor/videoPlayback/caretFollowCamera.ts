/**
 * Where the camera looks during a typing zoom.
 *
 * A typing zoom used to hold one fixed point, taken from the click before the
 * typing. That is wrong as soon as the text moves: type enough lines and the
 * words that began at the top of the page finish at the bottom, with the
 * camera still pointed at the top. The author reported exactly that on 23
 * September 2026.
 *
 * Following the caret exactly would be worse. The caret jumps a character at
 * a time and a line at a time, and a camera glued to it would never be still.
 * So the camera holds while the caret is comfortably inside the frame and
 * moves only when the caret would otherwise leave it, by the least it can.
 *
 * Pure and deterministic: the focus is a function of the track and the time,
 * folded from the start of the region every call, never of a camera state
 * carried between frames. Preview and every export path share this function,
 * and a state that evolved per frame could let them disagree.
 */

import type { CaretSample } from "@/lib/typingTelemetryContract";
import type { ZoomFocus } from "../types";
import { clampFocusToScale } from "./focusUtils";

/**
 * How far the caret may stray from where the camera is pointed before the
 * camera moves, as a fraction of the visible half extent. At 1.5x the visible
 * half extent is a third of the frame, so half of that is a sixth of the
 * frame in each direction.
 *
 * A starting point, to be adjusted against real recordings in the way
 * `TYPING_SESSION_CARRY_MS` was. Larger holds the camera still for longer and
 * risks the caret reaching the edge; smaller follows more closely and risks
 * the drifting the author disliked.
 */
export const CARET_DEADZONE_RATIO = 0.5;

/**
 * Moves `committed` the least it can so that `caret` sits no further than
 * `deadzone` from it. Returns `committed` untouched while the caret is inside.
 */
function easeTowards(committed: number, caret: number, deadzone: number): number {
	const distance = caret - committed;

	if (distance > deadzone) {
		return caret - deadzone;
	}

	if (distance < -deadzone) {
		return caret + deadzone;
	}

	return committed;
}

export function resolveCaretFollowFocus({
	caretTrack,
	regionStartMs,
	timeMs,
	anchorFocus,
	zoomScale,
	deadzoneRatio = CARET_DEADZONE_RATIO,
}: {
	caretTrack: readonly CaretSample[];
	/** Samples before this belong to earlier typing and are not this region's. */
	regionStartMs: number;
	timeMs: number;
	/** Where the click before the typing said the field was. */
	anchorFocus: ZoomFocus;
	zoomScale: number;
	deadzoneRatio?: number;
}): ZoomFocus {
	const halfExtent = 1 / (2 * zoomScale);
	const deadzone = deadzoneRatio * halfExtent;

	let committed: ZoomFocus | null = null;

	for (const sample of caretTrack) {
		if (sample.timeMs < regionStartMs) {
			continue;
		}
		// The camera cannot see the future, so a later sample must not change
		// where it is pointed now.
		if (sample.timeMs > timeMs) {
			break;
		}

		if (committed === null) {
			// The first caret replaces the click outright rather than being
			// eased towards. The click is a guess at where the field is; the
			// caret is the thing itself, and this happens while the zoom is
			// still easing in, so it does not read as a jump.
			committed = { cx: sample.cx, cy: sample.cy };
			continue;
		}

		committed = {
			cx: easeTowards(committed.cx, sample.cx, deadzone),
			cy: easeTowards(committed.cy, sample.cy, deadzone),
		};
	}

	// No caret yet, or none for this region: the click anchor is all there is.
	// A gap in the track lands here too, holding the last caret that was
	// trusted rather than jumping back to the click.
	return clampFocusToScale(committed ?? anchorFocus, zoomScale);
}
