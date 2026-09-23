/**
 * Shared fixtures for cursor telemetry sidecar tests.
 *
 * These stand in for files Recordly has actually written, so every phase of
 * the zoom on typing work asserts against the same bytes rather than each test
 * inventing its own sidecar. Version 2 is the format every existing recording
 * on every machine carries; it must keep loading unchanged.
 */

import type { CursorTelemetryPoint } from "../../../src/lib/cursorTelemetryContract";

export const VERSION_TWO_SIDECAR_SAMPLES: CursorTelemetryPoint[] = [
	{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move", cursorType: "arrow" },
	{ timeMs: 33, cx: 0.52, cy: 0.5, interactionType: "move", cursorType: "arrow" },
	{ timeMs: 66, cx: 0.55, cy: 0.51, interactionType: "click", cursorType: "pointer" },
	{ timeMs: 140, cx: 0.55, cy: 0.51, interactionType: "mouseup", cursorType: "pointer" },
	{ timeMs: 173, cx: 0.55, cy: 0.51, interactionType: "move", cursorType: "text" },
];

/** The parsed shape of a sidecar written by Recordly before this work. */
export function buildVersionTwoSidecar(): { version: number; samples: CursorTelemetryPoint[] } {
	return { version: 2, samples: VERSION_TWO_SIDECAR_SAMPLES.map((sample) => ({ ...sample })) };
}
