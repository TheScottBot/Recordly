import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint, ZoomRegion } from "../types";
import { createCursorFollowCameraState } from "./cursorFollowCamera";
import {
	resolvePreviewMotionMode,
	resolveSceneZoomTarget,
	shouldComposePreviewFrame,
} from "./sceneMotion";

const region: ZoomRegion = {
	id: "zoom",
	startMs: 0,
	endMs: 4000,
	depth: 2,
	focus: { cx: 0.7, cy: 0.3 },
	mode: "manual",
};

describe("resolveSceneZoomTarget", () => {
	it("returns the neutral camera when no zoom is active", () => {
		expect(
			resolveSceneZoomTarget({
				zoomRegions: [],
				timeMs: 1000,
				cursorFollowCamera: createCursorFollowCameraState(),
			}),
		).toEqual({ scale: 1, focus: { cx: 0.5, cy: 0.5 }, progress: 0 });
	});

	it("resolves the same manual target for every rendering backend", () => {
		const target = resolveSceneZoomTarget({
			zoomRegions: [region],
			timeMs: 2000,
			cursorFollowCamera: createCursorFollowCameraState(),
		});

		expect(target.scale).toBeGreaterThan(1);
		// The scene evaluator clamps focus so the zoom never exposes the stage edge.
		expect(target.focus.cx).toBeCloseTo(2 / 3);
		expect(target.focus.cy).toBeCloseTo(1 / 3);
		expect(target.progress).toBe(1);
	});
});

describe("a typing zoom holds its focus instead of chasing the pointer", () => {
	// The pointer sits far from the text, which is what really happens: in the
	// recording of 23 September 2026 it was 0.587 away from the field and
	// motionless for the whole burst.
	const parkedPointer: CursorTelemetryPoint[] = [
		{ timeMs: 0, cx: 0.9, cy: 0.9, interactionType: "move" },
		{ timeMs: 4000, cx: 0.9, cy: 0.9, interactionType: "move" },
	];
	const typingRegion: ZoomRegion = {
		id: "zoom-typing",
		startMs: 0,
		endMs: 4000,
		depth: 2,
		focus: { cx: 0.3, cy: 0.3 },
		mode: "auto",
		trigger: "typing",
	};

	function focusAfterTwoFrames(region: ZoomRegion) {
		const camera = createCursorFollowCameraState();
		resolveSceneZoomTarget({
			zoomRegions: [region],
			timeMs: 2000,
			cursorTelemetry: parkedPointer,
			cursorFollowCamera: camera,
		});
		// The first frame only seeds the camera; any drift shows on the next one.
		return resolveSceneZoomTarget({
			zoomRegions: [region],
			timeMs: 2100,
			cursorTelemetry: parkedPointer,
			cursorFollowCamera: camera,
		}).focus;
	}

	it("keeps a typing region on the field it anchored to", () => {
		const focus = focusAfterTwoFrames(typingRegion);

		expect(focus.cx).toBeCloseTo(1 / 3);
		expect(focus.cy).toBeCloseTo(1 / 3);
	});

	it("still lets a click region follow the pointer, which is where the attention is", () => {
		const clickRegion: ZoomRegion = { ...typingRegion, id: "zoom-click", trigger: undefined };

		const focus = focusAfterTwoFrames(clickRegion);

		expect(focus.cx).toBeGreaterThan(1 / 3);
		expect(focus.cy).toBeGreaterThan(1 / 3);
	});
});

describe("resolvePreviewMotionMode", () => {
	it.each([false, true])("preserves a plain pause with classic mode %s", (zoomClassicMode) => {
		expect(
			resolvePreviewMotionMode({
				isPlaying: false,
				isSeeking: false,
				shouldSnapPausedFrame: false,
				zoomClassicMode,
			}),
		).toBe("preserve");
	});

	it("snaps paused frames only for an intentional timeline seek", () => {
		expect(
			resolvePreviewMotionMode({
				isPlaying: false,
				isSeeking: false,
				shouldSnapPausedFrame: true,
				zoomClassicMode: false,
			}),
		).toBe("snap");
	});
});

describe("shouldComposePreviewFrame", () => {
	it("holds every visual sample, including blur and cursor state, while paused", () => {
		expect(
			shouldComposePreviewFrame({
				motionMode: "preserve",
				contentTimeChanged: true,
				shouldSnapPausedFrame: false,
			}),
		).toBe(false);
	});

	it("does not interpolate again at an unchanged playback timestamp", () => {
		expect(
			shouldComposePreviewFrame({
				motionMode: "spring",
				contentTimeChanged: false,
				shouldSnapPausedFrame: false,
			}),
		).toBe(false);
	});

	it("composes one exact frame when a seek requests it", () => {
		expect(
			shouldComposePreviewFrame({
				motionMode: "snap",
				contentTimeChanged: false,
				shouldSnapPausedFrame: true,
			}),
		).toBe(true);
	});
});

describe("preview seek completion", () => {
	it("holds the composed frame until seeking finishes, even with a pending refresh", () => {
		const pending = {
			motionMode: "snap" as const,
			contentTimeChanged: true,
			shouldSnapPausedFrame: true,
		};
		expect(shouldComposePreviewFrame({ ...pending, isSeeking: true })).toBe(false);
		expect(shouldComposePreviewFrame({ ...pending, isSeeking: false })).toBe(true);
	});
});
