import { describe, expect, it } from "vitest";
import { parseCursorMonitorLine } from "./cursorMonitorProtocol";

describe("parseCursorMonitorLine", () => {
	it("reads a cursor shape change", () => {
		expect(parseCursorMonitorLine("STATE:text")).toEqual({
			kind: "cursor-state",
			cursorType: "text",
		});
	});

	it("refuses a cursor shape the renderer has no drawing for", () => {
		expect(parseCursorMonitorLine("STATE:banana")).toBeNull();
	});

	it("reads both mouse interactions, with and without a button", () => {
		expect(parseCursorMonitorLine("INTERACTION:mousedown")).toEqual({
			kind: "mouse-down",
			button: 1,
		});
		expect(parseCursorMonitorLine("INTERACTION:mousedown:3")).toEqual({
			kind: "mouse-down",
			button: 3,
		});
		expect(parseCursorMonitorLine("INTERACTION:mouseup")).toEqual({ kind: "mouse-up" });
	});

	/**
	 * The helper reports physical screen pixels because that is what UI
	 * Automation gives a per monitor DPI aware process. Turning those into the
	 * captured area's coordinates needs the display scale factor and the
	 * recorded bounds, neither of which the helper has, so it does not guess.
	 */
	it("reads a caret position as physical screen pixels", () => {
		expect(parseCursorMonitorLine("CARET:1462:938")).toEqual({
			kind: "caret",
			xPhysicalPixels: 1462,
			yPhysicalPixels: 938,
		});
	});

	it("reads a caret left of the primary display, which is a negative x", () => {
		expect(parseCursorMonitorLine("CARET:-1920:12")).toEqual({
			kind: "caret",
			xPhysicalPixels: -1920,
			yPhysicalPixels: 12,
		});
	});

	/**
	 * The source going quiet is worth reporting rather than inferring from
	 * silence: it is the difference between a caret that has not moved and an
	 * application that stopped answering.
	 */
	it("reads the caret source giving up", () => {
		expect(parseCursorMonitorLine("CARET:none")).toEqual({ kind: "caret-lost" });
	});

	it("refuses a caret line that is not a pair of whole numbers", () => {
		for (const line of [
			"CARET:",
			"CARET:12",
			"CARET:12:",
			"CARET:12:34:56",
			"CARET:1.5:2",
			"CARET:abc:12",
			"CARET: 12:34",
		]) {
			expect(parseCursorMonitorLine(line)).toBeNull();
		}
	});

	it("ignores anything it does not recognise, including blank lines and helper logging", () => {
		for (const line of ["", "   ", "ready", "STATE:", "CARET", "INTERACTION:scroll"]) {
			expect(parseCursorMonitorLine(line)).toBeNull();
		}
	});
});
