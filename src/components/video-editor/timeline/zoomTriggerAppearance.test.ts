import { describe, expect, it } from "vitest";
import { describeZoomTrigger } from "./zoomTriggerAppearance";

describe("describeZoomTrigger", () => {
	it("keeps the existing appearance for a zoom a click produced", () => {
		expect(describeZoomTrigger("click")).toEqual({
			glassClassName: "glassPurple",
			label: "Click",
			itemTitle: "Zoom suggested by a click",
		});
	});

	it("treats a region with no recorded trigger as a click, which is what every earlier project holds", () => {
		expect(describeZoomTrigger(undefined)).toEqual(describeZoomTrigger("click"));
	});

	it("gives a zoom typing produced its own colour and its own word", () => {
		const typingAppearance = describeZoomTrigger("typing");

		expect(typingAppearance).toEqual({
			glassClassName: "glassPink",
			label: "Typing",
			itemTitle: "Zoom suggested by typing",
		});
	});

	it("never distinguishes the two by colour alone, which datum 0.16 forbids", () => {
		const clickAppearance = describeZoomTrigger("click");
		const typingAppearance = describeZoomTrigger("typing");

		expect(typingAppearance.glassClassName).not.toBe(clickAppearance.glassClassName);
		expect(typingAppearance.label).not.toBe(clickAppearance.label);
		expect(typingAppearance.itemTitle).not.toBe(clickAppearance.itemTitle);
	});
});
