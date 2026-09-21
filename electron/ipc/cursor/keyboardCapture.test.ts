import { describe, expect, it } from "vitest";
import {
	buildCharacterProducingKeycodeSet,
	CHARACTER_PRODUCING_KEY_NAMES,
} from "./keyboardCapture";

/**
 * A stand in for the `UiohookKey` table `uiohook-napi` exports. The numbers
 * are deliberately not the real ones: the classifier must work by name and
 * take the numbers from whatever table it is given.
 */
const FAKE_UIOHOOK_KEY_TABLE: Record<string, unknown> = {
	A: 1001,
	Z: 1026,
	"0": 1100,
	"9": 1109,
	Space: 1200,
	Enter: 1201,
	Backspace: 1202,
	Delete: 1203,
	Comma: 1300,
	Quote: 1301,
	Numpad5: 1400,
	NumpadAdd: 1401,
	NumpadEnter: 1402,
	Tab: 2000,
	Escape: 2001,
	ArrowLeft: 2002,
	F5: 2003,
	Ctrl: 2004,
	Shift: 2005,
	Meta: 2006,
	CapsLock: 2007,
	PrintScreen: 2008,
	NotANumber: "x",
};

describe("character producing keycode classification", () => {
	it("names every key that changes the text in a field and no modifier, navigation or function key", () => {
		expect(CHARACTER_PRODUCING_KEY_NAMES).toContain("A");
		expect(CHARACTER_PRODUCING_KEY_NAMES).toContain("Space");
		expect(CHARACTER_PRODUCING_KEY_NAMES).toContain("Enter");
		expect(CHARACTER_PRODUCING_KEY_NAMES).toContain("Backspace");
		expect(CHARACTER_PRODUCING_KEY_NAMES).toContain("Delete");
		expect(CHARACTER_PRODUCING_KEY_NAMES).toContain("Quote");
		expect(CHARACTER_PRODUCING_KEY_NAMES).toContain("NumpadAdd");

		for (const excludedName of [
			"Tab",
			"Escape",
			"ArrowLeft",
			"F5",
			"Ctrl",
			"Shift",
			"Meta",
			"Alt",
			"CapsLock",
			"PrintScreen",
			"NumLock",
		]) {
			expect(CHARACTER_PRODUCING_KEY_NAMES).not.toContain(excludedName);
		}
	});

	it("builds the keycode set from the table it is given, by name", () => {
		const characterProducingKeycodes =
			buildCharacterProducingKeycodeSet(FAKE_UIOHOOK_KEY_TABLE);

		for (const characterKeycode of [
			1001, 1026, 1100, 1109, 1200, 1201, 1202, 1203, 1300, 1301, 1400, 1401, 1402,
		]) {
			expect(characterProducingKeycodes.has(characterKeycode)).toBe(true);
		}
		for (const nonCharacterKeycode of [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008]) {
			expect(characterProducingKeycodes.has(nonCharacterKeycode)).toBe(false);
		}
	});

	it("ignores names the table lacks and entries that are not numbers", () => {
		const characterProducingKeycodes = buildCharacterProducingKeycodeSet({
			A: 1,
			B: "two",
			Enter: Number.NaN,
		});

		expect([...characterProducingKeycodes]).toEqual([1]);
	});

	it("produces an empty set from an empty or non object table rather than throwing", () => {
		expect(buildCharacterProducingKeycodeSet({}).size).toBe(0);
		expect(buildCharacterProducingKeycodeSet(undefined).size).toBe(0);
		expect(buildCharacterProducingKeycodeSet(null).size).toBe(0);
	});
});
