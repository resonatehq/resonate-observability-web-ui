<script lang="ts">
	import { untrack } from 'svelte';
	import {
		searchPromises,
		ApiError,
		PROMISE_STATES,
		type PromiseRecord,
		type PromiseState
	} from '$lib/api/client';
	import PromiseTable from '$lib/components/PromiseTable.svelte';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';
	import { stateLabel } from '$lib/utils/state';
	import AskAi from '$lib/components/AskAi.svelte';

	const PAGE_SIZE = 50;

	let stateFilter = $state<PromiseState | ''>('');
	let promises: PromiseRecord[] = $state([]);
	let error = $state<ApiError | null>(null);
	let loading = $state(true);
	let cursor = $state<string | undefined>(undefined);
	let hasMore = $state(false);

	async function load(append = false) {
		loading = true;
		try {
			const result = await searchPromises({
				state: stateFilter || undefined,
				limit: PAGE_SIZE,
				cursor: append ? cursor : undefined
			});
			promises = append ? [...promises, ...result.promises] : result.promises;
			cursor = result.cursor;
			hasMore = !!result.cursor;
			error = null;
		} catch (e) {
			error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
		} finally {
			loading = false;
		}
	}

	function changeFilter() {
		cursor = undefined;
		load(false);
	}

	$effect(() => {
		untrack(() => load(false));
	});

	function capture() {
		return {
			view: 'Promises',
			path: '/promises',
			viewState: {
				stateFilter: stateFilter || null,
				pageSize: PAGE_SIZE,
				loaded: promises.length,
				moreAvailable: hasMore
			},
			groups: [{ label: 'Promises in view', kind: 'promise', records: promises }],
			selection: null,
			loadError: error,
			notes: [
				stateFilter
					? `Filtered to state \`${stateFilter}\`. The server's filter is an exact match, so the other four states are absent by request, not because none exist.`
					: 'Unfiltered — every state the page reached is here.',
				// Only a page that actually got an answer may say what the server
				// holds. On a failed load the count is zero because the request
				// failed, and "all N the server holds" would state the opposite.
				...(error
					? []
					: [
							hasMore
								? `These are the first ${promises.length} promises by id, and the server has more. Ordering is by id because the server offers no sort, so this is not "the most recent".`
								: `All ${promises.length} matching promises the server holds. Ordering is by id — the server offers no sort.`
						])
			]
		};
	}
</script>

<div class="page-header">
	<h1>Promises</h1>
</div>

<!--
	There is no search box here on purpose.

	`promise.search` takes only {state, tags, limit, cursor} — it has no id
	filter and no sort, and an unrecognised `id` parameter is silently ignored
	rather than rejected. The box that used to sit here therefore accepted a
	query, sent it, and returned every promise on the server as though it had
	matched. Filtering by state and paging through is less capable and is not
	a lie; the id filter is filed as a server ask.
-->
<div class="filter-bar">
	<label class="filter-label" for="state-filter">State</label>
	<select
		id="state-filter"
		class="search-select"
		bind:value={stateFilter}
		onchange={changeFilter}
	>
		<option value="">All states</option>
		{#each PROMISE_STATES as state}
			<option value={state}>{stateLabel(state)}</option>
		{/each}
	</select>
	<span class="muted filter-note">Ordered by ID — the server offers no sort.</span>
	<AskAi {capture} size="small" />
</div>

{#if error}
	<ErrorPanel {error} while="loading promises" />
{/if}

{#if loading && promises.length === 0}
	<div class="loading">Loading...</div>
{:else}
	<PromiseTable {promises} />
	{#if hasMore}
		<div class="load-more">
			<button class="btn" onclick={() => load(true)} disabled={loading}>
				{loading ? 'Loading...' : 'Load more'}
			</button>
		</div>
	{/if}
{/if}

<style>
	.filter-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.filter-label {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.filter-note {
		font-size: 0.8125rem;
	}

	.load-more {
		display: flex;
		justify-content: center;
		margin-top: 1.5rem;
	}
</style>
