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
 * So there are two stages. A target holds while the caret is comfortably
 * inside the frame and moves only when the caret would otherwise leave it, by
 * the least it can. The camera then travels towards that target at a speed
 * that rises with how far it has to go, so no single frame throws it across
 * the picture and no relocation leaves the viewer waiting for it.
 *
 * Pure and deterministic: the path is folded from the start of the region on
 * every call, never carried between frames. Preview and every export path
 * share this function, and a state that evolved per frame could let them
 * disagree.
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
 * How the camera's speed relates to how far it has to go, per second.
 *
 * A fixed speed limit is wrong because the two things it governs are not the
 * same kind of event. Following text down a page is a movement, and it should
 * be unhurried. Selecting a page of text and typing over it is not a
 * movement: the caret does not travel from the bottom to the top, it stops
 * being at the bottom. A camera that crawls across in response misses what is
 * being typed, which the author reported on 24 September 2026.
 *
 * Speed rising with distance settles both. Roughly, the camera covers the gap
 * in the same short time whatever its size, so a correction is gentle in
 * absolute terms and a relocation is quick.
 */
export const CARET_PAN_RESPONSIVENESS = 4;

/**
 * The floor, so the last sliver of a gap is closed rather than approached
 * forever, and the ceiling, so no jump becomes a teleport. Quick is not the
 * same as instant: a camera that arrived in one frame would be the lurch
 * fixed earlier on 24 September 2026, measured at 0.249 of the frame in a
 * single frame of preview.
 */
export const CARET_MIN_PAN_PER_SECOND = 0.05;
export const CARET_MAX_PAN_PER_SECOND = 2.5;

/**
 * Moves `target` the least it can so that `caret` sits no further than
 * `deadzone` from it. Returns `target` untouched while the caret is inside.
 */
function easeTowards(target: number, caret: number, deadzone: number): number {
	const distance = caret - target;

	if (distance > deadzone) {
		return caret - deadzone;
	}

	if (distance < -deadzone) {
		return caret + deadzone;
	}

	return target;
}

/**
 * Travels from `from` towards `to` by at most `maxDistance`, along the
 * straight line between them. Measured as a distance rather than per axis, so
 * a diagonal move is not faster than a straight one.
 */
function travelTowards(from: ZoomFocus, to: ZoomFocus, maxDistance: number): ZoomFocus {
	const deltaX = to.cx - from.cx;
	const deltaY = to.cy - from.cy;
	const distance = Math.hypot(deltaX, deltaY);

	if (distance <= maxDistance || distance === 0) {
		return to;
	}

	const fraction = maxDistance / distance;
	return { cx: from.cx + deltaX * fraction, cy: from.cy + deltaY * fraction };
}

export function resolveCaretFollowFocus({
	caretTrack,
	regionStartMs,
	regionEndMs,
	timeMs,
	anchorFocus,
	zoomScale,
	deadzoneRatio = CARET_DEADZONE_RATIO,
	panResponsiveness = CARET_PAN_RESPONSIVENESS,
	minPanPerSecond = CARET_MIN_PAN_PER_SECOND,
	maxPanPerSecond = CARET_MAX_PAN_PER_SECOND,
}: {
	caretTrack: readonly CaretSample[];
	/** Samples before this belong to earlier typing and are not this region's. */
	regionStartMs: number;
	/** Samples after this belong to later typing, for the same reason. */
	regionEndMs: number;
	timeMs: number;
	/** Where the click before the typing said the field was. */
	anchorFocus: ZoomFocus;
	zoomScale: number;
	deadzoneRatio?: number;
	panResponsiveness?: number;
	minPanPerSecond?: number;
	maxPanPerSecond?: number;
}): ZoomFocus {
	const halfExtent = 1 / (2 * zoomScale);
	const deadzone = deadzoneRatio * halfExtent;

	const samplesInRegion = caretTrack.filter(
		(sample) => sample.timeMs >= regionStartMs && sample.timeMs <= regionEndMs,
	);
	const firstCaret = samplesInRegion[0];

	// The zoom opens already pointed at the text, rather than opening on the
	// click and sliding across to the text afterwards. That slide is what the
	// author described on 24 September 2026 as going centre and then centring
	// on the typing.
	//
	// Aiming ahead of the evidence is how a click zoom already works: its
	// region begins half a second before the click it is named for, so the
	// camera is pointed at a click that has not happened yet. This is recorded
	// data being replayed rather than a live camera, and the same function
	// runs in the preview and in every export path, so nothing can disagree
	// about where the zoom opened.
	//
	// It applies to the first caret only. Every sample after it is a movement
	// the viewer can watch happening, and a camera that jumped to each one
	// would be the lurch that was fixed earlier the same day.
	let target = firstCaret ? { cx: firstCaret.cx, cy: firstCaret.cy } : anchorFocus;
	let camera = target;
	let lastTimeMs = regionStartMs;

	const travel = (untilMs: number) => {
		const elapsedMs = Math.max(0, untilMs - lastTimeMs);
		// Speed is taken from the gap as it stands at the start of the stretch,
		// which keeps this a fold over the samples rather than a simulation.
		const remaining = Math.hypot(target.cx - camera.cx, target.cy - camera.cy);
		const speed = Math.min(
			maxPanPerSecond,
			Math.max(minPanPerSecond, remaining * panResponsiveness),
		);
		camera = travelTowards(camera, target, (speed * elapsedMs) / 1_000);
		lastTimeMs = untilMs;
	};

	for (const sample of samplesInRegion) {
		// The first one has already aimed the camera; it must not also be read
		// through the dead zone, which would move the camera off it.
		if (sample === firstCaret) {
			continue;
		}
		// Past the opening shot the camera cannot see the future, so a later
		// sample must not change where it is pointed now.
		if (sample.timeMs > timeMs) {
			break;
		}

		// Travel on the target that was in force up to this sample, then let
		// the sample move the target.
		travel(sample.timeMs);
		target = {
			cx: easeTowards(target.cx, sample.cx, deadzone),
			cy: easeTowards(target.cy, sample.cy, deadzone),
		};
	}

	// A gap in the track lands here too: the target stands still and the camera
	// finishes travelling to it, holding the last caret that was trusted rather
	// than jumping back to the click.
	travel(timeMs);

	return clampFocusToScale(camera, zoomScale);
}
