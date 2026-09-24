import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCameraInputs } from "./cameraInputs";
import { buildGifFrameRendererConfig } from "./gifExporter";

/**
 * The caret track has to survive the journey from the editor into each
 * renderer, and every export path hands its configuration over by copying
 * fields one at a time. The track was added to all three config types and to
 * none of the three copies, so the preview followed the caret and every
 * export ignored it. It compiled perfectly. The author found it in an
 * exported GIF on 24 September 2026: the camera did not follow the page down
 * as Enter pushed the caret to the bottom.
 */

describe("buildCameraInputs", () => {
	it("carries both of the camera's inputs", () => {
		const caretTrack = [{ timeMs: 100, cx: 0.4, cy: 0.3 }];
		const cursorTelemetry = [{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" as const }];

		expect(buildCameraInputs({ cursorTelemetry, caretTrack })).toEqual({
			cursorTelemetry,
			caretTrack,
		});
	});

	it("passes absence through as absence, for a recording that had neither", () => {
		expect(buildCameraInputs({})).toEqual({
			cursorTelemetry: undefined,
			caretTrack: undefined,
		});
	});
});

describe("the caret track reaches the gif renderer", () => {
	it("carries the track through to the frame renderer configuration", () => {
		const caretTrack = [
			{ timeMs: 100, cx: 0.4, cy: 0.3 },
			{ timeMs: 350, cx: 0.4, cy: 0.7 },
		];

		const built = buildGifFrameRendererConfig(
			{ caretTrack, zoomRegions: [], previewWidth: 100, previewHeight: 100 } as never,
			{ width: 100, height: 100 } as never,
		);

		expect(built.caretTrack).toEqual(caretTrack);
	});

	it("passes nothing on when the recording carried no track", () => {
		const built = buildGifFrameRendererConfig(
			{ zoomRegions: [], previewWidth: 100, previewHeight: 100 } as never,
			{ width: 100, height: 100 } as never,
		);

		expect(built.caretTrack).toBeUndefined();
	});
});

/**
 * A source check, because the other two paths assemble their configuration
 * inline inside a class method that cannot be called without a browser.
 *
 * An earlier version of this counted how often each field name appeared and
 * gave `modernVideoExporter.ts` a false pass, matching an unrelated line
 * while the renderer copy still dropped the track. Checking that the one
 * declaration is used says the thing that actually matters, and it keeps
 * saying it for the next camera input somebody adds.
 */
describe("every export path takes the camera's inputs from one declaration", () => {
	const exporterDirectory = path.join(process.cwd(), "src", "lib", "exporter");

	for (const file of ["gifExporter.ts", "videoExporter.ts", "modernVideoExporter.ts"]) {
		it(`${file} spreads buildCameraInputs rather than copying fields by hand`, () => {
			const source = fs.readFileSync(path.join(exporterDirectory, file), "utf8");

			expect(source).toContain("...buildCameraInputs(");
			// The hand copy this replaced must not creep back alongside it.
			expect(source).not.toMatch(/cursorTelemetry: (this\.)?config\.cursorTelemetry,/);
		});
	}
});
