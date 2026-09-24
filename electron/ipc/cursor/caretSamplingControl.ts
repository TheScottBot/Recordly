/**
 * When the helper should be sampling the caret.
 *
 * The helper has no idea anyone is typing: keystrokes arrive in the main
 * process through the input hook. Sampling costs about six milliseconds a
 * call against an application with no text pattern, so it is switched on at
 * the first keystroke and off again once the typing has been quiet, rather
 * than run for the length of the recording.
 *
 * Pure apart from the timer, so the rule can be tested without a helper
 * process, a recording or a keyboard.
 */

/**
 * How long after the last keystroke sampling continues. Matched to the gap
 * that separates one typing burst from the next, so sampling covers a burst
 * and stops with it. It deliberately outlives the last keystroke: a page can
 * still be settling or scrolling afterwards, and a caret that moves then is
 * exactly the movement worth following.
 */
export const CARET_SAMPLING_QUIET_MS = 2_500;

export type CaretSamplingCommand = "caret-on" | "caret-off";

export function createCaretSamplingControl({
	send,
	quietMs = CARET_SAMPLING_QUIET_MS,
}: {
	send: (command: CaretSamplingCommand) => void;
	quietMs?: number;
}) {
	let isSampling = false;
	let quietTimer: ReturnType<typeof setTimeout> | null = null;

	function clearQuietTimer() {
		if (quietTimer !== null) {
			clearTimeout(quietTimer);
			quietTimer = null;
		}
	}

	function stopSampling() {
		clearQuietTimer();
		if (isSampling) {
			isSampling = false;
			send("caret-off");
		}
	}

	return {
		/** Called for every keystroke the hook reports. */
		noteTyping() {
			if (!isSampling) {
				isSampling = true;
				send("caret-on");
			}

			clearQuietTimer();
			quietTimer = setTimeout(stopSampling, quietMs);
		},

		/**
		 * Called when the recording ends. Leaves no timer behind: one that
		 * fired after the helper had gone would write to a closed pipe.
		 */
		stop() {
			stopSampling();
		},
	};
}

export type CaretSamplingControl = ReturnType<typeof createCaretSamplingControl>;

/**
 * The control belonging to the running helper, held here rather than in the
 * monitor so that the keystroke path can reach it without importing the
 * monitor, which imports the keystroke path.
 */
let activeCaretSamplingControl: CaretSamplingControl | null = null;

export function setActiveCaretSamplingControl(control: CaretSamplingControl | null) {
	activeCaretSamplingControl = control;
}

/** Called for every keystroke the input hook reports. */
export function noteTypingForCaretSampling() {
	activeCaretSamplingControl?.noteTyping();
}

export function stopActiveCaretSamplingControl() {
	activeCaretSamplingControl?.stop();
	activeCaretSamplingControl = null;
}
