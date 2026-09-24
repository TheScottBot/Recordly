/**
 * What the scene camera needs from a recording, declared once.
 *
 * Every export path hands its configuration to a renderer by copying fields
 * one at a time, and there are three such lists. The caret track was added to
 * all three config types and to none of the three copies, so the preview
 * followed the caret and every export ignored it. It compiled perfectly and
 * the author found it in an exported GIF on 24 September 2026, where the
 * camera did not follow the page down as Enter pushed the caret to the
 * bottom.
 *
 * Spreading this instead means a new camera input reaches every path at once,
 * or none of them, which is a failure somebody would notice.
 */

import type { CursorTelemetryPoint } from "@/components/video-editor/types";
import type { CaretSample } from "@/lib/typingTelemetryContract";

export interface CameraInputs {
	cursorTelemetry?: CursorTelemetryPoint[];
	caretTrack?: readonly CaretSample[];
}

export function buildCameraInputs(source: CameraInputs): CameraInputs {
	return {
		cursorTelemetry: source.cursorTelemetry,
		caretTrack: source.caretTrack,
	};
}
