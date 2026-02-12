<script lang="ts">
	import { page } from '$app/state';
	import { getSchedule, searchPromisesWithCursor, type Schedule, type Promise } from '$lib/api/client';
	import Badge from '$lib/components/Badge.svelte';

	const scheduleId = $derived(page.params.id);

	let schedule: Schedule | null = $state(null);
	let recentRuns: Promise[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);

	async function load() {
		loading = true;
		error = null;
		try {
			// Fetch schedule details
			schedule = await getSchedule(scheduleId);

			// Fetch recent runs (promises triggered by this schedule)
			if (schedule) {
				const result = await searchPromisesWithCursor({
					id: `${schedule.promiseId}*`,
					limit: 50,
					sortId: -1 // Most recent first
				});
				recentRuns = result.promises;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
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
		if (!timestamp) return 'Never';
		return new Date(timestamp).toLocaleString();
	}

	function getRunDuration(run: Promise): string {
		if (!run.createdOn) return '—';
		if (run.state === 'PENDING') {
			const elapsed = Date.now() - run.createdOn;
			return formatDuration(elapsed) + ' (running)';
		}
		if (run.completedOn) {
			const duration = run.completedOn - run.createdOn;
			return formatDuration(duration);
		}
		return '—';
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
		return `${(ms / 3_600_000).toFixed(1)}h`;
	}
</script>

<div class="schedule-detail">
	{#if error}
		<div class="alert alert-error">{error}</div>
	{/if}

	{#if loading && !schedule}
		<div class="loading">Loading schedule...</div>
	{:else if schedule}
		<div class="page-header">
			<div>
				<h1>{schedule.id}</h1>
				{#if schedule.description}
					<p class="schedule-description">{schedule.description}</p>
				{/if}
			</div>
			<a href="/schedules" class="btn">Back to Schedules</a>
		</div>

		<div class="schedule-info">
			<div class="info-card">
				<div class="info-label">Cron Expression</div>
				<div class="info-value mono">{schedule.cron}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Promise ID Pattern</div>
				<div class="info-value mono">{schedule.promiseId}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Last Run</div>
				<div class="info-value mono">{formatTime(schedule.lastRunTime)}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Next Run</div>
				<div class="info-value mono">{formatTime(schedule.nextRunTime)}</div>
			</div>

			<div class="info-card">
				<div class="info-label">Created</div>
				<div class="info-value mono">{formatTime(schedule.createdOn)}</div>
			</div>
		</div>

		{#if schedule.tags && Object.keys(schedule.tags).length > 0}
			<div class="tags-section">
				<h2 class="section-title">Tags</h2>
				<div class="tags-list">
					{#each Object.entries(schedule.tags) as [k, v]}
						<span class="tag">{k}={v}</span>
					{/each}
				</div>
			</div>
		{/if}

		<div class="recent-runs-section">
			<h2 class="section-title">Recent Runs ({recentRuns.length})</h2>

			{#if recentRuns.length === 0}
				<div class="empty-state">No runs found for this schedule.</div>
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th>State</th>
							<th>Promise ID</th>
							<th>Created</th>
							<th>Completed</th>
							<th>Duration</th>
						</tr>
					</thead>
					<tbody>
						{#each recentRuns as run}
							<tr>
								<td><Badge state={run.state} /></td>
								<td>
									<a href="/workflows/{run.id}" class="mono promise-link">{run.id}</a>
								</td>
								<td class="mono time">{formatTime(run.createdOn)}</td>
								<td class="mono time">{formatTime(run.completedOn)}</td>
								<td class="mono duration">{getRunDuration(run)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
</div>

<style>
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

	.schedule-description {
		color: var(--text-muted);
		font-size: 0.875rem;
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

	.recent-runs-section {
		margin-bottom: 2rem;
	}

	.promise-link {
		color: var(--secondary);
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.promise-link:hover {
		text-decoration: underline;
	}

	.time {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.duration {
		font-size: 0.8125rem;
	}

	.empty-state {
		padding: 3rem;
		text-align: center;
		color: var(--text-muted);
	}
</style>
