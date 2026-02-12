<script lang="ts">
	import { timeToX } from '$lib/utils/timeline';
	import type { TimelineBar } from '$lib/utils/timeline';

	interface Props {
		bar: TimelineBar;
		minTime: number;
		maxTime: number;
		width: number;
		onClick?: (id: string) => void;
	}

	let { bar, minTime, maxTime, width, onClick }: Props = $props();

	let x = $derived(timeToX(bar.startTime, minTime, maxTime, width));
	let x2 = $derived(timeToX(bar.endTime ?? maxTime, minTime, maxTime, width));
	let barWidth = $derived(Math.max(x2 - x, 2)); // Minimum 2px for visibility

	function barColor(state: string): string {
		switch (state) {
			case 'RESOLVED':
				return 'var(--green)';
			case 'PENDING':
				return 'var(--yellow)';
			case 'REJECTED':
			case 'REJECTED_CANCELED':
			case 'REJECTED_TIMEDOUT':
				return 'var(--red)';
			default:
				return 'var(--muted)';
		}
	}

	function roleColor(role: string): string {
		switch (role) {
			case 'rpc':
				return 'var(--secondary)';
			case 'run':
				return '#a855f7';
			case 'sleep':
				return 'var(--muted)';
			default:
				return 'var(--text)';
		}
	}

	let isPending = $derived(bar.state === 'PENDING');

	function handleClick() {
		onClick?.(bar.id);
	}
</script>

<g class="timeline-bar" class:pending={isPending} onclick={handleClick} style="cursor: pointer;">
	<!-- Bar rect -->
	<rect
		{x}
		y={bar.y}
		width={barWidth}
		height={20}
		rx="3"
		fill={barColor(bar.state)}
		opacity="0.8"
		class="bar-rect"
	/>

	<!-- Label (show if bar is wide enough) -->
	{#if barWidth > 40}
		<text x={x + 4} y={bar.y + 14} class="bar-label" fill={roleColor(bar.role)}>
			{bar.label.length > Math.floor(barWidth / 7) ? bar.label.slice(0, Math.floor(barWidth / 7)) + '...' : bar.label}
		</text>
	{/if}
</g>

<style>
	.bar-rect {
		transition: opacity 0.2s;
	}

	.timeline-bar:hover .bar-rect {
		opacity: 1;
		stroke: var(--text);
		stroke-width: 1;
	}

	.timeline-bar.pending .bar-rect {
		animation: pulse-bar 2s ease-in-out infinite;
	}

	@keyframes pulse-bar {
		0%,
		100% {
			opacity: 0.8;
		}
		50% {
			opacity: 1;
		}
	}

	.bar-label {
		font-size: 0.6875rem;
		font-weight: 500;
		pointer-events: none;
	}
</style>
