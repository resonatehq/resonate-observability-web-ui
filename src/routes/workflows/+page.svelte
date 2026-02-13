<script lang="ts">
	import { searchPromisesWithCursor, type Promise } from '$lib/api/client';
	import {
		buildTree,
		fetchTreePromises,
		isRootInSet,
		promiseRole,
		computeSubtreeStatus,
		computeDuration,
		formatDuration,
		type TreeNode,
		type SubtreeStatus
	} from '$lib/utils/tree';
	import WorkflowGraph from '$lib/components/graph/WorkflowGraph.svelte';
	import Badge from '$lib/components/Badge.svelte';

	interface WorkflowItem {
		promise: Promise;
		tree: TreeNode | null;
		loading: boolean;
		totalSteps: number;
		completedSteps: number;
		rejectedSteps: number;
		pendingSteps: number;
		subtreeStatus: SubtreeStatus;
	}

	let workflows: WorkflowItem[] = $state([]);
	let error: string | null = $state(null);
	let loading = $state(false);
	let cursor: string | undefined = $state(undefined);
	let hasMore = $state(false);
	let targetLoadCount = $state(20); // Track how many items we want to keep loaded

	// Filters
	let stateFilter = $state('');
	let sortMode = $state<'created-desc' | 'created-asc'>('created-desc');

	async function loadWorkflows(append = false, isRefresh = false) {
		// Only show loading spinner on initial load, not on refresh
		if (!isRefresh) {
			loading = true;
		}
		try {
			// On refresh, fetch enough items to match current count
			const itemsToFetch = isRefresh ? targetLoadCount : 20;

			const result = await searchPromisesWithCursor({
				id: '*',
				state: stateFilter || undefined,
				limit: itemsToFetch,
				cursor: append ? cursor : undefined,
				sortId: sortMode === 'created-desc' ? -1 : 1
			});

			const roots = result.promises.filter((p) => isRootInSet(p, result.promises));

			// On refresh, preserve existing tree data and expanded state
			const existingWorkflows = new Map(workflows.map((w) => [w.promise.id, w]));

			const newItems: WorkflowItem[] = roots.map((p) => {
				const existing = existingWorkflows.get(p.id);
				return {
					promise: p,
					tree: existing?.tree ?? null,
					loading: existing?.loading ?? false,
					totalSteps: existing?.totalSteps ?? 0,
					completedSteps: existing?.completedSteps ?? 0,
					rejectedSteps: existing?.rejectedSteps ?? 0,
					pendingSteps: existing?.pendingSteps ?? 0,
					subtreeStatus: existing?.subtreeStatus ?? ('pending' as SubtreeStatus)
				};
			});

			if (append) {
				workflows = [...workflows, ...newItems];
				targetLoadCount = workflows.length; // Update target count when loading more
			} else {
				workflows = newItems;
				if (!isRefresh) {
					targetLoadCount = 20; // Reset on filter change
				}
			}

			cursor = result.cursor;
			hasMore = !!result.cursor;
			error = null;

			// Lazy-load trees for visible workflows
			for (const item of workflows) {
				if (!item.tree && !item.loading) {
					loadWorkflowTree(item);
				}
			}
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function loadWorkflowTree(item: WorkflowItem) {
		item.loading = true;
		try {
			const promises = await fetchTreePromises(item.promise.id, async (params) =>
				searchPromisesWithCursor({ ...params, id: params.id || '*' })
			);
			item.tree = buildTree(item.promise.id, promises);
			if (item.tree) {
				item.tree.expanded = true;
				item.subtreeStatus = computeSubtreeStatus(item.tree);
				countSteps(item);
			}
		} catch {
			// Silently fail for individual tree loads
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
			if (n.promise.state === 'RESOLVED') completed++;
			else if (n.promise.state === 'PENDING') pending++;
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

	function statusBarColor(status: SubtreeStatus): string {
		switch (status) {
			case 'resolved':
				return 'var(--green)';
			case 'pending':
				return 'var(--yellow)';
			case 'rejected':
				return 'var(--red)';
		}
	}

	$effect(() => {
		loadWorkflows(false, false); // Initial load
		const interval = setInterval(() => loadWorkflows(false, true), 5000); // Background refresh
		return () => clearInterval(interval);
	});
</script>

<div class="page-header">
	<h1>Workflows</h1>
	<div class="header-controls">
		<select class="filter-select" bind:value={stateFilter} onchange={changeFilter}>
			<option value="">All States</option>
			<option value="pending">Pending</option>
			<option value="resolved">Resolved</option>
			<option value="rejected">Rejected</option>
		</select>
		<select class="filter-select" bind:value={sortMode} onchange={changeFilter}>
			<option value="created-desc">Newest First</option>
			<option value="created-asc">Oldest First</option>
		</select>
	</div>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
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
						{#if item.promise.createdOn}
							{new Date(item.promise.createdOn).toLocaleString()}
						{/if}
					</span>
				</div>

				{#if item.tree}
					<div class="card-graph">
						<WorkflowGraph tree={item.tree} interactive={false} />
					</div>
				{:else if item.loading}
					<div class="card-graph-loading">Loading graph...</div>
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
					style="background: {statusBarColor(item.subtreeStatus)}"
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
		box-shadow: 0 0 0 1px rgba(30, 227, 207, 0.1);
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
		color: var(--green);
	}

	.step-detail.pending {
		color: var(--yellow);
	}

	.step-detail.rejected {
		color: var(--red);
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
