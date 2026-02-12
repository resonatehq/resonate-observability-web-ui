<script lang="ts">
	import { searchSchedules } from '$lib/api/client';
	import ScheduleTable from '$lib/components/ScheduleTable.svelte';
	import type { Schedule } from '$lib/api/client';

	let query = $state('');
	let schedules: Schedule[] = $state([]);
	let error: string | null = $state(null);
	let loading = $state(true);

	async function load() {
		loading = true;
		try {
			schedules = await searchSchedules(query || '*', 50);
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function handleSearch(e: SubmitEvent) {
		e.preventDefault();
		load();
	}

	$effect(() => {
		load();
	});
</script>

<div class="page-header">
	<h1>Schedules</h1>
</div>

<form class="search-bar" onsubmit={handleSearch}>
	<input
		type="text"
		class="search-input"
		placeholder="Search schedules (wildcards: *)"
		bind:value={query}
	/>
	<button type="submit" class="btn btn-primary">Search</button>
</form>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

{#if loading}
	<div class="loading">Loading...</div>
{:else}
	<ScheduleTable {schedules} />
{/if}
