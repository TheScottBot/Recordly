import { describe, expect, it } from "vitest";
import type { CaretSample } from "@/lib/typingTelemetryContract";
import { CARET_DEADZONE_RATIO, resolveCaretFollowFocus } from "./caretFollowCamera";

// Inside the valid focus bounds at every scale these tests use, so the clamp
// is not silently doing the work an assertion is meant to check.
const ANCHOR = { cx: 0.4, cy: 0.4 };
const SCALE = 1.5;
/** Half the visible extent at this scale, which the dead zone is measured against. */
const HALF_EXTENT = 1 / (2 * SCALE);
const DEADZONE = CARET_DEADZONE_RATIO * HALF_EXTENT;

function follow(caretTrack: CaretSample[], timeMs: number, zoomScale = SCALE) {
	return resolveCaretFollowFocus({
		caretTrack,
		regionStartMs: 0,
		timeMs,
		anchorFocus: ANCHOR,
		zoomScale,
	});
}

describe("resolveCaretFollowFocus", () => {
	it("keeps the click anchor when there is no track at all", () => {
		expect(follow([], 1_000)).toEqual(ANCHOR);
	});

	it("keeps the click anchor before the first caret has been seen", () => {
		expect(follow([{ timeMs: 900, cx: 0.8, cy: 0.8 }], 500)).toEqual(ANCHOR);
	});

	/**
	 * The click before the typing is a good guess at where the field is. The
	 * caret is the thing itself. Once one has been seen it wins, and it does so
	 * while the zoom is still easing in, so the correction is not read as a jump.
	 */
	it("moves to the first caret, which is better evidence than the click", () => {
		expect(follow([{ timeMs: 100, cx: 0.5, cy: 0.42 }], 200)).toEqual({ cx: 0.5, cy: 0.42 });
	});

	it("holds still while the caret moves about inside the dead zone", () => {
		const held = follow(
			[
				{ timeMs: 100, cx: 0.5, cy: 0.5 },
				{ timeMs: 350, cx: 0.5 + DEADZONE * 0.9, cy: 0.5 },
				{ timeMs: 600, cx: 0.5 - DEADZONE * 0.9, cy: 0.5 },
			],
			1_000,
		);

		expect(held).toEqual({ cx: 0.5, cy: 0.5 });
	});

	/**
	 * The camera moves the least it can: enough to bring the caret back to the
	 * edge of the dead zone, never enough to recentre it. Recentring would make
	 * every line break throw the camera across the frame.
	 */
	it("follows a caret that leaves the dead zone, trailing it by the dead zone", () => {
		const followed = follow(
			[
				{ timeMs: 100, cx: 0.5, cy: 0.5 },
				{ timeMs: 350, cx: 0.5, cy: 0.5 + DEADZONE * 2 },
			],
			1_000,
		);

		expect(followed.cy).toBeCloseTo(0.5 + DEADZONE, 10);
		expect(followed.cx).toBeCloseTo(0.5, 10);
	});

	/**
	 * The case the whole of this work exists for. While a page scrolls the
	 * caret holds one position on screen, so the camera must hold too.
	 */
	it("stops moving once a scrolling page pins the caret in place", () => {
		const climbing: CaretSample[] = [
			{ timeMs: 100, cx: 0.4, cy: 0.3 },
			{ timeMs: 350, cx: 0.4, cy: 0.45 },
			{ timeMs: 600, cx: 0.4, cy: 0.6 },
			{ timeMs: 850, cx: 0.4, cy: 0.75 },
		];
		const pinned: CaretSample[] = Array.from({ length: 40 }, (_unused, index) => ({
			timeMs: 1_100 + index * 250,
			cx: 0.4,
			cy: 0.75,
		}));

		const whenItSettled = follow([...climbing, ...pinned], 1_100);
		const muchLater = follow([...climbing, ...pinned], 11_000);

		expect(muchLater).toEqual(whenItSettled);
	});

	it("ignores samples from before the region, which belong to earlier typing", () => {
		const focus = follow(
			[
				{ timeMs: 100, cx: 0.9, cy: 0.9 },
				{ timeMs: 5_000, cx: 0.5, cy: 0.5 },
			],
			6_000,
		);

		const fromRegionStart = resolveCaretFollowFocus({
			caretTrack: [
				{ timeMs: 100, cx: 0.9, cy: 0.9 },
				{ timeMs: 5_000, cx: 0.5, cy: 0.5 },
			],
			regionStartMs: 4_000,
			timeMs: 6_000,
			anchorFocus: ANCHOR,
			zoomScale: SCALE,
		});

		expect(fromRegionStart).toEqual({ cx: 0.5, cy: 0.5 });
		expect(fromRegionStart).not.toEqual(focus);
	});

	it("follows sooner at a deeper zoom, where less of the frame is visible", () => {
		const track: CaretSample[] = [
			{ timeMs: 100, cx: 0.5, cy: 0.5 },
			{ timeMs: 350, cx: 0.5, cy: 0.5 + DEADZONE * 0.9 },
		];

		// That move sits inside the dead zone at 1.5x and outside it at 3x.
		expect(follow(track, 1_000, 1.5).cy).toBeCloseTo(0.5, 10);
		expect(follow(track, 1_000, 3).cy).toBeGreaterThan(0.5);
	});

	it("never lets the frame leave the video", () => {
		const focus = follow([{ timeMs: 100, cx: 0, cy: 1 }], 1_000);

		expect(focus.cx).toBeGreaterThanOrEqual(HALF_EXTENT - 1e-9);
		expect(focus.cy).toBeLessThanOrEqual(1 - HALF_EXTENT + 1e-9);
	});
});
