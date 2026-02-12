<script lang="ts">
	import type { Promise } from '$lib/api/client';

	interface Props {
		promises: Promise[];
	}

	let { promises }: Props = $props();

	const width = 200;
	const height = 60;
	const padding = 4;

	interface DataPoint {
		x: number;
		y: number;
		count: number;
	}

	// Compute throughput buckets (last 12 five-minute intervals = 1 hour)
	let dataPoints = $derived(() => {
		const now = Date.now();
		const bucketSize = 5 * 60 * 1000; // 5 minutes
		const bucketCount = 12;
		const buckets = new Array(bucketCount).fill(0);

		for (const p of promises) {
			if (p.state !== 'RESOLVED' || !p.completedOn) continue;

			const age = now - p.completedOn;
			if (age < 0 || age > bucketSize * bucketCount) continue;

			const bucketIndex = Math.floor(age / bucketSize);
			if (bucketIndex >= 0 && bucketIndex < bucketCount) {
				buckets[bucketCount - 1 - bucketIndex]++;
			}
		}

		const maxCount = Math.max(...buckets, 1);

		const points: DataPoint[] = [];
		for (let i = 0; i < bucketCount; i++) {
			const x = padding + (i / (bucketCount - 1)) * (width - padding * 2);
			const y = height - padding - (buckets[i] / maxCount) * (height - padding * 2);
			points.push({ x, y, count: buckets[i] });
		}

		return points;
	});

	let pathD = $derived(() => {
		const points = dataPoints();
		if (points.length === 0) return '';

		let d = `M ${points[0].x} ${points[0].y}`;
		for (let i = 1; i < points.length; i++) {
			d += ` L ${points[i].x} ${points[i].y}`;
		}
		return d;
	});
</script>

<div class="chart-container">
	<svg {width} {height}>
		<!-- Baseline -->
		<line
			x1={padding}
			y1={height - padding}
			x2={width - padding}
			y2={height - padding}
			stroke="var(--border)"
			stroke-width="1"
		/>

		<!-- Sparkline -->
		<path d={pathD()} fill="none" stroke="var(--secondary)" stroke-width="2" />

		<!-- Data points -->
		{#each dataPoints() as point}
			<circle cx={point.x} cy={point.y} r="2.5" fill="var(--secondary)" opacity="0.8" />
		{/each}
	</svg>

	<div class="chart-label">Last hour (5-min intervals)</div>
</div>

<style>
	.chart-container {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.chart-label {
		font-size: 0.6875rem;
		color: var(--text-muted);
		margin-top: 0.25rem;
	}
</style>
