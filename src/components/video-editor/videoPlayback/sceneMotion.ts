import type { CursorTelemetryPoint, ZoomFocus, ZoomRegion } from "../types";
import { ZOOM_DEPTH_SCALES } from "../types";
import { DEFAULT_FOCUS } from "./constants";
import {
	type CursorFollowCameraState,
	computeCursorFollowFocus,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "./cursorFollowCamera";
import { findDominantRegion } from "./zoomRegionUtils";

export type SceneZoomTarget = {
	scale: number;
	focus: ZoomFocus;
	progress: number;
};

export type PreviewMotionMode = "spring" | "snap" | "preserve";

/**
 * Decide how the preview camera should react to the current transport state.
 * A plain pause must preserve the last composed frame; recomputing the projected
 * target there causes the image to jump as soon as the user presses Space.
 */
export function resolvePreviewMotionMode({
	isPlaying,
	isSeeking,
	shouldSnapPausedFrame,
	zoomClassicMode,
}: {
	isPlaying: boolean;
	isSeeking: boolean;
	shouldSnapPausedFrame: boolean;
	zoomClassicMode: boolean;
}): PreviewMotionMode {
	if (isSeeking || shouldSnapPausedFrame || (isPlaying && zoomClassicMode)) {
		return "snap";
	}

	return isPlaying ? "spring" : "preserve";
}

/** Match export's one-composition-per-media-frame behavior. */
export function shouldComposePreviewFrame({
	motionMode,
	isSeeking = false,
	contentTimeChanged,
	shouldSnapPausedFrame,
}: {
	motionMode: PreviewMotionMode;
	isSeeking?: boolean;
	contentTimeChanged: boolean;
	shouldSnapPausedFrame: boolean;
}): boolean {
	// Do not consume the pending composition against the old decoded image.
	if (isSeeking || motionMode === "preserve") {
		return false;
	}

	return contentTimeChanged || shouldSnapPausedFrame;
}

/** Resolve the camera target for a media timestamp, independent of renderer. */
export function resolveSceneZoomTarget({
	zoomRegions,
	timeMs,
	cursorTimeMs = timeMs,
	connectZooms,
	zoomInDurationMs,
	zoomOutDurationMs,
	zoomClassicMode,
	cursorTelemetry,
	cursorFollowCamera,
}: {
	zoomRegions: ZoomRegion[];
	timeMs: number;
	cursorTimeMs?: number;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomOutDurationMs?: number;
	zoomClassicMode?: boolean;
	cursorTelemetry?: CursorTelemetryPoint[];
	cursorFollowCamera: CursorFollowCameraState;
}): SceneZoomTarget {
	const { region, strength, blendedScale } = findDominantRegion(zoomRegions, timeMs, {
		connectZooms,
		zoomInDurationMs,
		zoomOutDurationMs,
	});

	if (!region || strength <= 0) {
		return { scale: 1, focus: DEFAULT_FOCUS, progress: 0 };
	}

	const scale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];
	let focus = region.focus;
	// A click zoom follows the pointer, because after a click the pointer is by
	// definition at the thing being looked at. A typing zoom must not: while
	// someone types the pointer is parked wherever they left it, often far from
	// the text, and following it drags the camera off the field they are typing
	// into. Until a caret track exists to follow instead, a typing region holds
	// the focus it anchored to.
	const followsThePointer = region.trigger !== "typing";
	if (
		!zoomClassicMode &&
		followsThePointer &&
		region.mode !== "manual" &&
		cursorTelemetry &&
		cursorTelemetry.length > 0
	) {
		focus = computeCursorFollowFocus(
			cursorFollowCamera,
			cursorTelemetry,
			cursorTimeMs,
			scale,
			strength,
			region.focus,
			{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO },
		);
	}

	return { scale, focus, progress: strength };
}
