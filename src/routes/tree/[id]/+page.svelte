<script lang="ts">
	import { page } from '$app/state';
	import { searchPromisesWithCursor } from '$lib/api/client';
	import { buildTree, fetchTreePromises, type TreeNode } from '$lib/utils/tree';
	import Tree from '$lib/components/Tree.svelte';
	import Badge from '$lib/components/Badge.svelte';

	let root: TreeNode | null = $state(null);
	let error: string | null = $state(null);
	let loading = $state(true);

	async function loadTree(rootId: string) {
		loading = true;
		try {
			const promises = await fetchTreePromises(rootId, async (tags, cursor) =>
				searchPromisesWithCursor({ id: '*', tags, cursor, limit: 100 })
			);
			root = buildTree(rootId, promises);
			if (root) {
				root.expanded = true; // Expand root by default
			}
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const id = page.params.id!;
		loadTree(id);
	});
</script>

<div class="page-header">
	<h1>Call Tree: <span class="mono">{page.params.id}</span></h1>
	<a href="/promises/{page.params.id}" class="btn">Promise Details</a>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

{#if loading}
	<div class="loading">Loading tree...</div>
{:else if root}
	<div class="tree-container">
		<div class="root-node">
			<Badge state={root.promise.state} />
			<a href="/promises/{root.promise.id}" class="mono root-id">{root.promise.id}</a>
		</div>
		{#each root.children as child}
			<Tree node={child} depth={1} />
		{/each}
	</div>
{/if}

<style>
	.tree-container {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.5rem;
		min-height: 200px;
	}

	.root-node {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0 1rem 0;
		margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	.root-id {
		font-size: 1rem;
		font-weight: 600;
	}
</style>
