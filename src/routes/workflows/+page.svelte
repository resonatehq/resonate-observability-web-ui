<script lang="ts">
	import {
		searchPromises,
		ApiError,
		PROMISE_STATES,
		type PromiseRecord,
		type PromiseState
	} from '$lib/api/client';
	import {
		buildTree,
		fetchTreePromises,
		isRootInSet,
		computeSubtreeStatus,
		computeDuration,
		formatDuration,
		type TreeNode,
		type SubtreeStatus
	} from '$lib/utils/tree';
	import { stateLabel, subtreeColor } from '$lib/utils/state';
	import WorkflowGraph from '$lib/components/graph/WorkflowGraph.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';
	import StaleNotice from '$lib/components/StaleNotice.svelte';
	import AskAi from '$lib/components/AskAi.svelte';

	interface WorkflowItem {
		promise: PromiseRecord;
		tree: TreeNode | null;
		loading: boolean;
		/**
		 * Identifies the version of the root promise the tree was built from.
		 * The tree is refetched when this no longer matches the root, which is
		 * what stops an expanded card graph freezing at its first render while
		 * the badge above it keeps updating.
		 */
		treeStamp: string | null;
		/** Set when a tree fetch failed, so the 5s refresh does not retry forever. */
		treeError: boolean;
		totalSteps: number;
		completedSteps: number;
		rejectedSteps: number;
		pendingSteps: number;
		subtreeStatus: SubtreeStatus;
	}

	const PAGE_SIZE = 20;
	/** Cap on concurrent tree fetches, so one page of cards is not one burst. */
	const TREE_CONCURRENCY = 4;

	let workflows: WorkflowItem[] = $state([]);
	let error = $state<ApiError | null>(null);
	let loading = $state(false);
	let cursor: string | undefined = $state(undefined);
	let hasMore = $state(false);
	let pagesLoaded = $state(1);

	let stateFilter = $state<PromiseState | ''>('');
	/** When the cards were last loaded successfully, for the stale notice. */
	let loadedAt = $state<number | null>(null);
	/**
	 * The filter the cards on screen actually satisfy, which is not
	 * `stateFilter` once a filter change has failed to load.
	 */
	let appliedFilter = $state<PromiseState | ''>('');

	/** Cards held from an earlier load, with the current one having failed. */
	const stale = $derived(error !== null && workflows.length > 0 && loadedAt !== null);
	const staleWhat = $derived(
		appliedFilter !== stateFilter
			? `workflows for ${appliedFilter ? `state “${appliedFilter}”` : 'all states'}, not the filter selected above,`
			: 'these workflows'
	);

	/** A root promise changes identity for tree purposes when it settles. */
	const stampOf = (p: PromiseRecord) => `${p.state}:${p.settledAt ?? ''}`;

	async function loadWorkflows(append = false, isRefresh = false) {
		if (!isRefresh) loading = true;
		try {
			const pagesToFetch = isRefresh ? pagesLoaded : 1;
			const allRoots: PromiseRecord[] = [];
			let tempCursor: string | undefined = append ? cursor : undefined;
			let lastCursor: string | undefined;

			for (let i = 0; i < pagesToFetch; i++) {
				const result = await searchPromises({
					state: stateFilter || undefined,
					limit: PAGE_SIZE,
					cursor: tempCursor
				});
				allRoots.push(...result.promises);
				lastCursor = result.cursor;
				tempCursor = result.cursor;
				if (!result.cursor) break;
			}

			const roots = allRoots.filter((p) => isRootInSet(p, allRoots));
			const existingWorkflows = new Map(workflows.map((w) => [w.promise.id, w]));

			const newItems: WorkflowItem[] = roots.map((p) => {
				const existing = existingWorkflows.get(p.id);
				return {
					promise: p,
					tree: existing?.tree ?? null,
					loading: existing?.loading ?? false,
					treeStamp: existing?.treeStamp ?? null,
					treeError: existing?.treeError ?? false,
					totalSteps: existing?.totalSteps ?? 0,
					completedSteps: existing?.completedSteps ?? 0,
					rejectedSteps: existing?.rejectedSteps ?? 0,
					pendingSteps: existing?.pendingSteps ?? 0,
					subtreeStatus: existing?.subtreeStatus ?? 'pending'
				};
			});

			if (append) {
				workflows = [...workflows, ...newItems];
				pagesLoaded += 1;
			} else {
				workflows = newItems;
				if (!isRefresh) pagesLoaded = 1;
			}

			cursor = lastCursor;
			hasMore = !!lastCursor;
			appliedFilter = stateFilter;
			loadedAt = Date.now();
			error = null;

			void refreshTrees();
		} catch (e) {
			error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
			// Cards are kept and labelled rather than cleared — see StaleNotice.
			// `appliedFilter` keeps what the cards ACTUALLY match, so a filter
			// change that failed to load does not silently relabel them.
		} finally {
			loading = false;
		}
	}

	/**
	 * Fetches the trees that are actually out of date.
	 *
	 * Three things keep this from being the every-card-every-five-seconds
	 * fan-out it used to be: a stamp so unchanged roots are skipped, a sticky
	 * error flag so a tree that cannot be built is not retried forever, and a
	 * concurrency cap so a full page does not open twenty paginated fetches at
	 * once. A pending root still refetches on every tick — that one is the
	 * point of the page.
	 */
	async function refreshTrees() {
		const stale = workflows.filter(
			(item) =>
				!item.loading && !item.treeError && item.treeStamp !== stampOf(item.promise)
		);

		for (let i = 0; i < stale.length; i += TREE_CONCURRENCY) {
			await Promise.all(stale.slice(i, i + TREE_CONCURRENCY).map(loadWorkflowTree));
		}
	}

	async function loadWorkflowTree(item: WorkflowItem) {
		item.loading = true;
		const stamp = stampOf(item.promise);
		try {
			const promises = await fetchTreePromises(item.promise.id, (params) =>
				searchPromises(params)
			);
			const tree = buildTree(item.promise.id, promises);
			if (tree) {
				// Preserve whether the operator had this card expanded.
				tree.expanded = item.tree?.expanded ?? true;
				item.tree = tree;
				item.subtreeStatus = computeSubtreeStatus(tree);
				countSteps(item);
				item.treeStamp = stamp;
			} else {
				item.treeError = true;
			}
		} catch {
			// One card failing to load its graph must not take down the page,
			// but it also must not retry on every refresh.
			item.treeError = true;
		} finally {
			item.loading = false;
		}
	}

	function countSteps(item: WorkflowItem) {
		if (!item.tree) return;
		let total = 0;
		let completed = 0;
		let rejected = 0;
		let pending = 0;
		function walk(n: TreeNode) {
			total++;
			if (n.promise.state === 'resolved') completed++;
			else if (n.promise.state === 'pending') pending++;
			// Rejected, canceled and timed-out all count as "not done" here.
			// The card shows a total; the graph shows which kind.
			else rejected++;
			for (const child of n.children) walk(child);
		}
		walk(item.tree);
		item.totalSteps = total;
		item.completedSteps = completed;
		item.rejectedSteps = rejected;
		item.pendingSteps = pending;
	}

	function changeFilter() {
		cursor = undefined;
		loadWorkflows(false);
	}

	$effect(() => {
		loadWorkflows(false, false);
		const interval = setInterval(() => loadWorkflows(false, true), 5000);
		return () => clearInterval(interval);
	});

	/**
	 * The cards show step counts, and those are computed here from each tree —
	 * the root promise record carries no such field. They travel in `viewState`
	 * beside the raw roots so an assistant is not left trying to derive a number
	 * that is not in the data.
	 */
	function capture() {
		return {
			view: 'Workflows',
			path: '/workflows',
			viewState: {
				stateFilter: stateFilter || null,
				pageSize: PAGE_SIZE,
				pagesLoaded,
				moreAvailable: hasMore,
				stepCounts: workflows.map((w) => ({
					id: w.promise.id,
					totalSteps: w.totalSteps,
					completedSteps: w.completedSteps,
					rejectedSteps: w.rejectedSteps,
					pendingSteps: w.pendingSteps,
					subtreeStatus: w.subtreeStatus,
					treeLoaded: w.tree !== null,
					treeFailed: w.treeError
				}))
			},
			groups: [
				{
					label: 'Workflow root promises',
					kind: 'promise',
					records: workflows.map((w) => w.promise)
				}
			],
			selection: null,
			loadError: error,
			notes: [
				'These are root promises only. The step promises under each one are not in this bundle — open a workflow to capture its tree.',
				'A workflow root is a promise like any other; what makes it a root is that nothing else claims it as a parent.',
				// Same shape as the promises list: on a failed load the filter is not
				// the reason anything is absent, and stale roots from the previous
				// filter survive in `workflows`.
				stateFilter
					? error
						? `\`${stateFilter}\` is the filter selected in the UI, but the request that would have applied it failed. The roots below are whatever the view held before, and they may not match it.`
						: `Filtered to state \`${stateFilter}\`, an exact match — the other four states are absent by request.`
					: 'Unfiltered.',
				'Ordered by promise id. The server offers no sort or time range, so this is not "the most recent".'
			]
		};
	}
</script>

<div class="page-header">
	<h1>Workflows</h1>
	<div class="header-controls">
		<!--
			All five states are listed because the server's filter is an exact
			match: asking for `rejected` does not return canceled or timed-out
			promises. A three-option "Rejected" would silently hide two thirds
			of the failures.
		-->
		<select class="filter-select" bind:value={stateFilter} onchange={changeFilter}>
			<option value="">All states</option>
			{#each PROMISE_STATES as state}
				<option value={state}>{stateLabel(state)}</option>
			{/each}
		</select>
		<AskAi {capture} size="small" />
	</div>
</div>

<p class="order-note muted">
	Ordered by promise ID — the server offers no sort or time range on search.
</p>

{#if error}
	<ErrorPanel {error} />
{/if}

{#if stale && loadedAt !== null}
	<StaleNotice since={loadedAt} what={staleWhat} />
{/if}

{#if loading && workflows.length === 0}
	<div class="loading">Loading workflows...</div>
{:else if workflows.length === 0}
	<div class="empty-state">No workflows found.</div>
{:else}
	<div class="workflow-grid">
		{#each workflows as item}
			<a href="/workflows/{item.promise.id}" class="workflow-card">
				<div class="card-header">
					<Badge state={item.promise.state} />
					<span class="card-id mono">{item.promise.id}</span>
					<span class="card-time muted">
						{new Date(item.promise.createdAt).toLocaleString()}
					</span>
				</div>

				{#if item.tree}
					<div class="card-graph">
						<WorkflowGraph tree={item.tree} interactive={false} />
					</div>
				{:else if item.loading}
					<div class="card-graph-loading">Loading graph...</div>
				{:else if item.treeError}
					<!-- Honest about why: a tree is only discoverable through the
					     resonate:origin tag, and not every promise carries one. -->
					<div class="card-graph-loading">
						No graph — this workflow has no <code>resonate:origin</code> tag.
					</div>
				{:else}
					<div class="card-graph-loading">No tree data</div>
				{/if}

				<div class="card-footer">
					<div class="step-summary">
						<span class="step-count">{item.totalSteps} steps</span>
						{#if item.completedSteps > 0}
							<span class="step-detail resolved">{item.completedSteps} done</span>
						{/if}
						{#if item.pendingSteps > 0}
							<span class="step-detail pending">{item.pendingSteps} pending</span>
						{/if}
						{#if item.rejectedSteps > 0}
							<span class="step-detail rejected">{item.rejectedSteps} failed</span>
						{/if}
					</div>
					{#if computeDuration(item.promise) != null}
						<span class="card-duration mono">{formatDuration(computeDuration(item.promise)!)}</span>
					{/if}
				</div>

				<div
					class="status-bar"
					style="background: {subtreeColor(item.subtreeStatus)}"
				></div>
			</a>
		{/each}
	</div>

	{#if hasMore}
		<div class="load-more">
			<button class="btn" onclick={() => loadWorkflows(true)} disabled={loading}>
				{loading ? 'Loading...' : 'Load More'}
			</button>
		</div>
	{/if}
{/if}

<style>
	.order-note {
		margin: -0.5rem 0 1rem;
		font-size: 0.8125rem;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}

	.header-controls {
		display: flex;
		gap: 0.5rem;
	}

	.filter-select {
		padding: 0.5rem 0.75rem;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.filter-select:focus {
		outline: none;
		border-color: var(--secondary);
	}

	.workflow-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
		gap: 1rem;
	}

	.workflow-card {
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		text-decoration: none;
		color: var(--text);
		transition: border-color 0.2s, box-shadow 0.2s;
		position: relative;
	}

	.workflow-card:hover {
		border-color: var(--secondary);
		box-shadow: 0 0 0 1px var(--secondary-bg-soft);
		text-decoration: none;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.875rem 1rem;
		border-bottom: 1px solid var(--border);
	}

	.card-id {
		flex: 1;
		font-size: 0.8125rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-time {
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.card-graph {
		height: 160px;
		overflow: hidden;
	}

	.card-graph-loading {
		height: 160px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		font-size: 0.8125rem;
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 1rem;
		border-top: 1px solid var(--border);
	}

	.step-summary {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.step-count {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.step-detail {
		font-size: 0.75rem;
		font-weight: 500;
	}

	.step-detail.resolved {
		color: var(--status-resolved-fg);
	}

	.step-detail.pending {
		color: var(--status-pending-fg);
	}

	.step-detail.rejected {
		color: var(--status-rejected-fg);
	}

	.card-duration {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.status-bar {
		height: 3px;
		width: 100%;
	}

	.load-more {
		margin-top: 1.5rem;
		text-align: center;
	}
</style>
