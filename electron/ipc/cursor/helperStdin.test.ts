import { describe, expect, it, vi } from "vitest";
import { writeHelperCommand } from "./helperStdin";

function fakeStdin(overrides: Record<string, unknown> = {}) {
	return {
		writable: true,
		destroyed: false,
		write: vi.fn(),
		...overrides,
	};
}

describe("writeHelperCommand", () => {
	it("writes the command with a newline, which is how the helper reads it", () => {
		const stdin = fakeStdin();

		expect(writeHelperCommand(stdin, "caret-on")).toBe(true);
		expect(stdin.write).toHaveBeenCalledWith("caret-on\n", expect.any(Function));
	});

	/**
	 * The reason this exists. A write to a pipe whose reader has gone fails
	 * asynchronously: it does not throw, so a try/catch around the call never
	 * sees it, and the stream emits an error that takes the whole main process
	 * down if nothing is listening. The author hit exactly that on 24
	 * September 2026, as an uncaught EPIPE dialog.
	 */
	it("swallows the failure the write reports late, rather than letting it escape", () => {
		const stdin = fakeStdin({
			write: vi.fn((_chunk: string, callback: (error?: Error | null) => void) => {
				callback(new Error("write EPIPE"));
			}),
		});

		expect(() => writeHelperCommand(stdin, "caret-off")).not.toThrow();
	});

	it("says nothing to a stream that has already gone", () => {
		for (const gone of [
			null,
			undefined,
			fakeStdin({ destroyed: true }),
			fakeStdin({ writable: false }),
		]) {
			expect(writeHelperCommand(gone, "caret-on")).toBe(false);
		}
	});

	it("does not attempt a write on a stream that has gone", () => {
		const stdin = fakeStdin({ destroyed: true });

		writeHelperCommand(stdin, "caret-on");

		expect(stdin.write).not.toHaveBeenCalled();
	});
});
