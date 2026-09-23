import { describe, expect, it } from "vitest";
import {
	makeClick,
	makeKeystroke,
	makeMove,
	makeTypingRun,
	withMoves,
} from "./telemetryTestFixtures";
import {
	buildTypingBurstCandidates,
	detectTypingBursts,
	deriveTypingBurstFocus,
	TYPING_ANCHOR_WINDOW_MS,
	TYPING_BURST_MERGE_GAP_MS,
	TYPING_BURST_MIN_KEYSTROKES,
	TYPING_CANDIDATE_STRENGTH,
	TYPING_SESSION_CARRY_MS,
} from "./typingBurstUtils";

const TOTAL_MS = 60_000;

describe("typing burst thresholds", () => {
	it("uses the values decided in ZD8 and ZD9", () => {
		expect(TYPING_BURST_MIN_KEYSTROKES).toBe(3);
		expect(TYPING_BURST_MERGE_GAP_MS).toBe(2_500);
		expect(TYPING_ANCHOR_WINDOW_MS).toBe(2_500);
		expect(TYPING_CANDIDATE_STRENGTH).toBe(700);
	});
});

describe("detectTypingBursts", () => {
	it("produces no burst from a recording with no typing", () => {
		expect(detectTypingBursts([])).toEqual([]);
	});

	it("does not make a burst from a single keystroke, or from fewer than the minimum", () => {
		expect(detectTypingBursts(makeTypingRun(5_000, 1))).toEqual([]);
		expect(detectTypingBursts(makeTypingRun(5_000, TYPING_BURST_MIN_KEYSTROKES - 1))).toEqual(
			[],
		);
	});

	it("makes exactly one burst from a sustained run, not one per key", () => {
		const bursts = detectTypingBursts(makeTypingRun(5_000, 40, 150));

		expect(bursts).toEqual([
			{
				firstKeystrokeMs: 5_000,
				lastKeystrokeMs: 5_000 + 39 * 150,
				keystrokeCount: 40,
			},
		]);
	});

	it("splits a run at a pause longer than the merge gap, and keeps one exactly at the gap", () => {
		const runOne = makeTypingRun(5_000, 5, 100);
		const lastOfRunOne = 5_000 + 4 * 100;
		const runAtGap = makeTypingRun(lastOfRunOne + TYPING_BURST_MERGE_GAP_MS, 5, 100);
		const lastOfRunAtGap = lastOfRunOne + TYPING_BURST_MERGE_GAP_MS + 4 * 100;
		const runPastGap = makeTypingRun(lastOfRunAtGap + TYPING_BURST_MERGE_GAP_MS + 1, 5, 100);

		const bursts = detectTypingBursts([...runOne, ...runAtGap, ...runPastGap]);

		expect(bursts.map((burst) => burst.keystrokeCount)).toEqual([10, 5]);
		expect(bursts[0]).toMatchObject({
			firstKeystrokeMs: 5_000,
			lastKeystrokeMs: lastOfRunAtGap,
		});
		expect(bursts[1]).toMatchObject({
			firstKeystrokeMs: lastOfRunAtGap + TYPING_BURST_MERGE_GAP_MS + 1,
		});
	});

	it("counts only character producing keystrokes, so shortcuts and modifiers are not typing", () => {
		const modifiersOnly = [
			makeKeystroke(5_000, { keyProducesCharacter: false }),
			makeKeystroke(5_100, { keyProducesCharacter: false }),
			makeKeystroke(5_200, { keyProducesCharacter: false }),
			makeKeystroke(5_300, { keyProducesCharacter: false }),
		];
		expect(detectTypingBursts(modifiersOnly)).toEqual([]);

		const mixed = [
			makeKeystroke(5_000, { keyProducesCharacter: false }),
			...makeTypingRun(5_100, 3, 100),
			makeKeystroke(5_400, { keyProducesCharacter: false }),
		];
		expect(detectTypingBursts(mixed)).toEqual([
			{ firstKeystrokeMs: 5_100, lastKeystrokeMs: 5_300, keystrokeCount: 3 },
		]);
	});

	it("counts a keystroke whose character flag is absent, since absence is not a modifier", () => {
		const unclassified = [makeKeystroke(5_000), makeKeystroke(5_100), makeKeystroke(5_200)];

		expect(detectTypingBursts(unclassified)).toEqual([
			{ firstKeystrokeMs: 5_000, lastKeystrokeMs: 5_200, keystrokeCount: 3 },
		]);
	});

	it("tolerates unsorted input by ordering keystrokes in time", () => {
		const run = makeTypingRun(5_000, 4, 100);
		const shuffled = [run[2], run[0], run[3], run[1]];

		expect(detectTypingBursts(shuffled)).toEqual([
			{ firstKeystrokeMs: 5_000, lastKeystrokeMs: 5_300, keystrokeCount: 4 },
		]);
	});
});

describe("deriveTypingBurstFocus", () => {
	const burst = { firstKeystrokeMs: 10_000, lastKeystrokeMs: 12_000, keystrokeCount: 12 };

	it("anchors to the most recent left click before the burst, using the click's position", () => {
		const samples = withMoves(
			[makeClick(6_000, 0.1, 0.1), makeClick(9_000, 0.3, 0.7)],
			TOTAL_MS,
		);

		expect(deriveTypingBurstFocus(burst, samples)).toEqual({
			focus: { cx: 0.3, cy: 0.7 },
			rule: "anchored-to-preceding-click",
			anchorClickTimeMs: 9_000,
		});
	});

	it("accepts a double click as an anchor", () => {
		const samples = [makeClick(9_500, 0.4, 0.4, "double-click")];

		expect(deriveTypingBurstFocus(burst, samples)).toMatchObject({
			focus: { cx: 0.4, cy: 0.4 },
			rule: "anchored-to-preceding-click",
		});
	});

	it("declines when the only preceding click is a right or middle click", () => {
		for (const interactionType of ["right-click", "middle-click"] as const) {
			const samples = [makeClick(9_500, 0.4, 0.4, interactionType)];

			expect(deriveTypingBurstFocus(burst, samples)).toEqual({
				focus: null,
				rule: "no-trustworthy-focus",
				anchorClickTimeMs: null,
			});
		}
	});

	it("accepts a click exactly at the anchor window and declines one just outside it", () => {
		const atWindow = [makeClick(10_000 - TYPING_ANCHOR_WINDOW_MS, 0.2, 0.2)];
		expect(deriveTypingBurstFocus(burst, atWindow)).toMatchObject({
			rule: "anchored-to-preceding-click",
			anchorClickTimeMs: 10_000 - TYPING_ANCHOR_WINDOW_MS,
		});

		const outsideWindow = [makeClick(10_000 - TYPING_ANCHOR_WINDOW_MS - 1, 0.2, 0.2)];
		expect(deriveTypingBurstFocus(burst, outsideWindow)).toMatchObject({
			rule: "no-trustworthy-focus",
			focus: null,
		});
	});

	it("does not anchor to a click after the first keystroke, even inside the burst", () => {
		const samples = [makeClick(11_000, 0.2, 0.2)];

		expect(deriveTypingBurstFocus(burst, samples)).toMatchObject({
			rule: "no-trustworthy-focus",
		});
	});

	it("never uses the pointer position during the typing as the focus", () => {
		// The pointer moves throughout the burst and there is no click anywhere.
		const samples = withMoves(
			[makeMove(10_500, 0.5, 0.5), makeMove(11_500, 0.6, 0.6)],
			TOTAL_MS,
		);

		const derived = deriveTypingBurstFocus(burst, samples);

		expect(derived.focus).toBeNull();
		expect(derived.rule).toBe("no-trustworthy-focus");
	});
});

describe("buildTypingBurstCandidates", () => {
	it("returns one candidate per burst, carrying the focus rule and the decided strength", () => {
		const candidates = buildTypingBurstCandidates(
			[...makeTypingRun(5_000, 10, 100), ...makeTypingRun(20_000, 10, 100)],
			withMoves([makeClick(4_000, 0.3, 0.6)], TOTAL_MS),
		);

		expect(candidates).toEqual([
			{
				burst: { firstKeystrokeMs: 5_000, lastKeystrokeMs: 5_900, keystrokeCount: 10 },
				focus: { cx: 0.3, cy: 0.6 },
				focusRule: "anchored-to-preceding-click",
				anchorClickTimeMs: 4_000,
				strength: TYPING_CANDIDATE_STRENGTH,
			},
			{
				burst: { firstKeystrokeMs: 20_000, lastKeystrokeMs: 20_900, keystrokeCount: 10 },
				focus: null,
				focusRule: "no-trustworthy-focus",
				anchorClickTimeMs: null,
				strength: TYPING_CANDIDATE_STRENGTH,
			},
		]);
	});

	it("produces nothing for a recording with clicks and no typing", () => {
		expect(
			buildTypingBurstCandidates(
				[],
				withMoves([makeClick(1_000), makeMove(1_500)], TOTAL_MS),
			),
		).toEqual([]);
	});
});

describe("a typing session that pauses keeps the field it was typing into", () => {
	it("gives a later burst the anchor of the one before it when no click intervened", () => {
		const candidates = buildTypingBurstCandidates(
			// A 6.1 second think between the two runs, which is the shape the
			// author's real recording of 23 September 2026 had.
			[...makeTypingRun(5_000, 5, 100), ...makeTypingRun(11_500, 5, 100)],
			withMoves([makeClick(4_000, 0.3, 0.6)], TOTAL_MS),
		);

		expect(candidates).toHaveLength(2);
		expect(candidates[0]).toMatchObject({
			focus: { cx: 0.3, cy: 0.6 },
			focusRule: "anchored-to-preceding-click",
			anchorClickTimeMs: 4_000,
		});
		expect(candidates[1]).toMatchObject({
			focus: { cx: 0.3, cy: 0.6 },
			focusRule: "inherited-from-typing-session",
			anchorClickTimeMs: 4_000,
		});
	});

	it("does not inherit once the pause exceeds the session window", () => {
		const clicks = withMoves([makeClick(4_000, 0.3, 0.6)], TOTAL_MS);

		const justInside = buildTypingBurstCandidates(
			[
				...makeTypingRun(5_000, 5, 100),
				...makeTypingRun(5_400 + TYPING_SESSION_CARRY_MS, 5, 100),
			],
			clicks,
		);
		expect(justInside[1]).toMatchObject({ focusRule: "inherited-from-typing-session" });

		const justOutside = buildTypingBurstCandidates(
			[
				...makeTypingRun(5_000, 5, 100),
				...makeTypingRun(5_401 + TYPING_SESSION_CARRY_MS, 5, 100),
			],
			clicks,
		);
		expect(justOutside[1]).toMatchObject({
			focus: null,
			focusRule: "no-trustworthy-focus",
			anchorClickTimeMs: null,
		});
	});

	it("does not inherit across a click, because that click is the better anchor", () => {
		const candidates = buildTypingBurstCandidates(
			[...makeTypingRun(5_000, 5, 100), ...makeTypingRun(9_000, 5, 100)],
			withMoves([makeClick(4_000, 0.3, 0.6), makeClick(8_000, 0.8, 0.2)], TOTAL_MS),
		);

		expect(candidates[1]).toMatchObject({
			focus: { cx: 0.8, cy: 0.2 },
			focusRule: "anchored-to-preceding-click",
			anchorClickTimeMs: 8_000,
		});
	});

	it("does not inherit a focus the previous burst never had", () => {
		const candidates = buildTypingBurstCandidates(
			[...makeTypingRun(5_000, 5, 100), ...makeTypingRun(9_000, 5, 100)],
			withMoves([], TOTAL_MS),
		);

		expect(candidates.map((candidate) => candidate.focusRule)).toEqual([
			"no-trustworthy-focus",
			"no-trustworthy-focus",
		]);
	});
});
