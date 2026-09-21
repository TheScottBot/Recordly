/**
 * Groups time ordered items into runs where each item is no more than
 * `mergeGapMs` after the previous item in its run. This is the shape
 * `buildClickClusters` in `zoomSuggestionUtils.ts` has always had; typing
 * bursts follow it so the product has one clustering rule, not two.
 */
export function clusterByTimeGap<Item>(
	items: readonly Item[],
	getTimeMs: (item: Item) => number,
	mergeGapMs: number,
): Item[][] {
	if (items.length === 0) {
		return [];
	}

	const sorted = [...items].sort((earlier, later) => getTimeMs(earlier) - getTimeMs(later));
	const clusters: Item[][] = [];
	let currentCluster: Item[] = [sorted[0]];
	let currentClusterEndMs = getTimeMs(sorted[0]);

	for (let index = 1; index < sorted.length; index += 1) {
		const item = sorted[index];
		const itemTimeMs = getTimeMs(item);

		if (itemTimeMs - currentClusterEndMs <= mergeGapMs) {
			currentCluster.push(item);
			currentClusterEndMs = Math.max(currentClusterEndMs, itemTimeMs);
		} else {
			clusters.push(currentCluster);
			currentCluster = [item];
			currentClusterEndMs = itemTimeMs;
		}
	}

	clusters.push(currentCluster);
	return clusters;
}
