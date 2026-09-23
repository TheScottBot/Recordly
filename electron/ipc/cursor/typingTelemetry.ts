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
	isSupportedTypingTelemetryVersion,
	normalizeTypingEvents,
	TYPING_TELEMETRY_VERSION,
	type TypingEvent,
} from "../../../src/lib/typingTelemetryContract";
import { activeTypingEvents, pendingTypingEvents, setPendingTypingEvents } from "../state";
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
	| { status: "ok"; version: number; events: TypingEvent[] }
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

	const sidecar = parsed as { version?: unknown; events?: unknown };
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
	};
}

/**
 * Writes the sidecar, or removes it when the recording held no typing, so
 * that a missing file means no typing rather than an unfinished write.
 */
export async function writeTypingTelemetry(videoPath: string, events: readonly TypingEvent[]) {
	const sidecarPath = getTypingTelemetryPathForVideo(videoPath);
	const normalizedEvents = normalizeTypingEvents(events);

	if (normalizedEvents.length === 0) {
		await fs.rm(sidecarPath, { force: true });
		return normalizedEvents;
	}

	await fs.writeFile(
		sidecarPath,
		JSON.stringify({ version: TYPING_TELEMETRY_VERSION, events: normalizedEvents }, null, 2),
		"utf-8",
	);

	return normalizedEvents;
}

export function snapshotTypingTelemetryForPersistence() {
	if (activeTypingEvents.length === 0) {
		return;
	}

	if (pendingTypingEvents.length === 0) {
		setPendingTypingEvents([...activeTypingEvents]);
		return;
	}

	const lastPendingTimeMs = pendingTypingEvents[pendingTypingEvents.length - 1]?.timeMs ?? -1;
	setPendingTypingEvents([
		...pendingTypingEvents,
		...activeTypingEvents.filter((event) => event.timeMs > lastPendingTimeMs),
	]);
}

export async function persistPendingTypingTelemetry(videoPath: string) {
	if (pendingTypingEvents.length > 0) {
		await writeTypingTelemetry(videoPath, pendingTypingEvents);
	}
	setPendingTypingEvents([]);
}
