<script lang="ts">
	import type { ScheduleRecord } from '$lib/api/client';
	import { formatUtc } from '$lib/utils/cron';

	interface Props {
		schedules: ScheduleRecord[];
	}

	let { schedules }: Props = $props();

	/**
	 * There is no "last run status" column any more, and it is not an oversight.
	 *
	 * Finding the promise a schedule most recently produced needs a prefix
	 * search on `promiseId` plus a newest-first sort — the schedule's
	 * `promiseId` is a template like `nightly-{{.timestamp}}`, not an id. The
	 * server offers neither, and the previous implementation's request was
	 * accepted and silently ignored, so the badge it rendered was the state of
	 * whichever promise happened to sort first on the whole server.
	 *
	 * `lastRunAt` and `nextRunAt` come straight off the schedule record and are
	 * true, so those are what this shows.
	 */
	function formatTime(timestamp: number | undefined): string {
		if (timestamp == null) return 'Never';
		return new Date(timestamp).toLocaleString();
	}

	/**
	 * A schedule's cron is evaluated in UTC and has no timezone field, but
	 * these columns render in the browser's zone. That is the more useful
	 * frame for "when does this run in my day" and it is kept — what is not
	 * kept is leaving the frame unstated. Beside a form that quotes fire times
	 * as `03:30 UTC`, an unlabelled `9:30:00 PM` for the same instant reads as
	 * a contradiction rather than a conversion.
	 *
	 * The zone name is resolved once; it cannot change while the page is open.
	 */
	const localZone =
		Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local time';

	function utcTitle(timestamp: number | undefined): string {
		if (timestamp == null) return '';
		return `${formatUtc(timestamp)} — shown above in ${localZone}`;
	}
</script>

{#if schedules.length === 0}
	<div class="empty-state">No schedules found.</div>
{:else}
	<table class="data-table">
		<thead>
			<tr>
				<th>ID</th>
				<th>Cron</th>
				<th>Last run <span class="zone">({localZone})</span></th>
				<th>Next run <span class="zone">({localZone})</span></th>
				<th>Promise ID template</th>
			</tr>
		</thead>
		<tbody>
			{#each schedules as schedule}
				<tr>
					<td><a href="/schedules/{schedule.id}" class="mono schedule-link">{schedule.id}</a></td>
					<td class="mono cron">{schedule.cron}</td>
					<td class="mono run-time" title={utcTitle(schedule.lastRunAt)}>
						{formatTime(schedule.lastRunAt)}
					</td>
					<td class="mono run-time" title={utcTitle(schedule.nextRunAt)}>
						{formatTime(schedule.nextRunAt)}
					</td>
					<td class="mono template">{schedule.promiseId}</td>
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

	.zone {
		font-weight: 400;
		text-transform: none;
		color: var(--text-muted);
	}

	.run-time {
		font-size: 0.8125rem;
	}

	.template {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
</style>
