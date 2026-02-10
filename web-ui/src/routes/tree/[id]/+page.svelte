<script lang="ts">
	import { page } from '$app/state';
	import { getPromise, searchPromises } from '$lib/api/client';
	import Badge from '$lib/components/Badge.svelte';
	import type { Promise } from '$lib/api/client';

	interface TreeNode {
		promise: Promise;
		children: TreeNode[];
	}

	let root: TreeNode | null = $state(null);
	let error: string | null = $state(null);
	let loading = $state(true);

	async function buildTree(rootId: string): globalThis.Promise<TreeNode> {
		const promise = await getPromise(rootId);
		const node: TreeNode = { promise, children: [] };

		// Search for child promises that reference this promise as parent
		try {
			const children = await searchPromises(`${rootId}.*`, '', 100);
			for (const child of children) {
				if (child.id !== rootId) {
					node.children.push({ promise: child, children: [] });
				}
			}
		} catch {
			// No children found, that's fine
		}

		return node;
	}

	$effect(() => {
		const id = page.params.id!;
		loading = true;
		buildTree(id)
			.then((tree) => {
				root = tree;
				error = null;
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

{#snippet treeNode(node: TreeNode, depth: number)}
	<div class="tree-node" style="padding-left: {depth * 1.5}rem">
		<div class="tree-node-header">
			<Badge state={node.promise.state} />
			<a href="/promises/{node.promise.id}" class="mono">{node.promise.id}</a>
		</div>
		{#if node.promise.tags && Object.keys(node.promise.tags).length > 0}
			<div class="tree-node-meta">
				{#each Object.entries(node.promise.tags) as [k, v]}
					<span class="tag">{k}={v}</span>
				{/each}
			</div>
		{/if}
	</div>
	{#each node.children as child}
		{@render treeNode(child, depth + 1)}
	{/each}
{/snippet}

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
		{@render treeNode(root, 0)}
	</div>
	<p class="muted" style="margin-top: 1rem;">
		Tree depth is limited to direct children. Full recursive traversal will be
		added when the Resonate API exposes parent-child promise relationships.
	</p>
{/if}

<style>
	.tree-container {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.5rem;
		min-height: 200px;
	}

	.tree-node {
		margin-bottom: 0.5rem;
	}

	.tree-node-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.tree-node-meta {
		padding-left: 1rem;
		margin-top: 0.25rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
</style>
