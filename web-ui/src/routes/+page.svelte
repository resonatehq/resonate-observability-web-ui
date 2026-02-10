<script lang="ts">
	import { searchPromisesWithCursor, type Promise } from '$lib/api/client';
	import { buildTree, fetchTreePromises, isRoot, promiseRole, type TreeNode } from '$lib/utils/tree';
	import Tree from '$lib/components/Tree.svelte';
	import Badge from '$lib/components/Badge.svelte';

	interface RootItem {
		promise: Promise;
		tree: TreeNode | null;
		loading: boolean;
		expanded: boolean;
	}

	let roots: RootItem[] = $state([]);
	let error: string | null = $state(null);
	let loading = $state(false);
	let cursor: string | undefined = $state(undefined);
	let hasMore = $state(false);

	// Filters
	let stateFilter = $state('');
	let typeFilter = $state('');
	let sortMode = $state<'created-desc' | 'created-asc' | 'resolved-desc' | 'resolved-asc'>(
		'created-desc'
	);

	async function loadRoots(append = false) {
		loading = true;
		try {
			const result = await searchPromisesWithCursor({
				id: '*',
				state: stateFilter || undefined,
				limit: 20,
				cursor: append ? cursor : undefined,
				sortId: sortMode.includes('desc') ? -1 : 1
			});

			// Filter to roots (client-side)
			let filteredRoots = result.promises.filter((p) => {
				const role = promiseRole(p);
				if (typeFilter && role !== typeFilter) return false;
				if (!typeFilter && !isRoot(p)) return false;
				return true;
			});

			const newRoots = filteredRoots.map((p) => ({
				promise: p,
				tree: null,
				loading: false,
				expanded: false
			}));

			if (append) {
				roots = [...roots, ...newRoots];
			} else {
				roots = newRoots;
			}

			cursor = result.cursor;
			hasMore = !!result.cursor;
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function toggleRoot(root: RootItem) {
		if (root.expanded) {
			root.expanded = false;
		} else {
			root.expanded = true;
			if (!root.tree && !root.loading) {
				root.loading = true;
				try {
					const promises = await fetchTreePromises(root.promise.id, async (tags, c) =>
						searchPromisesWithCursor({ id: '*', tags, cursor: c, limit: 100 })
					);
					root.tree = buildTree(root.promise.id, promises);
					root.tree.expanded = true; // Expand root node by default
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
				} finally {
					root.loading = false;
				}
			}
		}
	}

	function expandAll() {
		for (const root of roots) {
			if (!root.expanded) {
				toggleRoot(root);
			}
		}
	}

	function collapseAll() {
		for (const root of roots) {
			root.expanded = false;
		}
	}

	function changeFilter() {
		cursor = undefined;
		loadRoots(false);
	}

	$effect(() => {
		loadRoots();
		const interval = setInterval(() => loadRoots(), 5000);
		return () => clearInterval(interval);
	});

	function getSortLabel(mode: typeof sortMode): string {
		switch (mode) {
			case 'created-desc':
				return 'Created ↓';
			case 'created-asc':
				return 'Created ↑';
			case 'resolved-desc':
				return 'Resolved ↓';
			case 'resolved-asc':
				return 'Resolved ↑';
		}
	}
</script>

<div class="page-header">
	<h1>Call Graphs</h1>
	<div class="header-actions">
		<button class="btn btn-sm" onclick={expandAll}>Expand All</button>
		<button class="btn btn-sm" onclick={collapseAll}>Collapse All</button>
	</div>
</div>

<div class="controls">
	<div class="filters">
		<select class="filter-select" bind:value={stateFilter} onchange={changeFilter}>
			<option value="">All States</option>
			<option value="pending">Pending</option>
			<option value="resolved">Resolved</option>
			<option value="rejected">Rejected</option>
		</select>

		<select class="filter-select" bind:value={typeFilter} onchange={changeFilter}>
			<option value="">Roots Only</option>
			<option value="root">Root</option>
			<option value="rpc">RPC</option>
			<option value="run">Run</option>
			<option value="sleep">Sleep</option>
		</select>

		<select class="filter-select" bind:value={sortMode} onchange={changeFilter}>
			<option value="created-desc">{getSortLabel('created-desc')}</option>
			<option value="created-asc">{getSortLabel('created-asc')}</option>
			<option value="resolved-desc">{getSortLabel('resolved-desc')}</option>
			<option value="resolved-asc">{getSortLabel('resolved-asc')}</option>
		</select>
	</div>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

{#if loading && roots.length === 0}
	<div class="loading">Loading roots...</div>
{:else if roots.length === 0}
	<div class="empty-state">No root promises found.</div>
{:else}
	<div class="forest-container">
		{#each roots as root}
			<div class="root-item">
				<div class="root-header" role="button" tabindex="0" onclick={() => toggleRoot(root)}>
					<span class="expand-icon">{root.expanded ? '▼' : '▶'}</span>
					<Badge state={root.promise.state} />
					<span class="mono root-id">{root.promise.id}</span>
					<span class="root-meta">
						{#if root.promise.createdOn}
							{new Date(root.promise.createdOn).toLocaleString()}
						{/if}
					</span>
					<a
						href="/promises/{root.promise.id}"
						class="btn btn-sm"
						onclick={(e) => e.stopPropagation()}>Details</a
					>
				</div>

				{#if root.expanded}
					<div class="tree-content">
						{#if root.loading}
							<div class="loading-tree">Loading tree...</div>
						{:else if root.tree}
							{#each root.tree.children as child}
								<Tree node={child} depth={1} />
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if hasMore}
		<div class="load-more">
			<button class="btn" onclick={() => loadRoots(true)} disabled={loading}>
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

	.header-actions {
		display: flex;
		gap: 0.5rem;
	}

	.controls {
		margin-bottom: 1.5rem;
	}

	.filters {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.filter-select {
		padding: 0.5rem 0.75rem;
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		font-size: 0.875rem;
		cursor: pointer;
		transition: border-color 0.2s;
	}

	.filter-select:focus {
		outline: none;
		border-color: var(--secondary);
	}

	.filter-select:hover {
		border-color: var(--secondary);
	}

	.forest-container {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.root-item {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.root-item:hover {
		border-color: var(--secondary);
	}

	.root-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.root-header:hover {
		background: var(--bg-surface-hover);
	}

	.expand-icon {
		color: var(--text-muted);
		font-size: 0.875rem;
		width: 1.25rem;
		display: inline-block;
	}

	.root-id {
		flex: 1;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.root-meta {
		color: var(--text-muted);
		font-size: 0.8125rem;
	}

	.tree-content {
		padding: 0 1rem 1rem 1rem;
		border-top: 1px solid var(--border);
	}

	.loading-tree {
		padding: 1rem 0;
		color: var(--text-muted);
		text-align: center;
	}

	.load-more {
		margin-top: 1.5rem;
		text-align: center;
	}

	.empty-state {
		padding: 3rem;
		text-align: center;
		color: var(--text-muted);
	}
</style>
