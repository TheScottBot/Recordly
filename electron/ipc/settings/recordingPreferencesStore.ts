import fs from "node:fs/promises";
import { parseJsonWithByteOrderMark } from "../utils";

export interface RecordingPreferencesPatch {
	microphoneEnabled?: boolean;
	microphoneDeviceId?: string;
	systemAudioEnabled?: boolean;
	webcamEnabled?: boolean;
	webcamDeviceId?: string;
	/** Off unless exactly true: the application captured no keyboard data before this preference existed. */
	keyboardCaptureEnabled?: boolean;
}

/**
 * Reads the keyboard capture preference the way the interaction hook gates on
 * it. Anything but the boolean true is off, so a malformed or absent value
 * never registers a keyboard listener.
 */
export function readKeyboardCaptureEnabled(preferences: Record<string, unknown>): boolean {
	return preferences.keyboardCaptureEnabled === true;
}

export function createRecordingPreferencesStore(filePath: string) {
	let operationQueue: Promise<void> = Promise.resolve();

	const readFile = async (): Promise<Record<string, unknown>> => {
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	};

	return {
		async read(): Promise<Record<string, unknown>> {
			await operationQueue;
			return readFile();
		},
		async update(patch: RecordingPreferencesPatch): Promise<void> {
			const operation = operationQueue.then(async () => {
				const existing = await readFile();
				await fs.writeFile(
					filePath,
					JSON.stringify({ ...existing, ...patch }, null, 2),
					"utf-8",
				);
			});
			operationQueue = operation.catch(() => undefined);
			await operation;
		},
	};
}
