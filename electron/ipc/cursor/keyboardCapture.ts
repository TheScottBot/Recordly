/**
 * Classification of a key press as character producing or not, for the one
 * boolean the keyboard capture may derive from key identity (specification
 * 3.1 and decision ZD4).
 *
 * This module is pure: no Electron, no `uiohook-napi`. It works by key name
 * and takes the numeric keycodes from whatever key table it is handed, so the
 * numbers stay the property of the module that defines them and the names
 * stay readable here.
 */

/**
 * Keys that change the text in a field: letters, digits, space, punctuation,
 * the numeric keypad, Enter, Backspace and Delete. Deliberately excluded:
 * Tab (moves focus), Escape, arrows and paging (move the caret without
 * editing), function keys, modifiers and lock keys, since a burst of those is
 * navigation or a shortcut, not typing.
 *
 * Names are those `uiohook-napi` 1.5.4 exports on `UiohookKey`, read from
 * its `dist/index.d.ts` on 21 September 2026.
 */
export const CHARACTER_PRODUCING_KEY_NAMES: readonly string[] = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"A",
	"B",
	"C",
	"D",
	"E",
	"F",
	"G",
	"H",
	"I",
	"J",
	"K",
	"L",
	"M",
	"N",
	"O",
	"P",
	"Q",
	"R",
	"S",
	"T",
	"U",
	"V",
	"W",
	"X",
	"Y",
	"Z",
	"Space",
	"Enter",
	"Backspace",
	"Delete",
	"Semicolon",
	"Equal",
	"Comma",
	"Minus",
	"Period",
	"Slash",
	"Backquote",
	"BracketLeft",
	"Backslash",
	"BracketRight",
	"Quote",
	"Numpad0",
	"Numpad1",
	"Numpad2",
	"Numpad3",
	"Numpad4",
	"Numpad5",
	"Numpad6",
	"Numpad7",
	"Numpad8",
	"Numpad9",
	"NumpadMultiply",
	"NumpadAdd",
	"NumpadSubtract",
	"NumpadDecimal",
	"NumpadDivide",
	"NumpadEnter",
];

/**
 * Builds the set of keycodes that count as character producing from a key
 * table shaped like `UiohookKey`. Names the table lacks and values that are
 * not finite numbers are ignored rather than thrown on, because a missing
 * name only makes that key count as non character, which is the safe side.
 */
export function buildCharacterProducingKeycodeSet(keyTable: unknown): ReadonlySet<number> {
	const keycodes = new Set<number>();
	if (!keyTable || typeof keyTable !== "object") {
		return keycodes;
	}

	const table = keyTable as Record<string, unknown>;
	for (const keyName of CHARACTER_PRODUCING_KEY_NAMES) {
		const keycode = table[keyName];
		if (typeof keycode === "number" && Number.isFinite(keycode)) {
			keycodes.add(keycode);
		}
	}

	return keycodes;
}
