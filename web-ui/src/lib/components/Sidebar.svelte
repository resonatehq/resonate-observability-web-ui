<script lang="ts">
	import { page } from '$app/state';
	import { connectionStore } from '$lib/stores/connection.svelte';

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
