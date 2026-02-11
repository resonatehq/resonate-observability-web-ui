<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { page } from '$app/state';

	let { children } = $props();

	// Workflow detail pages need full width for the graph
	let isFullWidth = $derived(
		page.url.pathname.startsWith('/workflows/') && page.url.pathname !== '/workflows/'
	);
</script>

<div class="app-layout">
	<Sidebar />
	<main class="content" class:full-width={isFullWidth}>
		{@render children()}
	</main>
</div>

<style>
	.app-layout {
		display: flex;
		min-height: 100vh;
	}

	.content {
		margin-left: var(--sidebar-width);
		flex: 1;
		padding: 2rem;
		max-width: 1200px;
	}

	.content.full-width {
		max-width: none;
	}
</style>
