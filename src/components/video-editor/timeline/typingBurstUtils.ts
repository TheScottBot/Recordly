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

import type { CaretSample, TypingEvent } from "@/lib/typingTelemetryContract";
import type { CursorTelemetryPoint, ZoomFocus } from "../types";
import { clusterByTimeGap } from "./timeGapClustering";
import { CLICK_CLUSTER_MERGE_GAP_MS, CLICK_CLUSTER_PAD_MS } from "./zoomSuggestionConstants";

/** Fewer presses than this is a shortcut or a stray key, not typing. */
export const TYPING_BURST_MIN_KEYSTROKES = 3;
/** The same gap and padding as click clusters, so the product has one set of timings. */
export const TYPING_BURST_MERGE_GAP_MS = CLICK_CLUSTER_MERGE_GAP_MS;
export const TYPING_BURST_PAD_MS = CLICK_CLUSTER_PAD_MS;
/** How long before the first keystroke a click may be and still count as the field the person typed into. */
export const TYPING_ANCHOR_WINDOW_MS = 2_500;
/**
 * How long a person may pause and still be typing into the same field. A
 * burst that begins within this of the previous burst's last keystroke, with
 * no click in between, keeps that burst's focus rather than being declined.
 * Ten seconds covers the think pause in the author's recording of 23
 * September 2026, where a 4.7 second pause split one session in two; it is a
 * starting point to be adjusted against further recordings.
 */
export const TYPING_SESSION_CARRY_MS = 10_000;
/** Below a plain click's 900, so a click always supplies the focus when the two compete. */
export const TYPING_CANDIDATE_STRENGTH = 700;

export interface TypingBurst {
	firstKeystrokeMs: number;
	lastKeystrokeMs: number;
	keystrokeCount: number;
}

export type TypingFocusRule =
	| "taken-from-the-caret"
	| "anchored-to-preceding-click"
	| "inherited-from-typing-session"
	| "no-trustworthy-focus";

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

function isTypingKeystroke(event: TypingEvent): boolean {
	// A false flag is a modifier, arrow or function key and is not typing. An
	// absent flag is a capture path that could not classify, which is not a
	// reason to ignore a key press it did record.
	return event.keyProducesCharacter !== false;
}

function isAnchorClick(sample: CursorTelemetryPoint): boolean {
	// Right and middle clicks do not put a caret in a field.
	return sample.interactionType === "click" || sample.interactionType === "double-click";
}

export function detectTypingBursts(typingEvents: readonly TypingEvent[]): TypingBurst[] {
	const keystrokes = typingEvents.filter(isTypingKeystroke);

	return clusterByTimeGap(keystrokes, (event) => event.timeMs, TYPING_BURST_MERGE_GAP_MS)
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
/**
 * The caret the burst began at, if the recording carries a track that covers
 * it. Better evidence than anything else available: a click is a guess that
 * the person clicked into the field they then typed in, whereas the caret is
 * where the typing actually was.
 */
function findCaretForBurst(
	burst: TypingBurst,
	caretTrack: readonly CaretSample[],
): CaretSample | null {
	for (const sample of caretTrack) {
		if (sample.timeMs >= burst.firstKeystrokeMs && sample.timeMs <= burst.lastKeystrokeMs) {
			return sample;
		}
	}

	return null;
}

export function buildTypingBurstCandidates(
	typingEvents: readonly TypingEvent[],
	samples: readonly CursorTelemetryPoint[],
	/**
	 * Absent for every recording made before caret sampling existed, and on
	 * every platform that does not sample one, in which case the click rules
	 * below decide on their own exactly as they did.
	 */
	caretTrack: readonly CaretSample[] = [],
): TypingBurstCandidate[] {
	const candidates: TypingBurstCandidate[] = [];
	let previousBurst: TypingBurst | null = null;
	let previousFocus: TypingBurstFocus | null = null;

	for (const burst of detectTypingBursts(typingEvents)) {
		const caret = findCaretForBurst(burst, caretTrack);
		// The caret wins outright where there is one. The rule that a burst
		// without a preceding click has no trustworthy focus was written when a
		// click was the only evidence there was; a burst with a caret needs no
		// click, and the author lost a zoom to that on 24 September 2026 after
		// selecting a page of text and typing over it.
		let derivedFocus: TypingBurstFocus = caret
			? {
					focus: { cx: caret.cx, cy: caret.cy },
					rule: "taken-from-the-caret",
					anchorClickTimeMs: null,
				}
			: deriveTypingBurstFocus(burst, samples);

		const burstBefore = previousBurst;
		if (derivedFocus.focus === null && burstBefore !== null && previousFocus?.focus) {
			const pauseMs = burst.firstKeystrokeMs - burstBefore.lastKeystrokeMs;
			// A click between the two bursts would have been found by
			// deriveTypingBurstFocus and is always the better anchor, so reaching
			// here means there was none inside the anchor window.
			const clickIntervened = samples.some(
				(sample) =>
					isAnchorClick(sample) &&
					sample.timeMs > burstBefore.lastKeystrokeMs &&
					sample.timeMs <= burst.firstKeystrokeMs,
			);

			if (pauseMs <= TYPING_SESSION_CARRY_MS && !clickIntervened) {
				derivedFocus = {
					focus: previousFocus.focus,
					rule: "inherited-from-typing-session",
					anchorClickTimeMs: previousFocus.anchorClickTimeMs,
				};
			}
		}

		candidates.push({
			burst,
			focus: derivedFocus.focus,
			focusRule: derivedFocus.rule,
			anchorClickTimeMs: derivedFocus.anchorClickTimeMs,
			strength: TYPING_CANDIDATE_STRENGTH,
		});
		previousBurst = burst;
		previousFocus = derivedFocus;
	}

	return candidates;
}
