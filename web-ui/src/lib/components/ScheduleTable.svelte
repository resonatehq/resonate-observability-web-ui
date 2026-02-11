<script lang="ts">
	import type { Schedule } from '$lib/api/client';
	import { searchPromisesWithCursor } from '$lib/api/client';
	import Badge from './Badge.svelte';

	interface Props {
		schedules: Schedule[];
	}

	let { schedules }: Props = $props();

	interface ScheduleWithStatus extends Schedule {
		lastRunStatus?: string;
		lastRunTime?: number;
		loading?: boolean;
	}

	let schedulesWithStatus: ScheduleWithStatus[] = $state([]);

	async function loadScheduleStatus(schedule: ScheduleWithStatus) {
		schedule.loading = true;
		try {
			// Fetch most recent promise for this schedule
			const result = await searchPromisesWithCursor({
				id: `${schedule.promiseId}*`,
				limit: 1,
				sortId: -1 // Most recent first
			});

			if (result.promises.length > 0) {
				const latest = result.promises[0];
				schedule.lastRunStatus = latest.state;
				schedule.lastRunTime = latest.createdOn;
			}
		} catch {
			// Silently fail for individual schedule status loads
		} finally {
			schedule.loading = false;
		}
	}

	$effect(() => {
		schedulesWithStatus = schedules.map((s) => ({ ...s, loading: true }));
		// Load status for each schedule
		for (const schedule of schedulesWithStatus) {
			loadScheduleStatus(schedule);
		}
	});

	function formatTime(timestamp: number | undefined): string {
		if (!timestamp) return 'Never';
		return new Date(timestamp).toLocaleString();
	}
</script>

{#if schedulesWithStatus.length === 0}
	<div class="empty-state">No schedules found.</div>
{:else}
	<table class="data-table">
		<thead>
			<tr>
				<th>ID</th>
				<th>Cron</th>
				<th>Last Run</th>
				<th>Status</th>
				<th>Promise ID</th>
				<th>Description</th>
			</tr>
		</thead>
		<tbody>
			{#each schedulesWithStatus as schedule}
				<tr>
					<td><a href="/schedules/{schedule.id}" class="mono schedule-link">{schedule.id}</a></td>
					<td class="mono cron">{schedule.cron}</td>
					<td class="mono last-run">{formatTime(schedule.lastRunTime)}</td>
					<td>
						{#if schedule.loading}
							<span class="loading-status">…</span>
						{:else if schedule.lastRunStatus}
							<Badge state={schedule.lastRunStatus} />
						{:else}
							<span class="muted">—</span>
						{/if}
					</td>
					<td><a href="/promises/{schedule.promiseId}" class="mono">{schedule.promiseId}</a></td>
					<td class="description">{schedule.description ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.schedule-link {
		color: var(--secondary);
		font-weight: 500;
		text-decoration: none;
		transition: color 0.2s;
	}

	.schedule-link:hover {
		text-decoration: underline;
	}

	.cron {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.last-run {
		font-size: 0.8125rem;
	}

	.loading-status {
		color: var(--text-muted);
		font-style: italic;
	}

	.description {
		color: var(--text-muted);
		font-size: 0.875rem;
	}
</style>
