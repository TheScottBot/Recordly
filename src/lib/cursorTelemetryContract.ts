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
 * `keystroke` records that a key was pressed and when. It never carries which
 * key; see `PRIVACY.md`.
 */
export const CURSOR_INTERACTION_TYPES = [
	"move",
	"click",
	"double-click",
	"right-click",
	"middle-click",
	"mouseup",
	"keystroke",
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
	/**
	 * Present only on `keystroke` samples. True when the key would normally
	 * produce a character (a letter, digit, space, punctuation, Enter or
	 * Backspace); false for modifier, navigation and function keys. This one
	 * bit is the most that may be derived from key identity.
	 */
	keyProducesCharacter?: boolean;
}

/**
 * The version written into every new sidecar. Version 2 is what every
 * recording made before the keystroke value existed carries; version 3 adds
 * `keystroke` and `keyProducesCharacter`. Both must load.
 */
export const CURSOR_TELEMETRY_VERSION = 3;

export const SUPPORTED_CURSOR_TELEMETRY_VERSIONS = [2, 3] as const;

const supportedCursorTelemetryVersionSet: ReadonlySet<number> = new Set(
	SUPPORTED_CURSOR_TELEMETRY_VERSIONS,
);

export function isSupportedCursorTelemetryVersion(value: unknown): boolean {
	return typeof value === "number" && supportedCursorTelemetryVersionSet.has(value);
}
