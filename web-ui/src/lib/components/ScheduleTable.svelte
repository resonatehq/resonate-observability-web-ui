<script lang="ts">
	import type { Schedule } from '$lib/api/client';

	interface Props {
		schedules: Schedule[];
	}

	let { schedules }: Props = $props();
</script>

{#if schedules.length === 0}
	<div class="empty-state">No schedules found.</div>
{:else}
	<table class="data-table">
		<thead>
			<tr>
				<th>ID</th>
				<th>Cron</th>
				<th>Promise ID</th>
				<th>Description</th>
				<th>Tags</th>
			</tr>
		</thead>
		<tbody>
			{#each schedules as schedule}
				<tr>
					<td class="mono">{schedule.id}</td>
					<td class="mono">{schedule.cron}</td>
					<td><a href="/promises/{schedule.promiseId}" class="mono">{schedule.promiseId}</a></td>
					<td>{schedule.description ?? ''}</td>
					<td>
						{#if schedule.tags}
							{#each Object.entries(schedule.tags) as [k, v]}
								<span class="tag">{k}={v}</span>
							{/each}
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
