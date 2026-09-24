/**
 * Caret samples: where the caret was while someone was typing.
 *
 * The helper reports physical screen pixels, because that is what UI
 * Automation gives a per monitor DPI aware process and the helper has no way
 * to know the display scale or the recorded bounds. Turning those into the
 * captured area's coordinates happens here, through the same mapping the
 * pointer uses, so a caret and a click at the same place on screen land at
 * the same place in the frame.
 */

import type { CaretSample } from "../../../src/lib/typingTelemetryContract";
import { activeCaretSamples, setActiveCaretSamples } from "../state";
import { getScreen } from "../utils";
import { locateDipPointInCapturedArea } from "./telemetry";

/** The same ceiling the cursor track uses, for the same reason. */
export const MAX_CARET_SAMPLES = 20_000;

/**
 * Returns null when the caret is outside the captured area or the point is
 * not a finite pair, rather than clamping. See
 * `locateDipPointInCapturedArea` for why the two callers differ at the edge.
 */
export function normalizeCaretScreenPoint(physicalPoint: {
	x: number;
	y: number;
}): { cx: number; cy: number } | null {
	if (!Number.isFinite(physicalPoint.x) || !Number.isFinite(physicalPoint.y)) {
		return null;
	}

	const screen = getScreen();
	// Present on Windows only, which is the only platform that samples a
	// caret. Anywhere else the point is taken as already device independent.
	const dipPoint =
		typeof screen.screenToDipPoint === "function"
			? screen.screenToDipPoint(physicalPoint)
			: physicalPoint;

	const located = locateDipPointInCapturedArea(dipPoint);
	if (
		!Number.isFinite(located.cx) ||
		!Number.isFinite(located.cy) ||
		located.cx < 0 ||
		located.cx > 1 ||
		located.cy < 0 ||
		located.cy > 1
	) {
		return null;
	}

	return { cx: located.cx, cy: located.cy };
}

export function pushCaretSample(sample: CaretSample) {
	activeCaretSamples.push(sample);

	if (activeCaretSamples.length > MAX_CARET_SAMPLES) {
		activeCaretSamples.shift();
	}
}

export function clearCaretSamples() {
	setActiveCaretSamples([]);
}
