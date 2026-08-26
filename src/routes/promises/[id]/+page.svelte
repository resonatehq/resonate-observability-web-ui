<script lang="ts">
	import { page } from '$app/state';
	import { getPromise, decodeValue, ApiError, type PromiseValue } from '$lib/api/client';
	import { formatDuration } from '$lib/utils/tree';
	import Badge from '$lib/components/Badge.svelte';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';
	import AskAi from '$lib/components/AskAi.svelte';
	import type { PromiseRecord } from '$lib/api/client';

	let promise = $state<PromiseRecord | null>(null);
	let error = $state<ApiError | null>(null);
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
				error = e instanceof ApiError ? e : new ApiError('unknown', String(e), null);
			})
			.finally(() => {
				loading = false;
			});
	});

	/**
	 * Payloads arrive base64-encoded. This page used to hand the raw encoded
	 * string straight to `JSON.parse`, which always threw, so it fell through
	 * to rendering the base64 at the user — while the workflow view, using its
	 * own copy of this logic, decoded correctly. Both now go through the one
	 * decoder in the API client.
	 */
	function formatData(
		value: PromiseValue | undefined
	): { formatted: string; hasTarget: boolean; target?: string } {
		const decoded = decodeValue(value);
		if (decoded === null) return { formatted: '', hasTarget: false };

		try {
			const parsed = JSON.parse(decoded);
			if (parsed && typeof parsed === 'object' && 'target' in parsed) {
				return {
					formatted: JSON.stringify(parsed, null, 2),
					hasTarget: true,
					target: parsed.target
				};
			}
			// Still JSON, just without a target — pretty-print it rather than
			// showing one long line.
			return { formatted: JSON.stringify(parsed, null, 2), hasTarget: false };
		} catch {
			// Decoded fine but is not JSON; show the decoded text.
		}

		return { formatted: decoded, hasTarget: false };
	}

	function capture() {
		return {
			view: 'Promise detail',
			path: `/promises/${page.params.id}`,
			viewState: { promiseId: page.params.id },
			groups: [
				{ label: 'The promise', kind: 'promise', records: promise ? [promise] : [] }
			],
			selection: null,
			loadError: error,
			notes: [
				error
					? 'This view fetches one promise by id, and that fetch failed — see the failure named at the top. The empty record list follows from that failure; read its kind before concluding anything about whether this id exists. Its parent and children are never loaded by this view.'
					: 'One promise, fetched by id. Its parent and children are not here — this view does not load them.'
			]
		};
	}
</script>

<div class="page-header">
	<h1>Promise: <span class="mono">{page.params.id}</span></h1>
	<AskAi {capture} />
	<a href="/promises" class="btn">Back to List</a>
</div>

{#if error}
	<ErrorPanel {error} while="loading this promise" />
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
				<dt>Created</dt>
				<dd class="mono">{new Date(promise.createdAt).toLocaleString()}</dd>
				<dt>Times out</dt>
				<dd class="mono">{new Date(promise.timeoutAt).toLocaleString()}</dd>
				{#if promise.settledAt != null}
					<dt>Settled</dt>
					<dd class="mono">{new Date(promise.settledAt).toLocaleString()}</dd>
					<dt>Duration</dt>
					<dd class="mono">{formatDuration(promise.settledAt - promise.createdAt)}</dd>
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
							<dd class="mono">{k === 'target' ? `target: ${v}` : v}</dd>
						{/each}
					</dl>
				{/if}
				{#if promise.param.data}
					{@const formatted = formatData(promise.param)}
					{#if formatted.hasTarget && formatted.target}
						<h4>Target</h4>
						<div class="target-value mono">target: {formatted.target}</div>
					{/if}
					<h4>Data</h4>
					<pre class="code-block">{formatted.formatted}</pre>
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
							<dd class="mono">{k === 'target' ? `target: ${v}` : v}</dd>
						{/each}
					</dl>
				{/if}
				{#if promise.value.data}
					{@const formatted = formatData(promise.value)}
					{#if formatted.hasTarget && formatted.target}
						<h4>Target</h4>
						<div class="target-value mono">target: {formatted.target}</div>
					{/if}
					<h4>Data</h4>
					<pre class="code-block">{formatted.formatted}</pre>
				{/if}
			</div>
		{/if}
	</div>

	<div style="margin-top: 2rem;">
		<a href="/workflows/{promise.id}" class="btn btn-primary">View Call Tree</a>
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
