<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { NodeProps } from '@xyflow/svelte';
	import type { GraphNodeData } from '$lib/utils/tree';
	import { formatDuration } from '$lib/utils/tree';

	interface Props extends NodeProps {
		data: GraphNodeData;
	}

	let { data, id }: Props = $props();

	function stateColor(state: string): string {
		switch (state) {
			case 'RESOLVED':
				return 'var(--green)';
			case 'PENDING':
				return 'var(--yellow)';
			case 'REJECTED':
			case 'REJECTED_CANCELED':
			case 'REJECTED_TIMEDOUT':
				return 'var(--red)';
			default:
				return 'var(--muted)';
		}
	}

	function subtreeColor(status: string): string {
		switch (status) {
			case 'resolved':
				return 'var(--green)';
			case 'pending':
				return 'var(--yellow)';
			case 'rejected':
				return 'var(--red)';
			default:
				return 'var(--muted)';
		}
	}

	function stateLabel(state: string): string {
		switch (state) {
			case 'REJECTED_CANCELED':
				return 'CANCELED';
			case 'REJECTED_TIMEDOUT':
				return 'TIMEDOUT';
			default:
				return state;
		}
	}

	let borderColor = $derived(stateColor(data.promise.state));
	let isPending = $derived(data.promise.state === 'PENDING');
</script>

<div class="promise-node" style="border-left-color: {borderColor}" class:pending={isPending}>
	<Handle type="target" position={Position.Top} />

	<div class="node-header">
		<span class="node-label" title={id}>{data.label}</span>
		{#if data.role !== 'root'}
			<span class="node-type type-{data.role}">{data.role}</span>
		{/if}
	</div>

	{#if data.functionName && data.role !== 'sleep'}
		<div class="node-function">
			<span class="function-name" title={data.functionName}>{data.functionName}</span>
		</div>
	{/if}

	{#if data.role === 'sleep' && data.sleepDuration != null}
		<div class="node-function">
			<span class="sleep-duration">sleeping {formatDuration(data.sleepDuration)}</span>
		</div>
	{/if}

	<div class="node-body">
		<span class="node-state" style="color: {borderColor}">{stateLabel(data.promise.state)}</span>
		{#if data.duration != null}
			<span class="node-duration">{formatDuration(data.duration)}</span>
		{/if}
	</div>

	{#if data.childCount > 0 && data.subtreeStatus !== 'resolved'}
		<div class="subtree-indicator" style="background: {subtreeColor(data.subtreeStatus)}"></div>
	{/if}

	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.promise-node {
		background: var(--node-bg, #1a1d24);
		border: 1px solid var(--node-border, #2a2d3a);
		border-left: 3px solid var(--muted);
		border-radius: 6px;
		padding: 0.625rem 0.75rem;
		min-width: 180px;
		max-width: 220px;
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
		position: relative;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.promise-node:hover {
		border-color: var(--secondary, #1ee3cf);
		box-shadow: 0 0 0 1px var(--secondary, #1ee3cf);
	}

	.promise-node.pending {
		animation: pulse-border 2s ease-in-out infinite;
	}

	@keyframes pulse-border {
		0%,
		100% {
			box-shadow: none;
		}
		50% {
			box-shadow: 0 0 8px rgba(234, 179, 8, 0.3);
		}
	}

	.node-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-bottom: 0.375rem;
	}

	.node-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text, #e4e7eb);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.node-type {
		font-size: 0.625rem;
		padding: 0.0625rem 0.3125rem;
		border-radius: 3px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		flex-shrink: 0;
	}

	.type-rpc {
		background: rgba(30, 227, 207, 0.12);
		color: var(--secondary, #1ee3cf);
	}

	.type-run {
		background: rgba(168, 85, 247, 0.12);
		color: #a855f7;
	}

	.type-sleep {
		background: rgba(148, 163, 184, 0.12);
		color: var(--muted, #94a3b8);
	}

	.node-function {
		margin-bottom: 0.375rem;
		padding: 0.25rem 0.375rem;
		background: var(--bg-surface-hover, rgba(255, 255, 255, 0.03));
		border-radius: 4px;
		font-size: 0.6875rem;
	}

	.function-name {
		color: var(--secondary, #1ee3cf);
		font-weight: 500;
		font-family: 'SF Mono', 'Fira Code', monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
	}

	.sleep-duration {
		color: var(--muted, #94a3b8);
		font-style: italic;
		font-size: 0.6875rem;
	}

	.node-body {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.node-state {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.node-duration {
		font-size: 0.6875rem;
		color: var(--text-muted, #94a3b8);
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.subtree-indicator {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}
</style>
