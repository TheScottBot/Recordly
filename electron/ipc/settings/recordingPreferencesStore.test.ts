import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRecordingPreferencesStore,
	readKeyboardCaptureEnabled,
	readRecordingPreferences,
} from "./recordingPreferencesStore";

vi.mock("electron", () => ({
	app: {
		getPath: () => "",
	},
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, {
				recursive: true,
				force: true,
			}),
		),
	);
});

describe("recording preferences store", () => {
	it("preserves concurrent microphone and webcam preference updates", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));

		await Promise.all([
			store.update({ microphoneEnabled: true }),
			store.update({ microphoneDeviceId: "preferred-mic" }),
			store.update({ webcamEnabled: true }),
			store.update({ webcamDeviceId: "preferred-camera" }),
		]);

		await expect(store.read()).resolves.toEqual({
			microphoneEnabled: true,
			microphoneDeviceId: "preferred-mic",
			webcamEnabled: true,
			webcamDeviceId: "preferred-camera",
		});
	});
});

describe("keyboard capture preference", () => {
	it("is off unless the stored value is exactly true", () => {
		expect(readKeyboardCaptureEnabled({})).toBe(false);
		expect(readKeyboardCaptureEnabled({ keyboardCaptureEnabled: false })).toBe(false);
		expect(readKeyboardCaptureEnabled({ keyboardCaptureEnabled: "true" })).toBe(false);
		expect(readKeyboardCaptureEnabled({ keyboardCaptureEnabled: 1 })).toBe(false);
		expect(readKeyboardCaptureEnabled({ keyboardCaptureEnabled: true })).toBe(true);
	});

	it("round trips through the store beside the existing preferences", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));

		await store.update({ microphoneEnabled: true });
		await store.update({ keyboardCaptureEnabled: true });

		const stored = await store.read();
		expect(stored).toEqual({ microphoneEnabled: true, keyboardCaptureEnabled: true });
		expect(readKeyboardCaptureEnabled(stored)).toBe(true);

		await store.update({ keyboardCaptureEnabled: false });
		expect(readKeyboardCaptureEnabled(await store.read())).toBe(false);
	});
});

describe("readRecordingPreferences", () => {
	it("reads every preference the launch window shows", () => {
		expect(
			readRecordingPreferences({
				microphoneEnabled: true,
				microphoneDeviceId: "mic-2",
				systemAudioEnabled: true,
				webcamEnabled: true,
				webcamDeviceId: "cam-1",
				keyboardCaptureEnabled: true,
			}),
		).toEqual({
			microphoneEnabled: true,
			microphoneDeviceId: "mic-2",
			systemAudioEnabled: true,
			webcamEnabled: true,
			webcamDeviceId: "cam-1",
			keyboardCaptureEnabled: true,
		});
	});

	it("reports everything off for an empty file, which is what a new install has", () => {
		expect(readRecordingPreferences({})).toEqual({
			microphoneEnabled: false,
			microphoneDeviceId: undefined,
			systemAudioEnabled: false,
			webcamEnabled: false,
			webcamDeviceId: undefined,
			keyboardCaptureEnabled: false,
		});
	});

	/**
	 * The control must show off unless the stored value is exactly true, for
	 * the same reason the capture hook gates on exactly true: a file that has
	 * been hand edited or half written must never read as consent.
	 */
	it("shows keyboard capture off for anything that is not exactly true", () => {
		for (const stored of ["true", 1, "yes", {}, [], null, undefined, 0, false]) {
			expect(
				readRecordingPreferences({ keyboardCaptureEnabled: stored }).keyboardCaptureEnabled,
			).toBe(false);
		}
	});

	it("agrees with the gate the capture hook uses, so the control cannot lie", () => {
		for (const stored of [true, "true", 1, null, undefined, false]) {
			const preferences = { keyboardCaptureEnabled: stored };

			expect(readRecordingPreferences(preferences).keyboardCaptureEnabled).toBe(
				readKeyboardCaptureEnabled(preferences),
			);
		}
	});

	it("ignores a device identifier that is not a string", () => {
		expect(readRecordingPreferences({ microphoneDeviceId: 42 }).microphoneDeviceId).toBe(
			undefined,
		);
	});
});
