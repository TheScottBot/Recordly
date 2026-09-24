import type { TypingEvent } from "@/lib/typingTelemetryContract";
import type { CursorTelemetryPoint, ZoomFocus, ZoomTrigger } from "../types";
import { clusterByTimeGap } from "./timeGapClustering";
import { buildTypingBurstCandidates, type TypingBurstCandidate } from "./typingBurstUtils";
import { CLICK_CLUSTER_MERGE_GAP_MS, CLICK_CLUSTER_PAD_MS } from "./zoomSuggestionConstants";

export { CLICK_CLUSTER_MERGE_GAP_MS, CLICK_CLUSTER_PAD_MS } from "./zoomSuggestionConstants";

export const MIN_DWELL_DURATION_MS = 450;
export const MAX_DWELL_DURATION_MS = 2600;
export const DWELL_MOVE_THRESHOLD = 0.02;
export const MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO = 1.2;

export interface ZoomDwellCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
}

export interface CursorInteractionCandidate extends ZoomDwellCandidate {
	kind:
		| "dwell"
		| "click-like"
		| "double-click-like"
		| "text-focus-like"
		| "dropdown-open"
		| "text-selection"
		| "text-field-click";
	source: "explicit" | "heuristic";
}

export interface SuggestedZoomRegion {
	start: number;
	end: number;
	focus: ZoomFocus;
	/**
	 * Present only on a region typing produced. A click region carries no
	 * trigger, so a recording with no typing yields byte for byte the
	 * suggestions it always did.
	 */
	trigger?: ZoomTrigger;
}

export type InteractionZoomSuggestionStatus =
	| "ok"
	| "no-telemetry"
	| "no-interactions"
	| "no-slots";

/**
 * What the typing path did, present only when the telemetry held keystroke
 * samples so that a recording with no typing returns exactly what it always
 * has. `burstsLimitedByClick` counts bursts whose extension was cut short or
 * dropped because a click cluster or a reserved span was in the way: the
 * click's own region always wins.
 */
export interface TypingSuggestionSummary {
	burstsDetected: number;
	burstsApplied: number;
	burstsDeclinedForFocus: number;
	burstsLimitedByClick: number;
}

export interface InteractionZoomSuggestionResult {
	status: InteractionZoomSuggestionStatus;
	suggestions: SuggestedZoomRegion[];
	typing?: TypingSuggestionSummary;
}

export function shouldAutoApplyFreshRecordingZoomsForSource(
	sourceWidth?: number,
	sourceHeight?: number,
	platform?: string,
): boolean {
	// Window capture on Windows legitimately produces portrait and near-square
	// sources. Click telemetry is already normalized to that captured window, so
	// its aspect ratio is not a reason to suppress interaction-based zooms.
	if (platform === "win32") {
		return true;
	}

	if (
		!Number.isFinite(sourceWidth) ||
		!Number.isFinite(sourceHeight) ||
		(sourceWidth ?? 0) <= 0 ||
		(sourceHeight ?? 0) <= 0
	) {
		return true;
	}

	return (
		(sourceWidth as number) / (sourceHeight as number) >=
		MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO
	);
}

const EXPLICIT_CLICK_TYPES = new Set<NonNullable<CursorTelemetryPoint["interactionType"]>>([
	"click",
	"double-click",
	"right-click",
	"middle-click",
]);

function isExplicitClickType(
	interactionType: CursorTelemetryPoint["interactionType"],
): interactionType is NonNullable<CursorTelemetryPoint["interactionType"]> {
	return typeof interactionType === "string" && EXPLICIT_CLICK_TYPES.has(interactionType);
}

function normalizeTelemetrySample(
	sample: CursorTelemetryPoint,
	totalMs: number,
): CursorTelemetryPoint {
	return {
		timeMs: Math.max(0, Math.min(sample.timeMs, totalMs)),
		cx: Math.max(0, Math.min(sample.cx, 1)),
		cy: Math.max(0, Math.min(sample.cy, 1)),
		interactionType: sample.interactionType,
		cursorType: sample.cursorType,
	};
}

function applyCursorTypeInRange(
	samples: CursorTelemetryPoint[],
	startMs: number,
	endMs: number,
	cursorType: NonNullable<CursorTelemetryPoint["cursorType"]>,
) {
	for (const sample of samples) {
		if (sample.timeMs < startMs || sample.timeMs > endMs) continue;
		if (!sample.cursorType) {
			sample.cursorType = cursorType;
		}
	}
}

export function normalizeCursorTelemetry(
	telemetry: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	const normalized = [...telemetry]
		.filter(
			(sample) =>
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((sample) => normalizeTelemetrySample(sample, totalMs));

	const interactions = detectInteractionCandidates(normalized);
	for (const candidate of interactions) {
		if (candidate.kind === "text-selection") {
			applyCursorTypeInRange(
				normalized,
				candidate.centerTimeMs - 140,
				candidate.centerTimeMs + 1200,
				"text",
			);
			continue;
		}

		if (candidate.kind === "text-field-click" || candidate.kind === "text-focus-like") {
			applyCursorTypeInRange(
				normalized,
				candidate.centerTimeMs - 100,
				candidate.centerTimeMs + 900,
				"text",
			);
			continue;
		}
	}

	for (const sample of normalized) {
		if (sample.interactionType !== "click" && sample.interactionType !== "double-click") {
			continue;
		}

		const mouseUp = normalized.find(
			(candidate) =>
				candidate.timeMs > sample.timeMs && candidate.interactionType === "mouseup",
		);
		if (!mouseUp) {
			continue;
		}

		const dragDuration = mouseUp.timeMs - sample.timeMs;
		const dragDistance = Math.hypot(mouseUp.cx - sample.cx, mouseUp.cy - sample.cy);
		if (dragDuration >= 160 && dragDistance > 0.015) {
			const isTextDrag =
				Math.abs(mouseUp.cx - sample.cx) > Math.abs(mouseUp.cy - sample.cy) * 1.8;
			applyCursorTypeInRange(
				normalized,
				sample.timeMs,
				mouseUp.timeMs,
				isTextDrag ? "text" : "closed-hand",
			);
		}
	}

	return normalized;
}

export function detectZoomDwellCandidates(samples: CursorTelemetryPoint[]): ZoomDwellCandidate[] {
	if (samples.length < 2) {
		return [];
	}

	const dwellCandidates: ZoomDwellCandidate[] = [];
	let runStart = 0;

	const pushRunIfDwell = (startIndex: number, endIndexExclusive: number) => {
		if (endIndexExclusive - startIndex < 2) {
			return;
		}

		const start = samples[startIndex];
		const end = samples[endIndexExclusive - 1];
		const runDuration = end.timeMs - start.timeMs;
		if (runDuration < MIN_DWELL_DURATION_MS || runDuration > MAX_DWELL_DURATION_MS) {
			return;
		}

		const runSamples = samples.slice(startIndex, endIndexExclusive);
		const avgCx = runSamples.reduce((sum, sample) => sum + sample.cx, 0) / runSamples.length;
		const avgCy = runSamples.reduce((sum, sample) => sum + sample.cy, 0) / runSamples.length;

		dwellCandidates.push({
			centerTimeMs: Math.round((start.timeMs + end.timeMs) / 2),
			focus: { cx: avgCx, cy: avgCy },
			strength: runDuration,
		});
	};

	for (let index = 1; index < samples.length; index += 1) {
		const prev = samples[index - 1];
		const curr = samples[index];
		const distance = Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy);

		if (distance > DWELL_MOVE_THRESHOLD) {
			pushRunIfDwell(runStart, index);
			runStart = index;
		}
	}
	pushRunIfDwell(runStart, samples.length);

	return dwellCandidates;
}

export function detectInteractionCandidates(
	samples: CursorTelemetryPoint[],
): CursorInteractionCandidate[] {
	// --- Phase 1: Explicit interaction events (from uiohook telemetry) ---
	const clickEvents = samples.filter((sample) => isExplicitClickType(sample.interactionType));

	const explicitInteractionCandidates: CursorInteractionCandidate[] = [];

	for (const clickSample of clickEvents) {
		// Classify what happened AFTER this click by analyzing cursor trajectory
		const kind = classifyPostClickBehavior(samples, clickSample);

		const baseStrength =
			kind === "double-click-like"
				? 1500
				: kind === "dropdown-open"
					? 1200
					: kind === "text-selection"
						? 1300
						: kind === "text-field-click"
							? 1100
							: 900;

		explicitInteractionCandidates.push({
			centerTimeMs: Math.round(clickSample.timeMs),
			focus: { cx: clickSample.cx, cy: clickSample.cy },
			strength: baseStrength,
			kind,
			source: "explicit",
		});
	}

	// --- Phase 2: Dwell-based heuristic candidates ---
	const dwellCandidates = detectZoomDwellCandidates(samples).map<CursorInteractionCandidate>(
		(candidate) => {
			if (candidate.strength >= 1100) {
				return { ...candidate, kind: "text-focus-like", source: "heuristic" };
			}
			if (candidate.strength <= 800) {
				return { ...candidate, kind: "click-like", source: "heuristic" };
			}
			return { ...candidate, kind: "dwell", source: "heuristic" };
		},
	);

	// --- Phase 3: Synthetic double-click detection from dwell pairs ---
	const doubleClickCandidates: CursorInteractionCandidate[] = [];
	const sortedByTime = [...dwellCandidates].sort((a, b) => a.centerTimeMs - b.centerTimeMs);

	for (let index = 1; index < sortedByTime.length; index += 1) {
		const prev = sortedByTime[index - 1];
		const curr = sortedByTime[index];
		const timeGap = curr.centerTimeMs - prev.centerTimeMs;
		const spatialGap = Math.hypot(curr.focus.cx - prev.focus.cx, curr.focus.cy - prev.focus.cy);
		const bothShort = prev.strength <= 900 && curr.strength <= 900;

		if (bothShort && timeGap <= 450 && spatialGap <= 0.035) {
			doubleClickCandidates.push({
				centerTimeMs: Math.round((prev.centerTimeMs + curr.centerTimeMs) / 2),
				focus: {
					cx: (prev.focus.cx + curr.focus.cx) / 2,
					cy: (prev.focus.cy + curr.focus.cy) / 2,
				},
				strength: prev.strength + curr.strength + 500,
				kind: "double-click-like",
				source: "heuristic",
			});
		}
	}

	return [...explicitInteractionCandidates, ...dwellCandidates, ...doubleClickCandidates];
}

/**
 * Groups a sorted list of click timestamps into clusters where consecutive
 * clicks are no more than `mergeGapMs` apart. Returns an array of
 * `{ firstMs, lastMs, focus }` objects, one per cluster.  The focus is taken
 * from the click with the highest interaction strength, falling back to the
 * centroid of all clicks in the cluster.
 */
function buildClickClusters(
	clicks: CursorInteractionCandidate[],
	mergeGapMs: number,
): Array<{ firstMs: number; lastMs: number; focus: ZoomFocus }> {
	return clusterByTimeGap(clicks, (click) => click.centerTimeMs, mergeGapMs).map((cluster) => {
		// The focus is the strongest click's; on a tie the earliest wins, which
		// is what the original loop did by only replacing on a strictly greater
		// strength.
		let strongestClick = cluster[0];
		for (const click of cluster) {
			if (click.strength > strongestClick.strength) {
				strongestClick = click;
			}
		}

		return {
			firstMs: cluster[0].centerTimeMs,
			lastMs: cluster[cluster.length - 1].centerTimeMs,
			focus: strongestClick.focus,
		};
	});
}

/**
 * Applies ZD7: a typing burst extends the end of the cluster holding the
 * click it anchors to, and no further than the start of the next cluster's
 * region, so a later click always keeps the region it would have had.
 */
/**
 * A typing region shorter than this is not worth a zoom of its own: it would
 * flash past between the click region it sits beside and whatever follows.
 */
export const MIN_TYPING_REGION_MS = 400;

/**
 * Turns typing bursts into regions of their own, beside the click regions
 * rather than merged into them, which is what the author asked for on
 * 23 September 2026 after seeing merged regions on a real recording.
 *
 * A click region always keeps the span it would have had without any typing.
 * A typing region is the burst padded, then moved past anything it starts
 * inside and cut short at the first thing it runs into. It is never split
 * and never pushes anything else aside.
 */
function buildTypingRegions(params: {
	typingCandidates: TypingBurstCandidate[];
	occupiedSpans: Array<{ start: number; end: number }>;
	totalMs: number;
	padMs: number;
}): { regions: SuggestedZoomRegion[]; burstsLimitedByClick: number } {
	const { typingCandidates, occupiedSpans, totalMs, padMs } = params;
	const regions: SuggestedZoomRegion[] = [];
	let burstsLimitedByClick = 0;

	for (const candidate of typingCandidates) {
		if (candidate.focus === null) {
			continue;
		}

		// No pad ahead of the typing. A click zoom pads ahead because the camera
		// should be settled when the click lands, and a pointer travelling to a
		// target makes that early move read as intent. Typing has no approach:
		// nothing on screen moves before the first keystroke, so a camera that
		// has already zoomed reads as a fault rather than as anticipation. The
		// pad after stays, because snapping out on the last keystroke cuts away
		// the moment someone reads back what they have just typed.
		const requestedStart = Math.max(0, candidate.burst.firstKeystrokeMs);
		const requestedEnd = Math.min(totalMs, candidate.burst.lastKeystrokeMs + padMs);
		let start = requestedStart;
		let end = requestedEnd;

		// Move past anything the burst starts inside, then stop at the first
		// thing ahead of it. Both leave the other region untouched.
		for (const span of occupiedSpans) {
			if (start < span.end && end > span.start) {
				if (span.start <= start) {
					start = span.end;
				} else {
					end = Math.min(end, span.start);
				}
			}
		}

		// Losing padding is not a loss worth counting; failing to cover the
		// typing itself is, and so is being dropped entirely.
		const coversTheTyping =
			start <= candidate.burst.firstKeystrokeMs && end >= candidate.burst.lastKeystrokeMs;
		const hasRoom = end - start >= MIN_TYPING_REGION_MS;

		if (!coversTheTyping || !hasRoom) {
			burstsLimitedByClick += 1;
		}

		if (!hasRoom) {
			continue;
		}

		const region: SuggestedZoomRegion = {
			start,
			end,
			focus: candidate.focus,
			trigger: "typing",
		};
		regions.push(region);
		occupiedSpans.push({ start, end });
	}

	return { regions, burstsLimitedByClick };
}

export function buildInteractionZoomSuggestions(params: {
	cursorTelemetry: CursorTelemetryPoint[];
	/**
	 * Read from the recording's own typing sidecar. Absent or empty means the
	 * recording held no typing, and the result then carries no typing summary,
	 * exactly as it did before this feature existed.
	 */
	typingEvents?: TypingEvent[];
	totalMs: number;
	defaultDurationMs: number;
	reservedSpans?: Array<{ start: number; end: number }>;
	spacingMs?: number;
	mergeGapMs?: number;
	padMs?: number;
}): InteractionZoomSuggestionResult {
	const {
		cursorTelemetry,
		typingEvents = [],
		totalMs,
		reservedSpans = [],
		mergeGapMs = CLICK_CLUSTER_MERGE_GAP_MS,
		padMs = CLICK_CLUSTER_PAD_MS,
	} = params;

	if (totalMs <= 0) {
		return { status: "no-slots", suggestions: [] };
	}

	const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);
	if (normalizedSamples.length === 0) {
		return { status: "no-telemetry", suggestions: [] };
	}

	if (
		normalizedSamples.length === 1 &&
		!isExplicitClickType(normalizedSamples[0].interactionType)
	) {
		return { status: "no-telemetry", suggestions: [] };
	}

	// Only use explicit click events (uiohook telemetry) – ignore dwell heuristics
	const clickCandidates = detectInteractionCandidates(normalizedSamples).filter(
		(candidate) => candidate.source === "explicit",
	);

	// The typing summary exists only when keystrokes were present, so a
	// recording with no typing returns exactly the shape it always has.
	const hasKeystrokes = typingEvents.length > 0;
	const typingCandidates = hasKeystrokes
		? buildTypingBurstCandidates(typingEvents, normalizedSamples)
		: [];
	const typingSummary: TypingSuggestionSummary | undefined = hasKeystrokes
		? {
				burstsDetected: typingCandidates.length,
				burstsApplied: 0,
				burstsDeclinedForFocus: typingCandidates.filter(
					(candidate) => candidate.focusRule === "no-trustworthy-focus",
				).length,
				burstsLimitedByClick: 0,
			}
		: undefined;
	const withTyping = (
		result: InteractionZoomSuggestionResult,
	): InteractionZoomSuggestionResult =>
		typingSummary === undefined ? result : { ...result, typing: typingSummary };

	if (clickCandidates.length === 0) {
		return withTyping({ status: "no-interactions", suggestions: [] });
	}

	// Group nearby clicks into clusters, then derive zoom windows from those clusters
	const clusters = buildClickClusters(clickCandidates, mergeGapMs);

	const reserved = [...reservedSpans].sort((a, b) => a.start - b.start);
	const suggestions: SuggestedZoomRegion[] = [];

	for (const cluster of clusters) {
		const regionStart = Math.max(0, cluster.firstMs - padMs);
		const regionEnd = Math.min(totalMs, cluster.lastMs + padMs);

		if (regionEnd <= regionStart) {
			continue;
		}

		const hasOverlap = reserved.some(
			(span) => regionEnd > span.start && regionStart < span.end,
		);

		if (hasOverlap) {
			continue;
		}

		reserved.push({ start: regionStart, end: regionEnd });
		suggestions.push({
			start: regionStart,
			end: regionEnd,
			focus: cluster.focus,
		});
	}

	// Typing regions are placed after every click region, so the clicks keep
	// the spans they would have had and typing takes only what is left.
	if (typingSummary !== undefined) {
		const typingRegions = buildTypingRegions({
			typingCandidates,
			occupiedSpans: reserved,
			totalMs,
			padMs,
		});
		typingSummary.burstsApplied += typingRegions.regions.length;
		typingSummary.burstsLimitedByClick += typingRegions.burstsLimitedByClick;
		suggestions.push(...typingRegions.regions);
	}

	if (suggestions.length === 0) {
		return withTyping({ status: "no-slots", suggestions: [] });
	}

	// Sort chronologically
	suggestions.sort((a, b) => a.start - b.start);

	return withTyping({ status: "ok", suggestions });
}

/**
 * Analyzes cursor movement after a click to classify the interaction pattern.
 *
 * - **dropdown-open**: click followed by slow downward cursor movement (browsing items)
 * - **text-selection**: click followed by primarily horizontal drag movement
 * - **text-field-click**: click followed by cursor staying mostly still (dwell)
 * - **double-click-like**: explicit double-click interaction type
 * - **click-like**: generic click with no recognizable post-click pattern
 */
function classifyPostClickBehavior(
	samples: CursorTelemetryPoint[],
	clickSample: CursorTelemetryPoint,
): CursorInteractionCandidate["kind"] {
	// Explicit double-click from uiohook
	if (clickSample.interactionType === "double-click") {
		return "double-click-like";
	}

	const clickTime = clickSample.timeMs;

	// Check for mouseup shortly after (drag detection)
	const mouseUpAfter = samples.find(
		(s) =>
			s.interactionType === "mouseup" && s.timeMs > clickTime && s.timeMs - clickTime < 3000,
	);

	if (mouseUpAfter) {
		const dragDx = Math.abs(mouseUpAfter.cx - clickSample.cx);
		const dragDy = Math.abs(mouseUpAfter.cy - clickSample.cy);
		const dragDuration = mouseUpAfter.timeMs - clickTime;

		// Text selection: horizontal drag > 3% of screen, mostly horizontal, duration 200ms+
		if (dragDuration >= 200 && dragDx > 0.03 && dragDx > dragDy * 1.8) {
			return "text-selection";
		}
	}

	// Analyze trajectory in the 400ms-2000ms window after click
	const moveSamples = samples.filter(
		(s) =>
			s.timeMs > clickTime + 100 &&
			s.timeMs <= clickTime + 2000 &&
			(s.interactionType === "move" || !s.interactionType),
	);

	if (moveSamples.length < 3) {
		// Very few move samples after click = cursor stayed still = text field click
		return "text-field-click";
	}

	// Compute displacement from click position
	let maxDist = 0;
	let totalAbsDy = 0;
	let totalAbsDx = 0;
	for (const s of moveSamples) {
		const dist = Math.hypot(s.cx - clickSample.cx, s.cy - clickSample.cy);
		maxDist = Math.max(maxDist, dist);
		totalAbsDx += Math.abs(s.cx - clickSample.cx);
		totalAbsDy += Math.abs(s.cy - clickSample.cy);
	}

	// Cursor barely moved after click: text field click (dwell)
	if (maxDist < 0.02) {
		return "text-field-click";
	}

	// Primarily downward movement after click: dropdown open
	const lastMoveSample = moveSamples[moveSamples.length - 1];
	const netDy = lastMoveSample.cy - clickSample.cy;

	if (netDy > 0.03 && totalAbsDy > totalAbsDx * 1.5) {
		return "dropdown-open";
	}

	// Primarily horizontal movement: text selection (fallback if no mouseup)
	if (totalAbsDx > 0.03 && totalAbsDx > totalAbsDy * 1.8) {
		return "text-selection";
	}

	return "click-like";
}
