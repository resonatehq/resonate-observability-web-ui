<script lang="ts">
	import type { Promise } from '$lib/api/client';
	import { formatDuration } from '$lib/utils/tree';

	interface Props {
		workflows: Promise[];
	}

	let { workflows }: Props = $props();

	function getRunningTime(p: Promise): number {
		if (!p.createdOn) return 0;
		return Date.now() - p.createdOn;
	}

	function getLabel(p: Promise): string {
		return p.tags?.['resonate:invoke'] || p.id;
	}
</script>

<div class="workflows-container">
	{#if workflows.length === 0}
		<div class="empty-state">No active workflows</div>
	{:else}
		<div class="workflows-list">
			{#each workflows as workflow}
				<a href="/workflows/{workflow.id}" class="workflow-item">
					<div class="workflow-header">
						<span class="workflow-label" title={workflow.id}>{getLabel(workflow)}</span>
						<span class="workflow-duration">{formatDuration(getRunningTime(workflow))}</span>
					</div>
					<div class="workflow-id mono">{workflow.id}</div>
					<div class="workflow-progress">
						<div class="progress-bar pending"></div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.workflows-container {
		width: 100%;
	}

	.workflows-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.workflow-item {
		display: block;
		padding: 0.75rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		text-decoration: none;
		transition: all 0.2s;
	}

	.workflow-item:hover {
		border-color: var(--secondary);
		background: var(--bg-surface-hover);
	}

	.workflow-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.375rem;
	}

	.workflow-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 70%;
	}

	.workflow-duration {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.workflow-id {
		font-size: 0.6875rem;
		color: var(--text-muted);
		margin-bottom: 0.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.workflow-progress {
		width: 100%;
		height: 3px;
		background: var(--border);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		width: 100%;
	}

	.progress-bar.pending {
		background: var(--yellow);
		animation: pulse-glow 2s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%,
		100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}

	.empty-state {
		padding: 2rem;
		text-align: center;
		color: var(--text-muted);
		font-size: 0.875rem;
	}
</style>
