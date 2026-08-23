<script lang="ts">
	import { timeToX } from '$lib/utils/timeline';
	import type { TimelineBar } from '$lib/utils/timeline';
	import type { PromiseState } from '$lib/api/client';
	import { stateColor, toSubtreeStatus } from '$lib/utils/state';

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

	const barColor = stateColor;

	function roleColor(role: string): string {
		switch (role) {
			case 'rpc':
				return 'var(--secondary)';
			case 'run':
				return 'var(--role-run)';
			case 'sleep':
				return 'var(--text-muted)';
			default:
				return 'var(--text)';
		}
	}

	/**
	 * Contrast against the bar fill, which is what `barColor` just painted.
	 *
	 * This was two hardcoded values picked for the old dark-only palette, so the
	 * light theme got whichever one happened to be wrong. Each state now carries
	 * its own `-on` token, chosen per theme against that state's actual mark —
	 * every pair clears 4.5:1.
	 */
	function textColor(state: PromiseState): string {
		return `var(--status-${toSubtreeStatus(state)}-on)`;
	}

	let isPending = $derived(bar.state === 'pending');

	function handleClick() {
		onClick?.(bar.id);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onClick?.(bar.id);
		}
	}
</script>

<g
	class="timeline-bar"
	class:pending={isPending}
	role="button"
	tabindex="0"
	aria-label="{bar.label} ({bar.state})"
	onclick={handleClick}
	onkeydown={handleKeydown}
	style="cursor: pointer;"
>
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
		<text x={x + 4} y={bar.y + 14} class="bar-label" fill={textColor(bar.state)}>
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
