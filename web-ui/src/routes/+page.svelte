<script lang="ts">
	import { searchPromises } from '$lib/api/client';
	import MetricCard from '$lib/components/MetricCard.svelte';
	import PromiseTable from '$lib/components/PromiseTable.svelte';
	import type { Promise } from '$lib/api/client';

	let promises: Promise[] = $state([]);
	let error: string | null = $state(null);
	let loading = $state(true);

	let counts = $derived({
		pending: promises.filter((p) => p.state === 'PENDING').length,
		resolved: promises.filter((p) => p.state === 'RESOLVED').length,
		rejected: promises.filter(
			(p) => p.state === 'REJECTED' || p.state === 'REJECTED_CANCELED' || p.state === 'REJECTED_TIMEDOUT'
		).length,
		total: promises.length
	});

	async function load() {
		try {
			promises = await searchPromises('*', '', 100);
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		load();
		const interval = setInterval(load, 5000);
		return () => clearInterval(interval);
	});
</script>

<div class="page-header">
	<h1>Dashboard</h1>
</div>

{#if error}
	<div class="alert alert-error">{error}</div>
{/if}

<div class="metrics-grid">
	<MetricCard label="Total Promises" value={loading ? '...' : counts.total} />
	<MetricCard label="Pending" value={loading ? '...' : counts.pending} />
	<MetricCard label="Resolved" value={loading ? '...' : counts.resolved} />
	<MetricCard label="Rejected" value={loading ? '...' : counts.rejected} />
</div>

<div class="section">
	<div class="section-header">
		<h2>Recent Promises</h2>
		<a href="/promises" class="btn">View All</a>
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else}
		<PromiseTable promises={promises.slice(0, 10)} />
	{/if}
</div>

<style>
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.section {
		margin-bottom: 2rem;
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.section-header h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}
</style>
