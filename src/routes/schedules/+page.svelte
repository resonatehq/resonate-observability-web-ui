<script lang="ts">
	import { untrack } from 'svelte';
	import { searchSchedules, ApiError, type ScheduleRecord } from '$lib/api/client';
	import ScheduleTable from '$lib/components/ScheduleTable.svelte';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';

	let schedules: ScheduleRecord[] = $state([]);
	let error = $state<ApiError | null>(null);
	let loading = $state(true);
	let cursor = $state<string | undefined>(undefined);
	let hasMore = $state(false);

	async function load(append = false) {
		loading = true;
		try {
			const result = await searchSchedules({
				limit: 50,
				cursor: append ? cursor : undefined
			});
			schedules = append ? [...schedules, ...result.schedules] : result.schedules;
			cursor = result.cursor;
			hasMore = !!result.cursor;
			error = null;
		} catch (e) {
			error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		untrack(() => load(false));
	});
</script>

<div class="page-header">
	<h1>Schedules</h1>
</div>

<!--
	No search box: `schedule.search` takes only {tags, limit, cursor}. An id
	query would have been accepted and ignored.
-->

{#if error}
	<ErrorPanel {error} while="loading schedules" />
{/if}

{#if loading && schedules.length === 0}
	<div class="loading">Loading...</div>
{:else}
	<ScheduleTable {schedules} />
	{#if hasMore}
		<div class="load-more">
			<button class="btn" onclick={() => load(true)} disabled={loading}>
				{loading ? 'Loading...' : 'Load more'}
			</button>
		</div>
	{/if}
{/if}

<style>
	.load-more {
		display: flex;
		justify-content: center;
		margin-top: 1.5rem;
	}
</style>
