<script lang="ts">
	import { page } from '$app/state';
	import { getPromise } from '$lib/api/client';
	import Badge from '$lib/components/Badge.svelte';
	import type { Promise } from '$lib/api/client';

	let promise: Promise | null = $state(null);
	let error: string | null = $state(null);
	let loading = $state(true);

	$effect(() => {
		const id = page.params.id!;
		loading = true;
		getPromise(id)
			.then((p) => {
				promise = p;
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

<div class="page-header">
	<h1>Promise: <span class="mono">{page.params.id}</span></h1>
	<a href="/promises" class="btn">Back to List</a>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

{#if loading}
	<div class="loading">Loading...</div>
{:else if promise}
	<div class="detail-grid">
		<div class="detail-card">
			<h3>Status</h3>
			<Badge state={promise.state} size="lg" />
		</div>

		<div class="detail-card">
			<h3>Timing</h3>
			<dl>
				<dt>Timeout</dt>
				<dd class="mono">{promise.timeout}</dd>
				<dt>Created</dt>
				<dd class="mono">{promise.createdOn ?? '—'}</dd>
				{#if promise.completedOn}
					<dt>Completed</dt>
					<dd class="mono">{promise.completedOn}</dd>
				{/if}
			</dl>
		</div>

		{#if promise.tags && Object.keys(promise.tags).length > 0}
			<div class="detail-card">
				<h3>Tags</h3>
				<div class="tag-list">
					{#each Object.entries(promise.tags) as [k, v]}
						<span class="tag">{k} = {v}</span>
					{/each}
				</div>
			</div>
		{/if}

		{#if promise.param}
			<div class="detail-card full-width">
				<h3>Parameters</h3>
				{#if promise.param.headers}
					<h4>Headers</h4>
					<dl>
						{#each Object.entries(promise.param.headers) as [k, v]}
							<dt>{k}</dt>
							<dd class="mono">{v}</dd>
						{/each}
					</dl>
				{/if}
				{#if promise.param.data}
					<h4>Data</h4>
					<pre class="code-block">{promise.param.data}</pre>
				{/if}
			</div>
		{/if}

		{#if promise.value}
			<div class="detail-card full-width">
				<h3>Value</h3>
				{#if promise.value.headers}
					<h4>Headers</h4>
					<dl>
						{#each Object.entries(promise.value.headers) as [k, v]}
							<dt>{k}</dt>
							<dd class="mono">{v}</dd>
						{/each}
					</dl>
				{/if}
				{#if promise.value.data}
					<h4>Data</h4>
					<pre class="code-block">{promise.value.data}</pre>
				{/if}
			</div>
		{/if}
	</div>

	<div style="margin-top: 2rem;">
		<a href="/tree/{promise.id}" class="btn btn-primary">View Call Tree</a>
	</div>
{/if}

<style>
	.detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
	}

	.detail-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.25rem;
	}

	.detail-card.full-width {
		grid-column: 1 / -1;
	}

	.detail-card h3 {
		font-size: 0.8125rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
	}

	.detail-card h4 {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0.75rem 0 0.375rem;
	}

	.detail-card dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 1rem;
	}

	.detail-card dt {
		color: var(--text-muted);
		font-size: 0.8125rem;
	}

	.detail-card dd {
		font-size: 0.875rem;
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
