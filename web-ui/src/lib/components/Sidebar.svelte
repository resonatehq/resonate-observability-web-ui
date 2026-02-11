<script lang="ts">
	import { page } from '$app/state';
	import { connectionStore } from '$lib/stores/connection.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';

	const navItems = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/workflows', label: 'Workflows' },
		{ href: '/promises', label: 'Promises' },
		{ href: '/schedules', label: 'Schedules' },
		{ href: '/settings', label: 'Settings' }
	];

	function isActive(href: string): boolean {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
	}

	function handleThemeToggle() {
		themeStore.toggle();
	}
</script>

<nav class="sidebar">
	<div class="sidebar-brand">
		<h2>Resonate</h2>
		<span class="sidebar-subtitle">Observability</span>
	</div>

	<ul class="sidebar-nav">
		{#each navItems as item}
			<li>
				<a href={item.href} class="nav-link" class:active={isActive(item.href)}>
					{item.label}
				</a>
			</li>
		{/each}
	</ul>

	<div class="sidebar-footer">
		<button class="theme-toggle" onclick={handleThemeToggle} title="Toggle theme">
			{#if themeStore.theme === 'dark'}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="5"></circle>
					<line x1="12" y1="1" x2="12" y2="3"></line>
					<line x1="12" y1="21" x2="12" y2="23"></line>
					<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
					<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
					<line x1="1" y1="12" x2="3" y2="12"></line>
					<line x1="21" y1="12" x2="23" y2="12"></line>
					<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
					<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
				</svg>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
				</svg>
			{/if}
		</button>
		<div class="connection-status" title={connectionStore.url}>
			<span class="status-dot"></span>
			<span class="status-label">{connectionStore.url.replace(/^https?:\/\//, '')}</span>
		</div>
	</div>
</nav>

<style>
	.sidebar {
		width: var(--sidebar-width);
		background: var(--bg-surface);
		border-right: 1px solid var(--border);
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}

	.sidebar-brand {
		padding: 1.5rem 1.5rem 1.25rem;
		border-bottom: 1px solid var(--border);
	}

	.sidebar-brand h2 {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text);
	}

	.sidebar-subtitle {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.sidebar-nav {
		list-style: none;
		padding: 1rem 0;
		flex: 1;
	}

	.nav-link {
		display: block;
		padding: 0.625rem 1.5rem;
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.875rem;
		transition: color 0.15s, background 0.15s;
	}

	.nav-link:hover {
		color: var(--text);
		background: var(--bg-surface-hover);
		text-decoration: none;
	}

	.nav-link.active {
		color: var(--text);
		background: var(--bg-surface-hover);
		border-right: 2px solid var(--primary);
	}

	.sidebar-footer {
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.theme-toggle {
		background: var(--bg-surface-hover);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.theme-toggle:hover {
		background: var(--bg);
		color: var(--text);
		border-color: var(--secondary);
	}

	.connection-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--green);
		flex-shrink: 0;
	}

	.status-label {
		font-size: 0.75rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
