<script lang="ts">
	import { connectionStore } from '$lib/stores/connection.svelte';
	import { testConnection } from '$lib/api/client';

	let url = $state(connectionStore.url);
	let token = $state(connectionStore.token);
	let saved = $state(false);
	let showToken = $state(false);

	let testing = $state(false);
	let testResult = $state<{ ok: boolean; detail: string } | null>(null);

	function persist() {
		connectionStore.url = url;
		connectionStore.token = token;
	}

	function handleSave(e: SubmitEvent) {
		e.preventDefault();
		persist();
		saved = true;
		testResult = null;
		setTimeout(() => (saved = false), 2000);
	}

	/**
	 * Save always claimed success, so a wrong URL or a stale token was
	 * discovered as a wall of red on some other page. This is now the
	 * operator's primary setup surface and the likeliest place a first run
	 * fails, so it checks for real.
	 *
	 * The settings are persisted first because the check runs through the same
	 * client the rest of the app uses — testing values the app is not going to
	 * use would prove nothing.
	 */
	async function handleTest() {
		persist();
		testing = true;
		testResult = null;
		try {
			testResult = await testConnection(url);
		} finally {
			testing = false;
		}
	}

	const uiOrigin = typeof location !== 'undefined' ? location.origin : 'http://localhost:5173';
</script>

<div class="page-header">
	<h1>Settings</h1>
</div>

<div class="settings-card">
	<h2>Connection</h2>
	<p class="muted">Configure the Resonate server this UI connects to.</p>

	<form class="settings-form" onsubmit={handleSave}>
		<label class="field">
			<span class="field-label">Resonate Server URL</span>
			<input type="url" class="search-input" bind:value={url} placeholder="http://localhost:8001" />
			<span class="field-hint">
				The base URL of the Resonate server (default port 8001). Your browser calls it
				directly, so the server must allow this page&rsquo;s origin:
				<code>--server-cors-allow-origin {uiOrigin}</code>
			</span>
		</label>

		<label class="field">
			<span class="field-label">Auth Token (JWT)</span>
			<div class="token-input-row">
				{#if showToken}
					<input type="text" class="search-input mono" bind:value={token} placeholder="eyJhbGci..." />
				{:else}
					<input type="password" class="search-input mono" bind:value={token} placeholder="eyJhbGci..." />
				{/if}
				<button type="button" class="btn btn-sm" onclick={() => (showToken = !showToken)}>
					{showToken ? 'Hide' : 'Show'}
				</button>
			</div>
			<span class="field-hint">
				Leave blank unless the server was started with <code>--auth-publickey</code>. The
				token must be a JWT with an <code>exp</code> claim, and it needs
				<code>role: "admin"</code> or an empty <code>prefix</code> claim &mdash; a
				prefix-scoped token cannot run the searches this UI is built on.
			</span>
		</label>

		<div class="form-actions">
			<button type="submit" class="btn btn-primary">Save</button>
			<button type="button" class="btn" onclick={handleTest} disabled={testing}>
				{testing ? 'Testing…' : 'Test connection'}
			</button>
			{#if saved}
				<span class="save-confirmation">Saved</span>
			{/if}
		</div>
	</form>

	{#if testResult}
		<div class="test-result" class:ok={testResult.ok} class:bad={!testResult.ok}>
			{testResult.detail}
		</div>
	{/if}
</div>

<div class="settings-card warning-card">
	<h2>Before you expose this UI</h2>
	<p class="muted">
		The token above is stored in this browser&rsquo;s <code>localStorage</code> in plain
		text, and a token that can drive this UI can read and modify every promise on your
		server. That is a reasonable trade for a tool you run on your own machine. It is not
		one for a page served on a shared network &mdash; anything with access to this origin
		has your server.
	</p>
</div>

<style>
	.test-result {
		margin-top: 1.25rem;
		padding: 0.75rem 1rem;
		border-radius: 6px;
		font-size: 0.875rem;
		white-space: pre-wrap;
	}

	.test-result.ok {
		color: var(--status-resolved-fg);
		background: var(--status-resolved-bg);
	}

	.test-result.bad {
		color: var(--status-rejected-fg);
		background: var(--status-rejected-bg);
	}

	.warning-card {
		margin-top: 1.5rem;
	}

	.warning-card h2 {
		color: var(--status-timedout-fg);
	}

	.settings-card {
		background: var(--bg-surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.5rem;
		max-width: 600px;
	}

	.settings-card h2 {
		font-size: 1.125rem;
		margin-bottom: 0.25rem;
	}

	.settings-card > .muted {
		margin-bottom: 1.5rem;
	}

	.settings-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.field-label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.field-hint {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.token-input-row {
		display: flex;
		gap: 0.5rem;
	}

	.token-input-row .search-input {
		flex: 1;
	}

	.form-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.save-confirmation {
		font-size: 0.875rem;
		color: var(--status-resolved-fg);
	}
</style>
