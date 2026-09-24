/**
 * Writing a command to a helper process, without taking the application down
 * when the helper has gone.
 *
 * A write to a pipe whose reader has exited fails asynchronously. It does not
 * throw, so wrapping the call in a try/catch catches nothing, and the stream
 * emits an error that becomes an uncaught exception and kills the main
 * process. The author saw exactly that on 24 September 2026, as an EPIPE
 * dialog, after stopping a recording: teardown asked the caret sampler to
 * stop and the helper was killed before the write completed.
 *
 * Two defences, because neither alone is enough. The state check skips a
 * stream already known to be gone, and the callback absorbs the failure of a
 * stream that dies between the check and the write completing. A listener on
 * the stream's own error event is still required at the call site; see
 * `startNativeCursorMonitor`.
 */

export interface HelperStdinStream {
	writable?: boolean;
	destroyed?: boolean;
	write: (chunk: string, callback: (error?: Error | null) => void) => unknown;
}

/** Returns whether a write was attempted, which is useful only to tests. */
export function writeHelperCommand(
	stdin: HelperStdinStream | null | undefined,
	command: string,
): boolean {
	if (!stdin || stdin.destroyed === true || stdin.writable === false) {
		return false;
	}

	stdin.write(`${command}\n`, () => {
		// A helper that has gone needs no telling what to do. There is nothing
		// to retry and nothing worth logging every time a recording ends.
	});

	return true;
}
