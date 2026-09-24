/**
 * The line protocol `cursor-monitor` speaks, parsed in one place.
 *
 * Pure, so the grammar can be tested without Electron, a spawned process or a
 * real cursor. `handleCursorMonitorStdout` owns the buffering and the side
 * effects; this owns only what a line means.
 */

import type { CursorVisualType } from "../types";

export type CursorMonitorMessage =
	| { kind: "cursor-state"; cursorType: CursorVisualType }
	| { kind: "mouse-down"; button: 1 | 2 | 3 }
	| { kind: "mouse-up" }
	| { kind: "caret"; xPhysicalPixels: number; yPhysicalPixels: number }
	| { kind: "caret-lost" };

const DRAWABLE_CURSOR_TYPES: ReadonlySet<string> = new Set<CursorVisualType>([
	"arrow",
	"text",
	"pointer",
	"crosshair",
	"open-hand",
	"closed-hand",
	"resize-ew",
	"resize-ns",
	"not-allowed",
]);

export function parseCursorMonitorLine(line: string): CursorMonitorMessage | null {
	const interactionMatch = line.match(/^INTERACTION:(mousedown|mouseup)(?::([123]))?$/);
	if (interactionMatch) {
		if (interactionMatch[1] === "mouseup") {
			return { kind: "mouse-up" };
		}
		const button = Number(interactionMatch[2]);
		return { kind: "mouse-down", button: button === 2 || button === 3 ? button : 1 };
	}

	if (line === "CARET:none") {
		return { kind: "caret-lost" };
	}

	// Whole numbers only, and a leading minus is allowed because a display left
	// of the primary one has negative screen coordinates.
	const caretMatch = line.match(/^CARET:(-?\d+):(-?\d+)$/);
	if (caretMatch) {
		return {
			kind: "caret",
			xPhysicalPixels: Number(caretMatch[1]),
			yPhysicalPixels: Number(caretMatch[2]),
		};
	}

	const stateMatch = line.match(/^STATE:(.+)$/);
	if (stateMatch) {
		const cursorType = stateMatch[1].trim();
		return DRAWABLE_CURSOR_TYPES.has(cursorType)
			? { kind: "cursor-state", cursorType: cursorType as CursorVisualType }
			: null;
	}

	return null;
}
