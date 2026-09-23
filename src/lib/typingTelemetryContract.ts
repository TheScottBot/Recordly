/**
 * The typing telemetry sidecar contract, declared once.
 *
 * Typing is recorded beside a recording in its own file,
 * `<recording>.typing.json`, rather than inside the cursor telemetry
 * sidecar: a key press is not a cursor sample, it competes with nothing for
 * the cursor sample budget, and keeping it apart makes the one file that
 * holds keyboard derived data obvious to find, inspect and delete.
 *
 * A typing event is the least that can answer when someone was typing: the
 * time, and one boolean saying whether the key would normally produce a
 * character. It carries no position, because the focus of a typing zoom
 * always comes from the click that preceded it, never from the pointer. It
 * carries nothing about which key was pressed; see `PRIVACY.md`.
 *
 * No Electron, React or DOM dependency: both trees import this.
 */

export interface TypingEvent {
	timeMs: number;
	/**
	 * True when the key would normally produce a character (a letter, digit,
	 * space, punctuation mark, Enter, Backspace or Delete); false for
	 * modifier, navigation and function keys; absent when the capture could
	 * not tell.
	 */
	keyProducesCharacter?: boolean;
}

export const TYPING_TELEMETRY_VERSION = 1;

export const SUPPORTED_TYPING_TELEMETRY_VERSIONS = [1] as const;

const supportedTypingTelemetryVersionSet: ReadonlySet<number> = new Set(
	SUPPORTED_TYPING_TELEMETRY_VERSIONS,
);

export function isSupportedTypingTelemetryVersion(value: unknown): boolean {
	return typeof value === "number" && supportedTypingTelemetryVersionSet.has(value);
}

/**
 * Rebuilds every event from scratch rather than copying the input, so a
 * field that has no business being here cannot survive a round trip however
 * it arrived.
 */
export function normalizeTypingEvents(rawEvents: unknown): TypingEvent[] {
	if (!Array.isArray(rawEvents)) {
		return [];
	}

	return rawEvents
		.filter((event: unknown) => Boolean(event) && typeof event === "object")
		.map((event: unknown) => {
			const candidate = event as Partial<TypingEvent>;
			return {
				timeMs:
					typeof candidate.timeMs === "number" && Number.isFinite(candidate.timeMs)
						? Math.max(0, candidate.timeMs)
						: 0,
				keyProducesCharacter:
					typeof candidate.keyProducesCharacter === "boolean"
						? candidate.keyProducesCharacter
						: undefined,
			};
		})
		.sort((earlier, later) => earlier.timeMs - later.timeMs);
}
