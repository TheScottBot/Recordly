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

/**
 * Where the caret was, sampled while someone was typing, in the same
 * normalised coordinates as a cursor sample: `0,0` is the top left of the
 * captured area and `1,1` its bottom right.
 *
 * This exists because a typing zoom anchored to the click before the typing
 * holds one fixed point, and text scrolls. Type enough lines and the words
 * that began at the top of the page finish at the bottom, with the camera
 * still pointed at the top. A caret track is the only thing that follows
 * that, and the author reported exactly this on 23 September 2026.
 *
 * It says where on screen the caret was, never what was typed. See
 * `PRIVACY.md`.
 */
export interface CaretSample {
	timeMs: number;
	cx: number;
	cy: number;
}

/**
 * Version 2 added `caretSamples`. Version 3 added `caretTrackTruncated`, so a
 * track that ran into the sample cap can say so instead of looking complete:
 * a zoom that stops following because the track ran out is otherwise
 * indistinguishable from a zoom that is broken. Earlier versions are still
 * read, and carry neither.
 */
export const TYPING_TELEMETRY_VERSION = 3;

export const SUPPORTED_TYPING_TELEMETRY_VERSIONS = [1, 2, 3] as const;

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

function isPositionInsideCapturedArea(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Rebuilds every sample from scratch, for the same reason
 * `normalizeTypingEvents` does.
 *
 * A sample outside the captured area is dropped rather than clamped. Clamping
 * would pin the camera to an edge and hold it there for as long as someone
 * typed into another window, which reads as a stuck zoom; dropping leaves the
 * track with a gap, and a gap means the camera holds the last caret it
 * trusted.
 */
export function normalizeCaretSamples(rawSamples: unknown): CaretSample[] {
	if (!Array.isArray(rawSamples)) {
		return [];
	}

	return rawSamples
		.filter((sample: unknown) => Boolean(sample) && typeof sample === "object")
		.map((sample: unknown) => sample as Partial<CaretSample>)
		.filter(
			(sample) =>
				isPositionInsideCapturedArea(sample.cx) && isPositionInsideCapturedArea(sample.cy),
		)
		.map((sample) => ({
			timeMs:
				typeof sample.timeMs === "number" && Number.isFinite(sample.timeMs)
					? Math.max(0, sample.timeMs)
					: 0,
			cx: sample.cx as number,
			cy: sample.cy as number,
		}))
		.sort((earlier, later) => earlier.timeMs - later.timeMs);
}
