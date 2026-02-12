<script lang="ts">
	import type { PromiseStats } from '$lib/utils/stats';

	interface Props {
		stats: PromiseStats;
	}

	let { stats }: Props = $props();

	// SVG donut chart using stroke-dasharray
	const radius = 60;
	const strokeWidth = 16;
	const circumference = 2 * Math.PI * radius;

	interface Segment {
		color: string;
		value: number;
		label: string;
		offset: number;
		dasharray: string;
	}

	let segments = $derived(() => {
		const total = stats.total;
		if (total === 0) {
			return [];
		}

		const data = [
			{ label: 'Resolved', value: stats.resolved, color: 'var(--green)' },
			{ label: 'Pending', value: stats.pending, color: 'var(--yellow)' },
			{ label: 'Rejected', value: stats.rejected, color: 'var(--red)' }
		];

		let offset = 0;
		const result: Segment[] = [];

		for (const item of data) {
			if (item.value === 0) continue;

			const percent = item.value / total;
			const segmentLength = percent * circumference;
			const gap = circumference - segmentLength;

			result.push({
				color: item.color,
				value: item.value,
				label: item.label,
				offset,
				dasharray: `${segmentLength} ${gap}`
			});

			offset -= segmentLength;
		}

		return result;
	});
</script>

<div class="donut-container">
	<svg width="140" height="140" viewBox="0 0 140 140">
		{#each segments() as segment}
			<circle
				cx="70"
				cy="70"
				r={radius}
				fill="none"
				stroke={segment.color}
				stroke-width={strokeWidth}
				stroke-dasharray={segment.dasharray}
				stroke-dashoffset={segment.offset}
				transform="rotate(-90 70 70)"
				opacity="0.85"
			/>
		{/each}
		<text x="70" y="70" text-anchor="middle" class="donut-label">
			<tspan x="70" dy="-0.2em" class="donut-total">{stats.total}</tspan>
			<tspan x="70" dy="1.2em" class="donut-subtitle">Total</tspan>
		</text>
	</svg>

	<div class="donut-legend">
		<div class="legend-item">
			<span class="legend-color" style="background: var(--green);"></span>
			<span class="legend-label">Resolved: {stats.resolved}</span>
		</div>
		<div class="legend-item">
			<span class="legend-color" style="background: var(--yellow);"></span>
			<span class="legend-label">Pending: {stats.pending}</span>
		</div>
		<div class="legend-item">
			<span class="legend-color" style="background: var(--red);"></span>
			<span class="legend-label">Rejected: {stats.rejected}</span>
		</div>
	</div>
</div>

<style>
	.donut-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.donut-label {
		font-family: 'Inter', sans-serif;
	}

	.donut-total {
		font-size: 1.5rem;
		font-weight: 600;
		fill: var(--text);
	}

	.donut-subtitle {
		font-size: 0.75rem;
		fill: var(--text-muted);
	}

	.donut-legend {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.legend-color {
		width: 12px;
		height: 12px;
		border-radius: 2px;
	}

	.legend-label {
		font-size: 0.875rem;
		color: var(--text);
	}
</style>
