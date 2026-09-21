import { RECORDINGS_SETTINGS_FILE } from "../constants";
import { createRecordingPreferencesStore } from "./recordingPreferencesStore";

/**
 * The one recording preferences store the main process reads and writes.
 * Both the settings handlers (which the launch window drives) and the
 * recording handlers (which gate keyboard capture on it) go through this
 * instance, so its write queue serialises every update.
 */
export const sharedRecordingPreferencesStore =
	createRecordingPreferencesStore(RECORDINGS_SETTINGS_FILE);
