<script lang="ts">
	import { connectionStore } from '$lib/stores/connection.svelte';

	let url = $state(connectionStore.url);
	let token = $state(connectionStore.token);
	let saved = $state(false);
	let showToken = $state(false);

	function handleSave(e: SubmitEvent) {
		e.preventDefault();
		connectionStore.url = url;
		connectionStore.token = token;
		saved = true;
		setTimeout(() => (saved = false), 2000);
	}
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
			<span class="field-hint">The base URL of the Resonate server REST API (typically port 8001).</span>
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
			<span class="field-hint">Optional. Bearer token sent with every API request. Leave blank if auth is not enabled.</span>
		</label>

		<div class="form-actions">
			<button type="submit" class="btn btn-primary">Save</button>
			{#if saved}
				<span class="save-confirmation">Saved</span>
			{/if}
		</div>
	</form>
</div>

<style>
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
		color: var(--green);
	}
</style>
