import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every locale must offer exactly the keys English does.
 *
 * A missing key does not fail loudly at runtime: the interface falls back to
 * English, or to the raw key, for whoever is using that language, and nobody
 * who works in English ever sees it. This is the only thing that catches it,
 * and it exists because the typing detection control added three keys across
 * eleven locales by hand on 24 September 2026.
 */

const localesDirectory = path.join(process.cwd(), "src", "i18n", "locales");

function flattenKeys(value: Record<string, unknown>, prefix = ""): string[] {
	return Object.entries(value).flatMap(([key, child]) => {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		return child && typeof child === "object" && !Array.isArray(child)
			? flattenKeys(child as Record<string, unknown>, fullKey)
			: [fullKey];
	});
}

function readKeys(locale: string, namespace: string): string[] {
	const file = path.join(localesDirectory, locale, namespace);
	return flattenKeys(JSON.parse(fs.readFileSync(file, "utf8")));
}

const locales = fs.readdirSync(localesDirectory);
const englishNamespaces = fs.readdirSync(path.join(localesDirectory, "en"));
const translatedLocales = locales.filter((locale) => locale !== "en");

describe("every locale offers the same keys as English", () => {
	it("ships the locales the product claims to", () => {
		// Named rather than counted, so dropping one is a failure that says
		// which one.
		expect(locales.sort()).toEqual([
			"de",
			"en",
			"es",
			"fr",
			"it",
			"ko",
			"nl",
			"pt-BR",
			"ru",
			"zh-CN",
			"zh-TW",
		]);
	});

	for (const namespace of englishNamespaces) {
		for (const locale of translatedLocales) {
			it(`${locale} matches English for ${namespace}`, () => {
				const englishKeys = readKeys("en", namespace).sort();

				expect(readKeys(locale, namespace).sort()).toEqual(englishKeys);
			});
		}
	}
});
