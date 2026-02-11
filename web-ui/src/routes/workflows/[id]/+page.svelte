<script lang="ts">
	import { page } from '$app/state';
	import { searchPromisesWithCursor, getPromise, type Promise } from '$lib/api/client';
	import {
		buildTree,
		fetchTreePromises,
		computeSubtreeStatus,
		computeDuration,
		formatDuration,
		promiseRole,
		promiseLabel,
		type TreeNode,
		type SubtreeStatus
	} from '$lib/utils/tree';
	import WorkflowGraph from '$lib/components/graph/WorkflowGraph.svelte';
	import TimelineView from '$lib/components/timeline/TimelineView.svelte';
	import Badge from '$lib/components/Badge.svelte';

	let root: TreeNode | null = $state(null);
	let error: string | null = $state(null);
	let loading = $state(true);
	let selectedPromise: Promise | null = $state(null);
	let direction: 'TB' | 'LR' = $state('TB');
	let activeTab: 'graph' | 'timeline' | 'list' = $state('graph');
	let totalSteps = $state(0);
	let completedSteps = $state(0);

	async function loadTree(rootId: string, isRefresh = false) {
		// Only show loading spinner on initial load, not on refresh
		if (!isRefresh || !root) {
			loading = true;
		}
		try {
			const promises = await fetchTreePromises(rootId, async (params) =>
				searchPromisesWithCursor({ ...params, id: params.id || '*' })
			);

			// Make sure root promise is included
			if (!promises.find((p) => p.id === rootId)) {
				try {
					const rootPromise = await getPromise(rootId);
					promises.unshift(rootPromise);
				} catch {
					// Root might not exist yet
				}
			}

			root = buildTree(rootId, promises);
			if (root) {
				root.expanded = true;
				countSteps(root);
			}
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function countSteps(node: TreeNode) {
		let total = 0;
		let completed = 0;
		function walk(n: TreeNode) {
			total++;
			if (n.promise.state === 'RESOLVED') completed++;
			for (const child of n.children) walk(child);
		}
		walk(node);
		totalSteps = total;
		completedSteps = completed;
	}

	function handleNodeClick(promiseId: string) {
		if (root) {
			const found = findNode(root, promiseId);
			if (found) {
				selectedPromise = found.promise;
			}
		}
	}

	function findNode(node: TreeNode, id: string): TreeNode | null {
		if (node.promise.id === id) return node;
		for (const child of node.children) {
			const found = findNode(child, id);
			if (found) return found;
		}
		return null;
	}

	function flattenTree(node: TreeNode): TreeNode[] {
		const result: TreeNode[] = [node];
		for (const child of node.children) {
			result.push(...flattenTree(child));
		}
		return result;
	}

	function formatData(data: string | undefined): { formatted: string; hasTarget: boolean; target?: string } {
		if (!data) return { formatted: '', hasTarget: false };

		try {
			const parsed = JSON.parse(data);
			if (parsed && typeof parsed === 'object' && 'target' in parsed) {
				return {
					formatted: JSON.stringify(parsed, null, 2),
					hasTarget: true,
					target: parsed.target
				};
			}
		} catch {
			// Not JSON, return as-is
		}

		return { formatted: data, hasTarget: false };
	}

	let rootStatus = $derived<SubtreeStatus>(root ? computeSubtreeStatus(root) : 'pending');
	let rootDuration = $derived(root ? computeDuration(root.promise) : null);
	let allNodes = $derived<TreeNode[]>(root ? flattenTree(root) : []);

	$effect(() => {
		const id = page.params.id!;
		loadTree(id, false); // Initial load
		const interval = setInterval(() => loadTree(id, true), 5000); // Background refresh
		return () => clearInterval(interval);
	});
</script>

<div class="workflow-page">
	<div class="workflow-header">
		<div class="header-left">
			<a href="/workflows" class="back-link">Workflows</a>
			<span class="header-sep">/</span>
			<h1 class="mono">{page.params.id}</h1>
		</div>
		<div class="header-right">
			{#if root}
				<Badge state={root.promise.state} />
				<span class="step-count">{completedSteps}/{totalSteps} steps</span>
				{#if rootDuration != null}
					<span class="duration">{formatDuration(rootDuration)}</span>
				{/if}
			{/if}
		</div>
	</div>

	{#if error}
		<div class="alert alert-error">{error}</div>
	{/if}

	<div class="tab-bar">
		<button class="tab" class:active={activeTab === 'graph'} onclick={() => (activeTab = 'graph')}>
			Graph
		</button>
		<button
			class="tab"
			class:active={activeTab === 'timeline'}
			onclick={() => (activeTab = 'timeline')}
		>
			Timeline
		</button>
		<button class="tab" class:active={activeTab === 'list'} onclick={() => (activeTab = 'list')}>
			List
		</button>

		{#if activeTab === 'graph'}
			<div class="tab-actions">
				<button
					class="btn btn-sm"
					onclick={() => (direction = direction === 'TB' ? 'LR' : 'TB')}
					title="Toggle layout direction"
				>
					{direction === 'TB' ? 'Top-Down' : 'Left-Right'}
				</button>
			</div>
		{/if}
	</div>

	{#if loading && !root}
		<div class="loading">Loading workflow...</div>
	{:else if root}
		<div class="content-area">
			{#if activeTab === 'graph'}
				<div class="graph-container">
					<WorkflowGraph tree={root} {direction} onNodeClick={handleNodeClick} />
				</div>
			{:else if activeTab === 'timeline'}
				<div class="timeline-container">
					<TimelineView tree={root} onBarClick={handleNodeClick} />
				</div>
			{:else if activeTab === 'list'}
				<div class="list-container">
					<table class="data-table">
						<thead>
							<tr>
								<th>Promise</th>
								<th>State</th>
								<th>Role</th>
								<th>Duration</th>
								<th>Created</th>
							</tr>
						</thead>
						<tbody>
							{#each allNodes as node}
								{@const dur = computeDuration(node.promise)}
								<tr
									class:selected={selectedPromise?.id === node.promise.id}
									onclick={() => (selectedPromise = node.promise)}
								>
									<td class="mono">{promiseLabel(node.promise)}</td>
									<td><Badge state={node.promise.state} /></td>
									<td>
										<span class="role-tag">{promiseRole(node.promise)}</span>
									</td>
									<td class="mono">{dur != null ? formatDuration(dur) : '—'}</td>
									<td class="muted">
										{node.promise.createdOn
											? new Date(node.promise.createdOn).toLocaleTimeString()
											: '—'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		{#if selectedPromise}
			<div class="detail-panel">
				<div class="detail-header">
					<h3>Promise Detail</h3>
					<button class="btn btn-sm" onclick={() => (selectedPromise = null)}>Close</button>
				</div>
				<div class="detail-content">
					<dl class="detail-fields">
						<dt>ID</dt>
						<dd class="mono">{selectedPromise.id}</dd>
						<dt>State</dt>
						<dd><Badge state={selectedPromise.state} /></dd>
						<dt>Role</dt>
						<dd>{promiseRole(selectedPromise)}</dd>
						{#if computeDuration(selectedPromise) != null}
							<dt>Duration</dt>
							<dd class="mono">{formatDuration(computeDuration(selectedPromise)!)}</dd>
						{/if}
						<dt>Timeout</dt>
						<dd class="mono">{selectedPromise.timeout}</dd>
						{#if selectedPromise.createdOn}
							<dt>Created</dt>
							<dd class="mono">{new Date(selectedPromise.createdOn).toLocaleString()}</dd>
						{/if}
						{#if selectedPromise.completedOn}
							<dt>Completed</dt>
							<dd class="mono">{new Date(selectedPromise.completedOn).toLocaleString()}</dd>
						{/if}
					</dl>

					{#if selectedPromise.tags && Object.keys(selectedPromise.tags).length > 0}
						<h4>Tags</h4>
						<div class="tag-list">
							{#each Object.entries(selectedPromise.tags) as [k, v]}
								<span class="tag">{k} = {v}</span>
							{/each}
						</div>
					{/if}

					{#if selectedPromise.param?.data}
						{@const formatted = formatData(selectedPromise.param.data)}
						{#if formatted.hasTarget && formatted.target}
							<h4>Target</h4>
							<div class="target-value mono">target: {formatted.target}</div>
						{/if}
						<h4>Parameters</h4>
						<pre class="code-block">{formatted.formatted}</pre>
					{/if}

					{#if selectedPromise.value?.data}
						{@const formatted = formatData(selectedPromise.value.data)}
						{#if formatted.hasTarget && formatted.target}
							<h4>Target</h4>
							<div class="target-value mono">target: {formatted.target}</div>
						{/if}
						<h4>Value</h4>
						<pre class="code-block">{formatted.formatted}</pre>
					{/if}

					<div class="detail-actions">
						<a href="/promises/{selectedPromise.id}" class="btn btn-sm">Full Details</a>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.workflow-page {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 4rem);
	}

	.workflow-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.back-link {
		font-size: 0.875rem;
		color: var(--text-muted);
	}

	.header-sep {
		color: var(--text-muted);
	}

	.workflow-header h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.step-count {
		font-size: 0.875rem;
		color: var(--text-muted);
	}

	.duration {
		font-size: 0.875rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.tab-bar {
		display: flex;
		align-items: center;
		gap: 0;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0;
		flex-shrink: 0;
	}

	.tab {
		padding: 0.625rem 1.25rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-muted);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: color 0.2s, border-color 0.2s;
	}

	.tab:hover {
		color: var(--text);
	}

	.tab.active {
		color: var(--secondary);
		border-bottom-color: var(--secondary);
	}

	.tab-actions {
		margin-left: auto;
		padding: 0.375rem 0;
	}

	.content-area {
		flex: 1;
		min-height: 0;
		position: relative;
	}

	.graph-container {
		width: 100%;
		height: 100%;
		border: 1px solid var(--border);
		border-top: none;
		border-radius: 0 0 8px 8px;
	}

	.timeline-container,
	.list-container {
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-top: none;
		border-radius: 0 0 8px 8px;
		overflow-y: auto;
		max-height: 100%;
	}

	.role-tag {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	tr.selected td {
		background: var(--bg-surface-hover);
	}

	tr {
		cursor: pointer;
	}

	/* Detail panel */
	.detail-panel {
		flex-shrink: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg-surface);
		margin-top: 1rem;
		max-height: 300px;
		overflow-y: auto;
	}

	.detail-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
	}

	.detail-header h3 {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.detail-content {
		padding: 1rem;
	}

	.detail-fields {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.375rem 1rem;
		margin-bottom: 1rem;
	}

	.detail-fields dt {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.detail-fields dd {
		font-size: 0.875rem;
	}

	.detail-content h4 {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin: 0.75rem 0 0.375rem;
	}

	.detail-content .tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.detail-content .code-block {
		font-size: 0.75rem;
		max-height: 120px;
		overflow-y: auto;
	}

	.detail-actions {
		margin-top: 0.75rem;
	}

	.target-value {
		padding: 0.5rem 0.75rem;
		background: var(--bg);
		border: 1px solid var(--secondary);
		border-radius: 4px;
		font-size: 0.875rem;
		color: var(--secondary);
		margin-bottom: 0.75rem;
	}
</style>
