/**
 * Shared builders for cursor telemetry samples in renderer side tests.
 *
 * `zoomSuggestionUtils.test.ts` predates these and carries its own copies of
 * `makeClick`, `makeMove` and `withMoves`; those are left untouched so the
 * regression guard on click behaviour stays exactly as written. New tests
 * import from here.
 */

import type { TypingEvent } from "@/lib/typingTelemetryContract";
import type { CursorTelemetryPoint } from "../types";

export function makeClick(
	timeMs: number,
	cx = 0.5,
	cy = 0.5,
	interactionType: CursorTelemetryPoint["interactionType"] = "click",
): CursorTelemetryPoint {
	return { timeMs, cx, cy, interactionType };
}

export function makeMove(timeMs: number, cx = 0.5, cy = 0.5): CursorTelemetryPoint {
	return { timeMs, cx, cy, interactionType: "move" };
}

/** A typing event as the capture writes it: a time and one boolean, nothing else. */
export function makeKeystroke(
	timeMs: number,
	options: { keyProducesCharacter?: boolean } = {},
): TypingEvent {
	return { timeMs, keyProducesCharacter: options.keyProducesCharacter };
}

/** Evenly spaced character producing keystrokes starting at `firstMs`. */
export function makeTypingRun(firstMs: number, count: number, intervalMs = 120): TypingEvent[] {
	return Array.from({ length: count }, (_unusedSlot, index) =>
		makeKeystroke(firstMs + index * intervalMs, { keyProducesCharacter: true }),
	);
}

/** Wraps samples with surrounding move events to mimic real mixed telemetry. */
export function withMoves(
	samples: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	return [makeMove(0), ...samples, makeMove(totalMs)];
}
