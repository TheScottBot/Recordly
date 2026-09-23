import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "./projectPersistence";
import type { ZoomRegion } from "./types";

/**
 * Zoom regions exactly as a project saved before the zoom on typing work
 * holds them: one auto region such as a suggestion creates, one manual
 * region with a dragged focus, and one with no mode at all from an older
 * save. Decision ZD11 requires these to round trip unchanged, and nothing
 * the typing work adds may touch them.
 */
const ZOOM_REGIONS_SAVED_BEFORE_TYPING_WORK: ZoomRegion[] = [
	{
		id: "zoom-1",
		startMs: 4_500,
		endMs: 5_500,
		depth: 2,
		focus: { cx: 0.25, cy: 0.75 },
		mode: "auto",
	},
	{
		id: "zoom-2",
		startMs: 12_000,
		endMs: 15_250,
		depth: 4,
		focus: { cx: 0.6, cy: 0.4 },
		mode: "manual",
	},
	{
		id: "zoom-3",
		startMs: 20_000,
		endMs: 22_000,
		depth: 1,
		focus: { cx: 0.5, cy: 0.5 },
	},
];

describe("zoom regions from projects saved before the typing work", () => {
	it("round trip through normalisation unchanged", () => {
		const normalized = normalizeProjectEditor({
			zoomRegions: ZOOM_REGIONS_SAVED_BEFORE_TYPING_WORK.map((region) => ({ ...region })),
		});

		expect(normalized.zoomRegions).toEqual(ZOOM_REGIONS_SAVED_BEFORE_TYPING_WORK);
		expect(JSON.stringify(normalized.zoomRegions)).toBe(
			JSON.stringify(ZOOM_REGIONS_SAVED_BEFORE_TYPING_WORK),
		);
	});

	it("still drop a mode value that is neither auto nor manual, as before", () => {
		const normalized = normalizeProjectEditor({
			zoomRegions: [
				{
					...ZOOM_REGIONS_SAVED_BEFORE_TYPING_WORK[0],
					mode: "typing" as unknown as ZoomRegion["mode"],
				},
			],
		});

		expect(normalized.zoomRegions[0].mode).toBeUndefined();
	});
});

describe("the trigger that produced a zoom region", () => {
	it("round trips a typing triggered region", () => {
		const normalized = normalizeProjectEditor({
			zoomRegions: [
				{
					id: "zoom-typing",
					startMs: 5_500,
					endMs: 11_850,
					depth: 2,
					focus: { cx: 0.3, cy: 0.3 },
					mode: "auto",
					trigger: "typing",
				},
			],
		});

		expect(normalized.zoomRegions[0]).toEqual({
			id: "zoom-typing",
			startMs: 5_500,
			endMs: 11_850,
			depth: 2,
			focus: { cx: 0.3, cy: 0.3 },
			mode: "auto",
			trigger: "typing",
		});
	});

	it("leaves a region with no trigger without one, so projects saved before this work are unchanged", () => {
		const normalized = normalizeProjectEditor({
			zoomRegions: ZOOM_REGIONS_SAVED_BEFORE_TYPING_WORK.map((region) => ({ ...region })),
		});

		for (const region of normalized.zoomRegions) {
			expect(region).not.toHaveProperty("trigger");
		}
	});

	it("drops a trigger value it does not know", () => {
		const normalized = normalizeProjectEditor({
			zoomRegions: [
				{
					...ZOOM_REGIONS_SAVED_BEFORE_TYPING_WORK[0],
					trigger: "dictation" as unknown as ZoomRegion["trigger"],
				},
			],
		});

		expect(normalized.zoomRegions[0]).not.toHaveProperty("trigger");
	});
});
