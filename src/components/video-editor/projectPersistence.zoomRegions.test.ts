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
