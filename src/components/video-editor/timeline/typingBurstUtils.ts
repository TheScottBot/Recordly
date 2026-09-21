/**
 * Typing bursts and the focus a burst may borrow.
 *
 * Pure: no Electron, no React, no platform. A keystroke sample says only that
 * a key was pressed and when; it has no position of its own, so a burst is
 * never zoomed to where the pointer happened to be. The only focus this
 * module trusts is a left or double click shortly before the burst began,
 * on the reasoning that a person clicks into a field before typing into it.
 * A burst with no such click produces no focus, and the caller suggests
 * nothing for it: a missing zoom is neutral, a wrong one is a defect.
 */

import type { CursorTelemetryPoint, ZoomFocus } from "../types";
import { clusterByTimeGap } from "./timeGapClustering";
import { CLICK_CLUSTER_MERGE_GAP_MS, CLICK_CLUSTER_PAD_MS } from "./zoomSuggestionUtils";

/** Fewer presses than this is a shortcut or a stray key, not typing. */
export const TYPING_BURST_MIN_KEYSTROKES = 3;
/** The same gap and padding as click clusters, so the product has one set of timings. */
export const TYPING_BURST_MERGE_GAP_MS = CLICK_CLUSTER_MERGE_GAP_MS;
export const TYPING_BURST_PAD_MS = CLICK_CLUSTER_PAD_MS;
/** How long before the first keystroke a click may be and still count as the field the person typed into. */
export const TYPING_ANCHOR_WINDOW_MS = 2_500;
/** Below a plain click's 900, so a click always supplies the focus when the two compete. */
export const TYPING_CANDIDATE_STRENGTH = 700;

export interface TypingBurst {
	firstKeystrokeMs: number;
	lastKeystrokeMs: number;
	keystrokeCount: number;
}

export type TypingFocusRule = "anchored-to-preceding-click" | "no-trustworthy-focus";

export interface TypingBurstFocus {
	focus: ZoomFocus | null;
	rule: TypingFocusRule;
	anchorClickTimeMs: number | null;
}

export interface TypingBurstCandidate {
	burst: TypingBurst;
	focus: ZoomFocus | null;
	focusRule: TypingFocusRule;
	anchorClickTimeMs: number | null;
	strength: number;
}

function isTypingKeystroke(sample: CursorTelemetryPoint): boolean {
	// A false flag is a modifier, arrow or function key and is not typing. An
	// absent flag is a capture path that could not classify, which is not a
	// reason to ignore a keystroke it did record.
	return sample.interactionType === "keystroke" && sample.keyProducesCharacter !== false;
}

function isAnchorClick(sample: CursorTelemetryPoint): boolean {
	// Right and middle clicks do not put a caret in a field.
	return sample.interactionType === "click" || sample.interactionType === "double-click";
}

export function detectTypingBursts(samples: readonly CursorTelemetryPoint[]): TypingBurst[] {
	const keystrokes = samples.filter(isTypingKeystroke);

	return clusterByTimeGap(keystrokes, (sample) => sample.timeMs, TYPING_BURST_MERGE_GAP_MS)
		.filter((cluster) => cluster.length >= TYPING_BURST_MIN_KEYSTROKES)
		.map((cluster) => ({
			firstKeystrokeMs: cluster[0].timeMs,
			lastKeystrokeMs: cluster[cluster.length - 1].timeMs,
			keystrokeCount: cluster.length,
		}));
}

export function deriveTypingBurstFocus(
	burst: TypingBurst,
	samples: readonly CursorTelemetryPoint[],
): TypingBurstFocus {
	const earliestAcceptableClickMs = burst.firstKeystrokeMs - TYPING_ANCHOR_WINDOW_MS;
	let anchorClick: CursorTelemetryPoint | null = null;

	for (const sample of samples) {
		if (!isAnchorClick(sample)) {
			continue;
		}
		if (sample.timeMs > burst.firstKeystrokeMs || sample.timeMs < earliestAcceptableClickMs) {
			continue;
		}
		if (anchorClick === null || sample.timeMs > anchorClick.timeMs) {
			anchorClick = sample;
		}
	}

	if (anchorClick === null) {
		return { focus: null, rule: "no-trustworthy-focus", anchorClickTimeMs: null };
	}

	return {
		focus: { cx: anchorClick.cx, cy: anchorClick.cy },
		rule: "anchored-to-preceding-click",
		anchorClickTimeMs: anchorClick.timeMs,
	};
}

/**
 * Every burst becomes a candidate, including those that declined a focus, so
 * the caller can count declines as well as suggestions rather than losing
 * them silently.
 */
export function buildTypingBurstCandidates(
	samples: readonly CursorTelemetryPoint[],
): TypingBurstCandidate[] {
	return detectTypingBursts(samples).map((burst) => {
		const derivedFocus = deriveTypingBurstFocus(burst, samples);
		return {
			burst,
			focus: derivedFocus.focus,
			focusRule: derivedFocus.rule,
			anchorClickTimeMs: derivedFocus.anchorClickTimeMs,
			strength: TYPING_CANDIDATE_STRENGTH,
		};
	});
}
