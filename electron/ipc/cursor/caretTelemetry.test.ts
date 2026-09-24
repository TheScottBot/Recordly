import { beforeEach, describe, expect, it, vi } from "vitest";

const { screenStub } = vi.hoisted(() => ({
	screenStub: {
		// Windows only, and the whole reason this seam exists: the helper
		// reports physical pixels while the rest of the cursor path works in
		// Electron's device independent ones. 1.5 is the author's display.
		screenToDipPoint: vi.fn((point: { x: number; y: number }) => ({
			x: point.x / 1.5,
			y: point.y / 1.5,
		})),
		cursorDipPoint: { x: 0, y: 0 },
		getCursorScreenPoint(this: { cursorDipPoint: { x: number; y: number } }) {
			return this.cursorDipPoint;
		},
		getPrimaryDisplay: () => ({ scaleFactor: 1.5 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1464, height: 928 } }),
		getAllDisplays: () => [] as Array<{ id: number; bounds: unknown }>,
	},
}));

vi.mock("electron", () => ({ app: { getPath: vi.fn(() => "/tmp") } }));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => screenStub),
}));

import { setSelectedSource, setSelectedWindowBounds } from "../state";
import { normalizeCaretScreenPoint } from "./caretTelemetry";
import { getNormalizedCursorPoint } from "./telemetry";

describe("normalizeCaretScreenPoint", () => {
	beforeEach(() => {
		setSelectedSource(null);
		setSelectedWindowBounds(null);
		screenStub.cursorDipPoint = { x: 0, y: 0 };
		screenStub.screenToDipPoint.mockClear();
	});

	it("places a caret at the centre of a captured display at the centre of the frame", () => {
		// 1098 physical is 732 device independent, which is half of 1464.
		expect(normalizeCaretScreenPoint({ x: 1098, y: 696 })).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("converts through the device independent point rather than trusting raw pixels", () => {
		normalizeCaretScreenPoint({ x: 1098, y: 696 });

		expect(screenStub.screenToDipPoint).toHaveBeenCalledWith({ x: 1098, y: 696 });
	});

	/**
	 * The property that matters is not which coordinate space wins, but that a
	 * caret and a click at the same place on screen land at the same place in
	 * the frame. A typing zoom that disagreed with a click zoom about where the
	 * text field is would be worse than no typing zoom at all.
	 */
	it("agrees with a click at the same point on screen, while capturing a window", () => {
		setSelectedSource({ id: "window:42", name: "Editor" } as never);
		setSelectedWindowBounds({ x: 600, y: 300, width: 1200, height: 600 });
		screenStub.cursorDipPoint = { x: 800, y: 400 };

		const caret = normalizeCaretScreenPoint({ x: 1200, y: 600 });

		expect(caret).toEqual(getNormalizedCursorPoint());
	});

	it("agrees with a click at the same point on screen, while capturing a display", () => {
		screenStub.cursorDipPoint = { x: 300, y: 200 };

		const caret = normalizeCaretScreenPoint({ x: 450, y: 300 });

		expect(caret).toEqual(getNormalizedCursorPoint());
	});

	/**
	 * Clamping a caret that is off the captured area would pin the camera to an
	 * edge and hold it there for as long as someone typed into another window.
	 * Refusing the sample leaves a gap, and a gap means the camera holds the
	 * last caret it trusted.
	 */
	it("refuses a caret outside the captured area rather than clamping it", () => {
		expect(normalizeCaretScreenPoint({ x: -300, y: 696 })).toBeNull();
		expect(normalizeCaretScreenPoint({ x: 1098, y: 4_000 })).toBeNull();
	});

	it("refuses a caret outside the captured window", () => {
		setSelectedSource({ id: "window:42", name: "Editor" } as never);
		setSelectedWindowBounds({ x: 600, y: 300, width: 1200, height: 600 });

		expect(normalizeCaretScreenPoint({ x: 100, y: 600 })).toBeNull();
	});

	it("refuses a point that is not a finite pair", () => {
		expect(normalizeCaretScreenPoint({ x: Number.NaN, y: 10 })).toBeNull();
		expect(normalizeCaretScreenPoint({ x: 10, y: Number.POSITIVE_INFINITY })).toBeNull();
	});
});
