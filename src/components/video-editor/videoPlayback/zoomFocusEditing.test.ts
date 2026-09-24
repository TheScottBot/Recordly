import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { applyZoomFocusEdit, isZoomFocusAdjustable } from "./zoomFocusEditing";

const clickRegion: ZoomRegion = {
	id: "zoom-click",
	startMs: 0,
	endMs: 2_000,
	depth: 2,
	focus: { cx: 0.3, cy: 0.3 },
	mode: "auto",
};
const typingRegion: ZoomRegion = { ...clickRegion, id: "zoom-typing", trigger: "typing" };
const manualRegion: ZoomRegion = { ...clickRegion, id: "zoom-manual", mode: "manual" };

describe("isZoomFocusAdjustable", () => {
	it("offers the handle on a typing zoom, whose focus is a guess worth correcting", () => {
		expect(isZoomFocusAdjustable(typingRegion)).toBe(true);
	});

	it("offers it on a manual zoom, as it always has", () => {
		expect(isZoomFocusAdjustable(manualRegion)).toBe(true);
	});

	it("withholds it on a click zoom, which tracks the pointer rather than a fixed point", () => {
		expect(isZoomFocusAdjustable(clickRegion)).toBe(false);
	});

	it("withholds it when there is no region at all", () => {
		expect(isZoomFocusAdjustable(null)).toBe(false);
	});
});

describe("applyZoomFocusEdit", () => {
	it("records that a dragged typing zoom is now the person's choice, not a suggestion", () => {
		const edited = applyZoomFocusEdit(typingRegion, { cx: 0.62, cy: 0.44 });

		expect(edited.focus).toEqual({ cx: 0.62, cy: 0.44 });
		// Manual means a fixed focus: nothing may move it afterwards, including
		// the caret track this work is heading towards.
		expect(edited.mode).toBe("manual");
		expect(edited.trigger).toBe("typing");
	});

	it("leaves a manual zoom manual", () => {
		const edited = applyZoomFocusEdit(manualRegion, { cx: 0.1, cy: 0.2 });

		expect(edited.mode).toBe("manual");
		expect(edited.focus).toEqual({ cx: 0.1, cy: 0.2 });
	});

	it("does not change the mode of a click zoom, whose camera behaviour is not this edit's business", () => {
		const edited = applyZoomFocusEdit(clickRegion, { cx: 0.1, cy: 0.2 });

		expect(edited.mode).toBe("auto");
	});

	it("clamps a focus dragged outside the frame", () => {
		const edited = applyZoomFocusEdit(typingRegion, { cx: 1.8, cy: -0.4 });

		expect(edited.focus).toEqual({ cx: 1, cy: 0 });
	});

	it("returns a new region rather than mutating the one it was given", () => {
		const edited = applyZoomFocusEdit(typingRegion, { cx: 0.5, cy: 0.5 });

		expect(edited).not.toBe(typingRegion);
		expect(typingRegion.focus).toEqual({ cx: 0.3, cy: 0.3 });
		expect(typingRegion.mode).toBe("auto");
	});
});
