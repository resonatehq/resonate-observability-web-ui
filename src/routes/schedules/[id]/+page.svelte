<script lang="ts">
	import { page } from '$app/state';
	import { getSchedule, ApiError, decodeValueAsJson, type ScheduleRecord } from '$lib/api/client';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';

	const scheduleId = $derived(page.params.id!);

	let schedule = $state<ScheduleRecord | null>(null);
	let loading = $state(true);
	let error = $state<ApiError | null>(null);

	async function load() {
		loading = true;
		try {
			schedule = await getSchedule(scheduleId);
			error = null;
		} catch (e) {
			error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		load();
		const interval = setInterval(() => load(), 5000);
		return () => clearInterval(interval);
	});

	function formatTime(timestamp: number | undefined): string {
		if (timestamp == null) return 'Never';
		return new Date(timestamp).toLocaleString();
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
		return `${(ms / 3_600_000).toFixed(1)}h`;
	}

	const paramJson = $derived(schedule ? decodeValueAsJson(schedule.promiseParam) : null);
</script>

<div class="schedule-detail">
	{#if error}
		<ErrorPanel {error} while="loading this schedule" />
	{/if}

	{#if loading && !schedule}
		<div class="loading">Loading schedule...</div>
	{:else if schedule}
		<div class="page-header">
			<div>
				<h1>{schedule.id}</h1>
			</div>
			<a href="/schedules" class="btn">Back to Schedules</a>
		</div>

		<div class="schedule-info">
			<div class="info-card">
				<div class="info-label">Cron Expression</div>
				<div class="info-value mono">{schedule.cron}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Promise ID Template</div>
				<div class="info-value mono">{schedule.promiseId}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Promise Timeout</div>
				<div class="info-value mono">{formatDuration(schedule.promiseTimeout)}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Last Run</div>
				<div class="info-value mono">{formatTime(schedule.lastRunAt)}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Next Run</div>
				<div class="info-value mono">{formatTime(schedule.nextRunAt)}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Created</div>
				<div class="info-value mono">{formatTime(schedule.createdAt)}</div>
			</div>
		</div>

		{#if Object.keys(schedule.promiseTags).length > 0}
			<div class="tags-section">
				<h2 class="section-title">Promise Tags</h2>
				<div class="tags-list">
					{#each Object.entries(schedule.promiseTags) as [k, v]}
						<span class="tag">{k}={v}</span>
					{/each}
				</div>
			</div>
		{/if}

		{#if paramJson}
			<div class="tags-section">
				<h2 class="section-title">Promise Parameter</h2>
				<pre class="param-block mono">{paramJson}</pre>
			</div>
		{/if}

		<!--
			The "Recent Runs" table that used to sit here has been removed rather
			than left broken. Finding the promises a schedule produced requires a
			prefix match on the promise-ID template, and `promise.search` has no
			id filter — the old query was accepted and ignored, so the table was
			showing the first 50 promises on the server and calling them runs of
			this schedule. `lastRunAt` above is the honest version of that
			information until the server grows an id filter.
		-->
		<div class="runs-note">
			<h2 class="section-title">Recent Runs</h2>
			<p class="muted">
				Not available. Listing a schedule&rsquo;s runs needs a prefix search on the
				promise-ID template, which the server does not currently support.
			</p>
		</div>
	{/if}
</div>

<style>
	.param-block {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.75rem;
		overflow-x: auto;
		font-size: 0.8125rem;
	}

	.runs-note {
		margin-top: 2rem;
	}

	.schedule-detail {
		padding: 1.5rem;
	}

	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}


	.schedule-info {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.info-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1rem;
	}

	.info-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.info-value {
		font-size: 0.9375rem;
		color: var(--text);
		font-weight: 500;
	}

	.tags-section {
		margin-bottom: 2rem;
	}

	.section-title {
		font-size: 1.125rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}

	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}






</style>
