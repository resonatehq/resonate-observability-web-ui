<script lang="ts">
	import { treeToTimelineData } from '$lib/utils/timeline';
	import type { TreeNode } from '$lib/utils/tree';
	import TimelineAxis from './TimelineAxis.svelte';
	import TimelineBar from './TimelineBar.svelte';

	interface Props {
		tree: TreeNode;
		onBarClick?: (promiseId: string) => void;
	}

	let { tree, onBarClick }: Props = $props();

	let timelineData = $derived(treeToTimelineData(tree));

	// SVG dimensions
	const PADDING_LEFT = 40;
	const PADDING_RIGHT = 40;
	const PADDING_TOP = 40;
	const PADDING_BOTTOM = 20;
	const TIMELINE_WIDTH = 900;

	let svgHeight = $derived(
		Math.max(timelineData.bars.length * 28, 100) + PADDING_TOP + PADDING_BOTTOM
	);
</script>

<div class="timeline-wrapper">
	{#if timelineData.bars.length === 0}
		<div class="empty-state">No timeline data available</div>
	{:else}
		<svg width={PADDING_LEFT + TIMELINE_WIDTH + PADDING_RIGHT} height={svgHeight}>
			<!-- Time axis at top -->
			<g transform="translate({PADDING_LEFT}, {PADDING_TOP})">
				<TimelineAxis
					minTime={timelineData.minTime}
					maxTime={timelineData.maxTime}
					width={TIMELINE_WIDTH}
				/>
			</g>

			<!-- Bars -->
			<g transform="translate({PADDING_LEFT}, {PADDING_TOP + 30})">
				{#each timelineData.bars as bar}
					<TimelineBar
						{bar}
						minTime={timelineData.minTime}
						maxTime={timelineData.maxTime}
						width={TIMELINE_WIDTH}
						onClick={onBarClick}
					/>
				{/each}
			</g>
		</svg>
	{/if}
</div>

<style>
	.timeline-wrapper {
		width: 100%;
		height: 100%;
		overflow: auto;
		background: var(--bg);
		border-radius: 8px;
		padding: 1rem;
	}

	.empty-state {
		padding: 3rem;
		text-align: center;
		color: var(--text-muted);
	}

	.row-label {
		font-size: 0.75rem;
		fill: var(--text-muted);
		font-weight: 500;
	}

	svg {
		display: block;
	}
</style>
