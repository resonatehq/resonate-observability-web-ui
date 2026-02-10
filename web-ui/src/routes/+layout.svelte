<script lang="ts">
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';

	let { children } = $props();
</script>

<div class="app-layout">
	<Sidebar />
	<main class="content">
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
</style>
