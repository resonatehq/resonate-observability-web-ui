<script lang="ts">
	import { formatRelativeTime, timeToX } from '$lib/utils/timeline';

	interface Props {
		minTime: number;
		maxTime: number;
		width: number;
	}

	let { minTime, maxTime, width }: Props = $props();

	// Generate 5 evenly-spaced tick marks
	let ticks = $derived(() => {
		const result = [];
		for (let i = 0; i <= 4; i++) {
			const fraction = i / 4;
			const time = minTime + fraction * (maxTime - minTime);
			const x = timeToX(time, minTime, maxTime, width);
			const label = formatRelativeTime(time, minTime);
			result.push({ x, label });
		}
		return result;
	});
</script>

<g class="timeline-axis">
	<line x1={0} y1={0} x2={width} y2={0} stroke="var(--border)" stroke-width="1" />
	{#each ticks() as tick}
		<line x1={tick.x} y1={0} x2={tick.x} y2={6} stroke="var(--border)" stroke-width="1" />
		<text x={tick.x} y={18} text-anchor="middle" class="axis-label">{tick.label}</text>
	{/each}
</g>

<style>
	.axis-label {
		font-size: 0.6875rem;
		fill: var(--text-muted);
		font-family: var(--font-mono);
	}
</style>
