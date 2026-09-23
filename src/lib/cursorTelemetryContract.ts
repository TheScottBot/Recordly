/**
 * The cursor telemetry sidecar contract, declared once.
 *
 * Both the Electron main process (which writes and reads the sidecar) and the
 * renderer (which consumes it) derive their types and their runtime checks
 * from this module, so the grammar cannot drift between a type union in one
 * tree and an allowlist in the other. This module has no Electron, React or
 * DOM dependency and must stay that way: it is imported from both sides.
 */

/**
 * Every value `interactionType` may carry, in declaration order. The runtime
 * allowlist and the TypeScript union are both derived from this tuple.
 *
 * Typing is not here: it is recorded in its own sidecar, declared in
 * `typingTelemetryContract.ts`, because a key press is not a cursor sample.
 */
export const CURSOR_INTERACTION_TYPES = [
	"move",
	"click",
	"double-click",
	"right-click",
	"middle-click",
	"mouseup",
] as const;

export type CursorInteractionType = (typeof CURSOR_INTERACTION_TYPES)[number];

const cursorInteractionTypeSet: ReadonlySet<string> = new Set(CURSOR_INTERACTION_TYPES);

export function isCursorInteractionType(value: unknown): value is CursorInteractionType {
	return typeof value === "string" && cursorInteractionTypeSet.has(value);
}

export type CursorVisualType =
	| "arrow"
	| "text"
	| "pointer"
	| "crosshair"
	| "open-hand"
	| "closed-hand"
	| "resize-ew"
	| "resize-ns"
	| "not-allowed";

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	pressure?: number;
	interactionType?: CursorInteractionType;
	cursorType?: CursorVisualType;
}

/**
 * The version written into every sidecar. It has never changed: typing was
 * added to Recordly without touching this file, so every recording ever made
 * reads and writes the same shape.
 */
export const CURSOR_TELEMETRY_VERSION = 2;

export const SUPPORTED_CURSOR_TELEMETRY_VERSIONS = [2] as const;

const supportedCursorTelemetryVersionSet: ReadonlySet<number> = new Set(
	SUPPORTED_CURSOR_TELEMETRY_VERSIONS,
);

export function isSupportedCursorTelemetryVersion(value: unknown): boolean {
	return typeof value === "number" && supportedCursorTelemetryVersionSet.has(value);
}
