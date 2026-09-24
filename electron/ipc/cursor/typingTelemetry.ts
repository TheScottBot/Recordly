/**
 * The typing telemetry store and its sidecar.
 *
 * Typing lives beside the cursor telemetry rather than inside it, in
 * `<recording>.typing.json`. An event holds the time on the recording's own
 * clock and one boolean, and nothing else: no position, and nothing derived
 * from which key was pressed. See `PRIVACY.md`.
 */

import fs from "node:fs/promises";
import {
	type CaretSample,
	isSupportedTypingTelemetryVersion,
	normalizeCaretSamples,
	normalizeTypingEvents,
	TYPING_TELEMETRY_VERSION,
	type TypingEvent,
} from "../../../src/lib/typingTelemetryContract";
import {
	activeCaretSamples,
	activeTypingEvents,
	pendingCaretSamples,
	pendingTypingEvents,
	setPendingCaretSamples,
	setPendingTypingEvents,
} from "../state";
import { getTypingTelemetryPathForVideo } from "../utils";

/**
 * Records that a key was pressed. Called from the capture hook and nowhere
 * else, with a time already on the capture clock, so paused time is excluded
 * exactly as it is for pointer samples.
 */
export function pushTypingEvent(timeMs: number, keyProducesCharacter: boolean | undefined) {
	activeTypingEvents.push({
		timeMs: Math.max(0, timeMs),
		keyProducesCharacter,
	});
}

export type TypingTelemetrySidecarParseResult =
	| { status: "ok"; version: number; events: TypingEvent[]; caretSamples: CaretSample[] }
	| {
			status: "rejected";
			reason: "unsupported-version" | "malformed";
			version?: unknown;
			events: [];
	  };

/**
 * The boundary for bytes read back from disk. It refuses rather than guesses:
 * an unknown version or a shape that is not `{ version, events[] }` is
 * rejected with a reason the caller can count and report.
 */
export function parseTypingTelemetrySidecar(parsed: unknown): TypingTelemetrySidecarParseResult {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { status: "rejected", reason: "malformed", events: [] };
	}

	const sidecar = parsed as { version?: unknown; events?: unknown; caretSamples?: unknown };
	if (!Array.isArray(sidecar.events)) {
		return { status: "rejected", reason: "malformed", version: sidecar.version, events: [] };
	}

	if (!isSupportedTypingTelemetryVersion(sidecar.version)) {
		return {
			status: "rejected",
			reason: "unsupported-version",
			version: sidecar.version,
			events: [],
		};
	}

	return {
		status: "ok",
		version: sidecar.version as number,
		events: normalizeTypingEvents(sidecar.events),
		// A track that cannot be read is a lost camera path, which degrades a
		// zoom. Rejecting the whole file over it would lose the typing events
		// too and remove the zoom entirely, which is worse. A version 1 file
		// has no track at all and lands here as an empty one.
		caretSamples: normalizeCaretSamples(sidecar.caretSamples),
	};
}

/**
 * Writes the sidecar, or removes it when the recording held no typing, so
 * that a missing file means no typing rather than an unfinished write.
 */
export async function writeTypingTelemetry(
	videoPath: string,
	events: readonly TypingEvent[],
	caretSamples: readonly CaretSample[] = [],
) {
	const sidecarPath = getTypingTelemetryPathForVideo(videoPath);
	const normalizedEvents = normalizeTypingEvents(events);

	// Absence still means no typing. A caret track exists only because typing
	// did, so it can never be the only thing worth writing.
	if (normalizedEvents.length === 0) {
		await fs.rm(sidecarPath, { force: true });
		return normalizedEvents;
	}

	const normalizedCaretSamples = normalizeCaretSamples(caretSamples);

	await fs.writeFile(
		sidecarPath,
		JSON.stringify(
			{
				version: TYPING_TELEMETRY_VERSION,
				events: normalizedEvents,
				// Left out rather than written empty, so a file with the key
				// means a track was captured and one without means it was not.
				...(normalizedCaretSamples.length > 0
					? { caretSamples: normalizedCaretSamples }
					: {}),
			},
			null,
			2,
		),
		"utf-8",
	);

	return normalizedEvents;
}

/**
 * Appends anything newer than what is already pending, without duplicating
 * what a previous snapshot took. The caret track is carried the same way and
 * on the same call, because it belongs to the same file.
 */
function appendNewerByTime<Entry extends { timeMs: number }>(
	pending: readonly Entry[],
	active: readonly Entry[],
): Entry[] {
	if (pending.length === 0) {
		return [...active];
	}

	const lastPendingTimeMs = pending[pending.length - 1]?.timeMs ?? -1;
	return [...pending, ...active.filter((entry) => entry.timeMs > lastPendingTimeMs)];
}

export function snapshotTypingTelemetryForPersistence() {
	if (activeCaretSamples.length > 0) {
		setPendingCaretSamples(appendNewerByTime(pendingCaretSamples, activeCaretSamples));
	}

	if (activeTypingEvents.length === 0) {
		return;
	}

	setPendingTypingEvents(appendNewerByTime(pendingTypingEvents, activeTypingEvents));
}

export async function persistPendingTypingTelemetry(videoPath: string) {
	if (pendingTypingEvents.length > 0) {
		await writeTypingTelemetry(videoPath, pendingTypingEvents, pendingCaretSamples);
	}
	setPendingTypingEvents([]);
	setPendingCaretSamples([]);
}
