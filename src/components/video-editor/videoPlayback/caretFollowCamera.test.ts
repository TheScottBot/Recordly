import { describe, expect, it } from "vitest";
import type { CaretSample } from "@/lib/typingTelemetryContract";
import {
	CARET_DEADZONE_RATIO,
	CARET_MAX_PAN_PER_SECOND,
	CARET_PAN_RESPONSIVENESS,
	resolveCaretFollowFocus,
} from "./caretFollowCamera";

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
		regionEndMs: 30_000,
		timeMs,
		anchorFocus: ANCHOR,
		zoomScale,
	});
}

describe("resolveCaretFollowFocus", () => {
	it("keeps the click anchor when there is no track at all", () => {
		expect(follow([], 1_000)).toEqual(ANCHOR);
	});

	it("keeps the click anchor when the track holds nothing for this region", () => {
		const outsideTheRegion = resolveCaretFollowFocus({
			caretTrack: [{ timeMs: 40_000, cx: 0.8, cy: 0.8 }],
			regionStartMs: 0,
			regionEndMs: 30_000,
			timeMs: 1_000,
			anchorFocus: ANCHOR,
			zoomScale: SCALE,
		});

		expect(outsideTheRegion).toEqual(ANCHOR);
	});

	/**
	 * The zoom opens already pointed at the text, rather than opening on the
	 * click and sliding across to the text afterwards. The author described
	 * that slide on 24 September 2026 as going "centre then centres on
	 * typing".
	 *
	 * Aiming ahead of the evidence is how a click zoom already works: its
	 * region begins half a second before the click it is named for, so the
	 * camera is pointed at a click that has not happened yet. This is recorded
	 * data being replayed, not a live camera, and the same function runs in
	 * the preview and in every export, so the two cannot disagree about it.
	 */
	it("opens already pointed at the first caret of the region, before that caret arrives", () => {
		// Inside the clampable range at this scale, so the assertion is about
		// where the camera aimed and not about where the clamp put it.
		const track: CaretSample[] = [{ timeMs: 900, cx: 0.6, cy: 0.62 }];

		expect(follow(track, 0)).toEqual({ cx: 0.6, cy: 0.62 });
		expect(follow(track, 500)).toEqual({ cx: 0.6, cy: 0.62 });
	});

	it("holds still while the caret moves about inside the dead zone", () => {
		const first = { timeMs: 100, cx: 0.5, cy: 0.5 };
		const held = follow(
			[
				first,
				{ timeMs: 350, cx: 0.5 + DEADZONE * 0.9, cy: 0.5 },
				{ timeMs: 600, cx: 0.5 - DEADZONE * 0.9, cy: 0.5 },
				{ timeMs: 850, cx: 0.5, cy: 0.5 + DEADZONE * 0.9 },
			],
			5_000,
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
			5_000,
		);

		expect(followed.cy).toBeCloseTo(0.5 + DEADZONE, 6);
		expect(followed.cx).toBeCloseTo(0.5, 6);
	});

	/**
	 * Selecting everything and typing over it does not move the caret from the
	 * bottom of the page to the top: it stops being at the bottom. A camera
	 * that crawls across in response misses what is being typed, which the
	 * author reported on 24 September 2026. Speed rises with distance, so a
	 * relocation is quick and a correction is not.
	 */
	it("closes a long jump far faster than a short one", () => {
		const longJump: CaretSample[] = [
			{ timeMs: 100, cx: 0.4, cy: 0.75 },
			{ timeMs: 350, cx: 0.4, cy: 0.25 },
		];
		const shortJump: CaretSample[] = [
			{ timeMs: 100, cx: 0.4, cy: 0.75 },
			{ timeMs: 350, cx: 0.4, cy: 0.7 },
		];

		const longTravelled = Math.abs(follow(longJump, 600).cy - 0.75);
		const shortTravelled = Math.abs(follow(shortJump, 600).cy - 0.75);

		expect(longTravelled).toBeGreaterThan(shortTravelled * 4);
	});

	it("has a long jump essentially done within half a second", () => {
		const track: CaretSample[] = [
			{ timeMs: 0, cx: 0.4, cy: 0.75 },
			{ timeMs: 100, cx: 0.4, cy: 0.25 },
		];
		// Where it is heading: the caret, plus the dead zone it trails by.
		const destination = 0.25 + DEADZONE;
		const remaining = Math.abs(follow(track, 600).cy - destination);

		expect(remaining).toBeLessThan(0.05);
	});

	/**
	 * Quick is not the same as instant. A camera that jumped to each sample
	 * would be the lurch the author reported earlier the same day, measured at
	 * 0.249 of the frame in a single frame of preview.
	 */
	it("never moves faster than the ceiling allows, however far the caret goes", () => {
		const track: CaretSample[] = [
			{ timeMs: 100, cx: 0.4, cy: 0.4 },
			{ timeMs: 350, cx: 0.95, cy: 0.95 },
		];
		let previous = follow(track, 0);
		let worstStep = 0;

		// One frame at sixty a second, which is what the preview composes at.
		for (let timeMs = 16; timeMs <= 4_000; timeMs += 16) {
			const focus = follow(track, timeMs);
			worstStep = Math.max(
				worstStep,
				Math.hypot(focus.cx - previous.cx, focus.cy - previous.cy),
			);
			previous = focus;
		}

		expect(worstStep).toBeLessThanOrEqual((CARET_MAX_PAN_PER_SECOND * 16) / 1_000 + 1e-9);
	});

	/**
	 * The case the whole of this work exists for. While a page scrolls the
	 * caret holds one position on screen, so the camera must hold too.
	 */
	it("stops moving once a scrolling page pins the caret in place", () => {
		const climbing: CaretSample[] = [
			{ timeMs: 100, cx: 0.4, cy: 0.45 },
			{ timeMs: 350, cx: 0.4, cy: 0.55 },
			{ timeMs: 600, cx: 0.4, cy: 0.65 },
			{ timeMs: 850, cx: 0.4, cy: 0.75 },
		];
		const pinned: CaretSample[] = Array.from({ length: 60 }, (_unused, index) => ({
			timeMs: 1_100 + index * 250,
			cx: 0.4,
			cy: 0.75,
		}));

		const onceSettled = follow([...climbing, ...pinned], 6_000);
		const muchLater = follow([...climbing, ...pinned], 14_000);

		expect(muchLater).toEqual(onceSettled);
	});

	it("ignores samples from before the region, which belong to earlier typing", () => {
		const track: CaretSample[] = [
			{ timeMs: 100, cx: 0.4, cy: 0.9 },
			{ timeMs: 5_000, cx: 0.55, cy: 0.45 },
		];

		const fromRegionStart = resolveCaretFollowFocus({
			caretTrack: track,
			regionStartMs: 4_000,
			regionEndMs: 30_000,
			timeMs: 9_000,
			anchorFocus: ANCHOR,
			zoomScale: SCALE,
		});

		// Only the later sample belongs to this region, so the zoom opens on it.
		expect(fromRegionStart).toEqual({ cx: 0.55, cy: 0.45 });
		// Counting the early one would open the zoom lower down the frame.
		expect(follow(track, 9_000).cy).toBeGreaterThan(0.45);
	});

	it("keeps the responsiveness and the ceiling in a sane relation to each other", () => {
		// The ceiling must not be so low that it undoes the proportional speed
		// for any jump that fits in the frame, which is what would bring the
		// crawl back.
		expect(CARET_MAX_PAN_PER_SECOND).toBeGreaterThanOrEqual(CARET_PAN_RESPONSIVENESS * 0.5);
	});

	it("follows sooner at a deeper zoom, where less of the frame is visible", () => {
		const track: CaretSample[] = [
			{ timeMs: 100, cx: 0.4, cy: 0.4 },
			{ timeMs: 350, cx: 0.4, cy: 0.4 + DEADZONE * 0.7 },
		];

		// That distance sits inside the dead zone at 1.5x and outside it at 3x.
		expect(follow(track, 6_000, 1.5).cy).toBeCloseTo(0.4, 6);
		expect(follow(track, 6_000, 3).cy).toBeGreaterThan(0.4);
	});

	it("never lets the frame leave the video", () => {
		const focus = follow([{ timeMs: 100, cx: 0, cy: 1 }], 20_000);

		expect(focus.cx).toBeGreaterThanOrEqual(HALF_EXTENT - 1e-9);
		expect(focus.cy).toBeLessThanOrEqual(1 - HALF_EXTENT + 1e-9);
	});
});
