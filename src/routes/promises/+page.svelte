<script lang="ts">
	import { untrack } from 'svelte';
	import { searchPromises } from '$lib/api/client';
	import PromiseTable from '$lib/components/PromiseTable.svelte';
	import type { Promise } from '$lib/api/client';

	let query = $state('');
	let stateFilter = $state('');
	let promises: Promise[] = $state([]);
	let error = $state<string | null>(null);
	let loading = $state(true);

	async function load() {
		loading = true;
		try {
			promises = await searchPromises(query || '*', stateFilter, 50);
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

	// Load once on mount only. Reading `query`/`stateFilter` inside a tracked
	// effect made this fire a request per keystroke and left the Search button
	// doing nothing; searches are now driven by submit and the state <select>.
	$effect(() => {
		untrack(() => load());
	});
</script>

<div class="page-header">
	<h1>Promises</h1>
</div>

<form class="search-bar" onsubmit={handleSearch}>
	<input
		type="text"
		class="search-input"
		placeholder="Search promises (wildcards: *)"
		bind:value={query}
	/>
	<select class="search-select" bind:value={stateFilter} onchange={() => load()}>
		<option value="">All States</option>
		<option value="pending">Pending</option>
		<option value="resolved">Resolved</option>
		<option value="rejected">Rejected</option>
	</select>
	<button type="submit" class="btn btn-primary">Search</button>
</form>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

{#if loading}
	<div class="loading">Loading...</div>
{:else}
	<PromiseTable {promises} />
{/if}
