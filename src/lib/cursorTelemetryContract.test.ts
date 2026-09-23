import { describe, expect, it } from "vitest";
import {
	CURSOR_INTERACTION_TYPES,
	CURSOR_TELEMETRY_VERSION,
	isCursorInteractionType,
	isSupportedCursorTelemetryVersion,
	SUPPORTED_CURSOR_TELEMETRY_VERSIONS,
} from "./cursorTelemetryContract";

describe("cursor telemetry contract", () => {
	it("declares the six interaction values a cursor sample may carry, in one place", () => {
		// The order and the exact members are the contract. Adding or removing a
		// value here is a version decision, not an edit. Typing is deliberately
		// absent: it lives in its own sidecar, not in cursor telemetry.
		expect(CURSOR_INTERACTION_TYPES).toEqual([
			"move",
			"click",
			"double-click",
			"right-click",
			"middle-click",
			"mouseup",
		]);
	});

	it("recognises every declared interaction value and nothing else", () => {
		for (const declaredInteractionType of CURSOR_INTERACTION_TYPES) {
			expect(isCursorInteractionType(declaredInteractionType)).toBe(true);
		}

		expect(isCursorInteractionType("drag")).toBe(false);
		expect(isCursorInteractionType("keystroke")).toBe(false);
		expect(isCursorInteractionType("keydown")).toBe(false);
		expect(isCursorInteractionType(undefined)).toBe(false);
		expect(isCursorInteractionType(3)).toBe(false);
	});

	it("stays at version 2, because typing never enters this file", () => {
		expect(CURSOR_TELEMETRY_VERSION).toBe(2);
		expect(SUPPORTED_CURSOR_TELEMETRY_VERSIONS).toEqual([2]);
		expect(isSupportedCursorTelemetryVersion(2)).toBe(true);
	});

	it("does not treat an unknown, missing or non numeric version as supported", () => {
		expect(isSupportedCursorTelemetryVersion(1)).toBe(false);
		expect(isSupportedCursorTelemetryVersion(3)).toBe(false);
		expect(isSupportedCursorTelemetryVersion(undefined)).toBe(false);
		expect(isSupportedCursorTelemetryVersion("2")).toBe(false);
		expect(isSupportedCursorTelemetryVersion(Number.NaN)).toBe(false);
	});
});
