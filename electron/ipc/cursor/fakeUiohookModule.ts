/**
 * Test double for the `uiohook-napi` module namespace as `interaction.ts`
 * loads it: a `uIOhook` emitter with `on`, `off`, `start` and `stop`, and a
 * `UiohookKey` table. It stands in for the real native hook, which cannot be
 * loaded under Vitest, and it records every registration so a test can
 * assert which listeners exist and drive events through them.
 */

import type { HookEventListener, HookEventName, UiohookModuleNamespace } from "../types";

export interface FakeUiohookModule {
	namespace: UiohookModuleNamespace;
	/** Event names with at least one listener registered right now. */
	registeredEventNames(): HookEventName[];
	/** Deliver an event to every listener of that name, as the hook would. */
	emit(eventName: HookEventName, event: unknown): void;
	startCallCount: number;
	stopCallCount: number;
}

export function createFakeUiohookModule(keyTable: Record<string, number> = {}): FakeUiohookModule {
	const listenersByEventName = new Map<HookEventName, HookEventListener[]>();

	const fakeModule: FakeUiohookModule = {
		namespace: {
			uIOhook: {
				on(eventName, listener) {
					const listeners = listenersByEventName.get(eventName) ?? [];
					listeners.push(listener);
					listenersByEventName.set(eventName, listeners);
				},
				off(eventName, listener) {
					const remaining = (listenersByEventName.get(eventName) ?? []).filter(
						(registered) => registered !== listener,
					);
					if (remaining.length === 0) {
						listenersByEventName.delete(eventName);
					} else {
						listenersByEventName.set(eventName, remaining);
					}
				},
				start() {
					fakeModule.startCallCount += 1;
				},
				stop() {
					fakeModule.stopCallCount += 1;
				},
			},
			UiohookKey: keyTable,
		},
		registeredEventNames() {
			return [...listenersByEventName.keys()];
		},
		emit(eventName, event) {
			for (const listener of listenersByEventName.get(eventName) ?? []) {
				listener(event as Parameters<HookEventListener>[0]);
			}
		},
		startCallCount: 0,
		stopCallCount: 0,
	};

	return fakeModule;
}
