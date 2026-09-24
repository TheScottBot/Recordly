import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARET_SAMPLING_QUIET_MS, createCaretSamplingControl } from "./caretSamplingControl";

describe("createCaretSamplingControl", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("asks for sampling on the first keystroke", () => {
		const send = vi.fn();
		createCaretSamplingControl({ send }).noteTyping();

		expect(send).toHaveBeenCalledExactlyOnceWith("caret-on");
	});

	it("does not ask again while it is already sampling", () => {
		const send = vi.fn();
		const control = createCaretSamplingControl({ send });

		control.noteTyping();
		control.noteTyping();
		control.noteTyping();

		expect(send).toHaveBeenCalledExactlyOnceWith("caret-on");
	});

	/**
	 * Sampling outlives the last keystroke, because a page can still be
	 * settling or scrolling after someone stops typing, and a caret that
	 * moves then is exactly the movement worth following.
	 */
	it("keeps sampling through a pause shorter than the quiet period", () => {
		const send = vi.fn();
		const control = createCaretSamplingControl({ send });

		control.noteTyping();
		vi.advanceTimersByTime(CARET_SAMPLING_QUIET_MS - 1);
		control.noteTyping();
		vi.advanceTimersByTime(CARET_SAMPLING_QUIET_MS - 1);

		expect(send).toHaveBeenCalledExactlyOnceWith("caret-on");
	});

	it("stops sampling once the typing has been quiet", () => {
		const send = vi.fn();
		const control = createCaretSamplingControl({ send });

		control.noteTyping();
		vi.advanceTimersByTime(CARET_SAMPLING_QUIET_MS);

		expect(send).toHaveBeenNthCalledWith(2, "caret-off");
	});

	it("asks again when typing resumes after the quiet period", () => {
		const send = vi.fn();
		const control = createCaretSamplingControl({ send });

		control.noteTyping();
		vi.advanceTimersByTime(CARET_SAMPLING_QUIET_MS);
		control.noteTyping();

		expect(send.mock.calls.map(([command]) => command)).toEqual([
			"caret-on",
			"caret-off",
			"caret-on",
		]);
	});

	/**
	 * Stopping must leave nothing behind: a timer that fired after the helper
	 * had gone would write to a closed pipe.
	 */
	it("stops sampling and cancels the pending timer when the recording ends", () => {
		const send = vi.fn();
		const control = createCaretSamplingControl({ send });

		control.noteTyping();
		control.stop();
		vi.advanceTimersByTime(CARET_SAMPLING_QUIET_MS * 4);

		expect(send.mock.calls.map(([command]) => command)).toEqual(["caret-on", "caret-off"]);
	});

	it("says nothing when stopped without any typing having happened", () => {
		const send = vi.fn();
		createCaretSamplingControl({ send }).stop();

		expect(send).not.toHaveBeenCalled();
	});
});
