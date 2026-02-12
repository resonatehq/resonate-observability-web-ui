<script lang="ts">
	import type { Promise } from '$lib/api/client';
	import Badge from '../Badge.svelte';

	interface Props {
		failures: Promise[];
	}

	let { failures }: Props = $props();

	function getLabel(p: Promise): string {
		return p.tags?.['resonate:invoke'] || p.id;
	}

	function getTimeAgo(timestamp: number | undefined): string {
		if (!timestamp) return 'Unknown';
		const delta = Date.now() - timestamp;
		if (delta < 60_000) return 'Just now';
		if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
		if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
		return `${Math.floor(delta / 86_400_000)}d ago`;
	}
</script>

<div class="errors-container">
	{#if failures.length === 0}
		<div class="empty-state">No recent failures</div>
	{:else}
		<div class="errors-list">
			{#each failures as failure}
				<a href="/promises/{failure.id}" class="error-item">
					<Badge state={failure.state} />
					<div class="error-details">
						<div class="error-label" title={failure.id}>{getLabel(failure)}</div>
						<div class="error-id mono">{failure.id}</div>
					</div>
					<div class="error-time">{getTimeAgo(failure.completedOn)}</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.errors-container {
		width: 100%;
	}

	.errors-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.error-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		text-decoration: none;
		transition: all 0.2s;
	}

	.error-item:hover {
		border-color: var(--red);
		background: var(--bg-surface-hover);
	}

	.error-details {
		flex: 1;
		min-width: 0;
	}

	.error-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		margin-bottom: 0.125rem;
	}

	.error-id {
		font-size: 0.6875rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.error-time {
		font-size: 0.75rem;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.empty-state {
		padding: 2rem;
		text-align: center;
		color: var(--text-muted);
		font-size: 0.875rem;
	}
</style>
