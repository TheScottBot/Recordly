/**
 * How a zoom region's trigger is shown on the timeline.
 *
 * Pure, so the choice can be tested without rendering. Colour alone never
 * carries the distinction: every trigger also has a word on the item and a
 * longer description for its tooltip, which datum 0.16 requires.
 */

import type { ZoomTrigger } from "../types";

export interface ZoomTriggerAppearance {
	/** A class name in `ItemGlass.module.css`. */
	glassClassName: "glassPurple" | "glassPink";
	/** The short word shown on the item itself. */
	label: string;
	/** The longer description for the item's tooltip. */
	itemTitle: string;
}

/**
 * A region with no recorded trigger is a click zoom: that is what every
 * region saved before typing zooms existed actually is, and what a region
 * added by hand is.
 */
export function describeZoomTrigger(trigger: ZoomTrigger | undefined): ZoomTriggerAppearance {
	if (trigger === "typing") {
		return {
			glassClassName: "glassPink",
			label: "Typing",
			itemTitle: "Zoom suggested by typing",
		};
	}

	return {
		glassClassName: "glassPurple",
		label: "Click",
		itemTitle: "Zoom suggested by a click",
	};
}
