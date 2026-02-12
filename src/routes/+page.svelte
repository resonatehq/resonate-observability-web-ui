<script lang="ts">
	import { dashboardStore } from '$lib/stores/dashboard.svelte';
	import StateDonut from '$lib/components/dashboard/StateDonut.svelte';
	import ThroughputChart from '$lib/components/dashboard/ThroughputChart.svelte';
	import ActiveWorkflows from '$lib/components/dashboard/ActiveWorkflows.svelte';
	import ErrorList from '$lib/components/dashboard/ErrorList.svelte';

	$effect(() => {
		dashboardStore.startPolling(5000);
		return () => dashboardStore.stopPolling();
	});

	let stats = $derived(dashboardStore.stats);
	let loading = $derived(dashboardStore.loading);
	let error = $derived(dashboardStore.error);
</script>

<div class="dashboard">
	<div class="page-header">
		<h1>Dashboard</h1>
		<div class="header-info">
			{#if !loading}
				<span class="last-updated muted">Auto-refreshing every 5s</span>
			{/if}
		</div>
	</div>

	{#if error}
		<div class="alert alert-error">{error}</div>
	{/if}

	{#if loading && dashboardStore.promises.length === 0}
		<div class="loading">Loading dashboard...</div>
	{:else}
		<!-- Metric Cards -->
		<div class="metric-grid">
			<a href="/workflows?state=pending" class="metric-card">
				<div class="metric-label">Active</div>
				<div class="metric-value">{stats.pending}</div>
				<div class="metric-trend pending">Pending workflows</div>
			</a>

			<a href="/workflows?state=resolved" class="metric-card">
				<div class="metric-label">Resolved</div>
				<div class="metric-value">{stats.resolved}</div>
				<div class="metric-trend resolved">Completed successfully</div>
			</a>

			<a href="/workflows?state=rejected" class="metric-card">
				<div class="metric-label">Rejected</div>
				<div class="metric-value">{stats.rejected}</div>
				<div class="metric-trend rejected">
					{stats.errorRate.toFixed(1)}% error rate
				</div>
			</a>

			<a href="/schedules" class="metric-card">
				<div class="metric-label">Schedules</div>
				<div class="metric-value">{dashboardStore.schedules.length}</div>
				<div class="metric-trend">Active schedules</div>
			</a>

			<div class="metric-card">
				<div class="metric-label">Throughput</div>
				<div class="metric-value">{stats.throughputPerMin.toFixed(1)}/min</div>
				<div class="metric-trend">Resolved per minute</div>
			</div>
		</div>

		<!-- Main Content Grid -->
		<div class="content-grid">
			<!-- State Donut Chart -->
			<div class="panel">
				<h2 class="panel-title">State Distribution</h2>
				<StateDonut {stats} />
			</div>

			<!-- Throughput Chart -->
			<div class="panel">
				<h2 class="panel-title">Throughput Trend</h2>
				<ThroughputChart promises={dashboardStore.promises} />
			</div>

			<!-- Recent Failures -->
			<div class="panel wide">
				<h2 class="panel-title">Recent Failures</h2>
				<ErrorList failures={dashboardStore.recentFailures} />
			</div>

			<!-- Active Workflows -->
			<div class="panel wide">
				<h2 class="panel-title">Active Workflows</h2>
				<ActiveWorkflows workflows={dashboardStore.activePending} />
			</div>
		</div>
	{/if}
</div>

<style>
	.dashboard {
		padding: 1.5rem;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.header-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.last-updated {
		font-size: 0.8125rem;
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.metric-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
		text-decoration: none;
		color: var(--text);
		transition: all 0.2s;
	}

	.metric-card:hover {
		border-color: var(--secondary);
		box-shadow: 0 0 0 1px rgba(30, 227, 207, 0.1);
		text-decoration: none;
	}

	.metric-label {
		font-size: 0.8125rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.metric-value {
		font-size: 2rem;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 0.375rem;
		font-variant-numeric: tabular-nums;
	}

	.metric-trend {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.metric-trend.pending {
		color: var(--yellow);
	}

	.metric-trend.resolved {
		color: var(--green);
	}

	.metric-trend.rejected {
		color: var(--red);
	}

	.content-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1rem;
	}

	.panel {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
	}

	.panel.wide {
		grid-column: span 2;
	}

	@media (max-width: 900px) {
		.panel.wide {
			grid-column: span 1;
		}
	}

	.panel-title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 1rem;
	}
</style>
