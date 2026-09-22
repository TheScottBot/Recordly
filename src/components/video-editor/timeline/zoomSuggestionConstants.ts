/**
 * Timing constants shared by click clustering and typing bursts. They live
 * apart from `zoomSuggestionUtils.ts` so that module and `typingBurstUtils.ts`
 * can each import them without importing each other in a cycle.
 */

/** Max gap between consecutive clicks before they are split into separate zoom clusters. */
export const CLICK_CLUSTER_MERGE_GAP_MS = 2500;
/** Padding added before the first click and after the last click in a cluster. */
export const CLICK_CLUSTER_PAD_MS = 500;
