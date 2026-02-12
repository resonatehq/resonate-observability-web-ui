<script lang="ts">
	import Badge from './Badge.svelte';
	import type { TreeNode } from '$lib/utils/tree';
	import { promiseRole } from '$lib/utils/tree';

	interface Props {
		node: TreeNode;
		depth?: number;
		onToggle?: (node: TreeNode) => void;
	}

	let { node, depth = 0, onToggle }: Props = $props();

	function toggle() {
		node.expanded = !node.expanded;
		onToggle?.(node);
	}

	function getRoleBadge(role: string): string {
		switch (role) {
			case 'root':
				return 'root';
			case 'rpc':
				return 'rpc';
			case 'run':
				return 'run';
			case 'sleep':
				return 'sleep';
			default:
				return '';
		}
	}

	let role = $derived(promiseRole(node.promise));
</script>

<div class="tree-node" style="padding-left: {depth * 1.5}rem">
	<div class="tree-node-header">
		{#if node.children.length > 0}
			<button class="expand-btn" onclick={toggle}>
				{node.expanded ? '▼' : '▶'}
			</button>
		{:else}
			<span class="expand-spacer"></span>
		{/if}
		<Badge state={node.promise.state} />
		{#if role}
			<span class="role-badge role-{role}">{getRoleBadge(role)}</span>
		{/if}
		<a href="/promises/{node.promise.id}" class="mono promise-id">{node.promise.id}</a>
	</div>
</div>

{#if node.expanded}
	{#each node.children as child}
		<svelte:self node={child} depth={depth + 1} {onToggle} />
	{/each}
{/if}

<style>
	.tree-node {
		margin-bottom: 0.25rem;
	}

	.tree-node-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0;
		transition: background 0.15s;
	}

	.tree-node-header:hover {
		background: var(--bg-surface-hover);
		border-radius: 4px;
	}

	.expand-btn {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0;
		width: 1.25rem;
		height: 1.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		transition: color 0.2s;
	}

	.expand-btn:hover {
		color: var(--secondary);
	}

	.expand-spacer {
		width: 1.25rem;
	}

	.promise-id {
		font-size: 0.875rem;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.role-badge {
		font-size: 0.7rem;
		padding: 0.125rem 0.375rem;
		border-radius: 3px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.role-root {
		background: rgba(30, 227, 207, 0.15);
		color: var(--secondary);
	}

	.role-rpc {
		background: rgba(30, 227, 207, 0.1);
		color: var(--secondary);
	}

	.role-run {
		background: rgba(168, 85, 247, 0.1);
		color: #a855f7;
	}

	.role-sleep {
		background: rgba(148, 163, 184, 0.1);
		color: var(--muted);
	}
</style>
