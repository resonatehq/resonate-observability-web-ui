<script lang="ts">
	import { untrack } from 'svelte';
	import { searchSchedules, ApiError, type ScheduleRecord } from '$lib/api/client';
	import ScheduleTable from '$lib/components/ScheduleTable.svelte';
	import ScheduleForm from '$lib/components/ScheduleForm.svelte';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';

	let schedules: ScheduleRecord[] = $state([]);
	let error = $state<ApiError | null>(null);
	let loading = $state(true);
	let cursor = $state<string | undefined>(undefined);
	let hasMore = $state(false);
	let showForm = $state(false);
	let created = $state<ScheduleRecord | null>(null);

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

	/**
	 * Reload rather than pushing the returned record onto the list. The server
	 * decides `nextRunAt`, and a fresh search is the only thing that proves the
	 * schedule is actually registered and being scheduled — appending locally
	 * would show a row that looks identical whether or not that is true.
	 */
	function onCreated(schedule: ScheduleRecord) {
		showForm = false;
		created = schedule;
		load(false);
	}
</script>

<div class="page-header">
	<h1>Schedules</h1>
	{#if !showForm}
		<button
			class="btn btn-primary new-schedule"
			onclick={() => {
				showForm = true;
				created = null;
			}}
		>
			New schedule
		</button>
	{/if}
</div>

{#if showForm}
	<ScheduleForm oncreated={onCreated} oncancel={() => (showForm = false)} />
{/if}

{#if created}
	<div class="alert created-alert" role="status">
		Created <a href="/schedules/{created.id}" class="mono">{created.id}</a>. First run
		<span class="mono">{new Date(created.nextRunAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</span>.
	</div>
{/if}

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

	.new-schedule {
		margin-left: auto;
	}

	.created-alert {
		background: var(--status-resolved-bg);
		border: 1px solid var(--status-resolved);
		color: var(--status-resolved-fg);
		margin-bottom: 1.25rem;
	}

	.created-alert a {
		color: inherit;
		font-weight: 500;
	}
</style>
