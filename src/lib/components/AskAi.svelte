<script lang="ts">
	import { tick } from 'svelte';
	import { buildBundle, type CaptureInput, type Bundle } from '$lib/api/bundle.js';
	import { connectionStore } from '$lib/stores/connection.svelte';

	/**
	 * What a view supplies. The three fields it does *not* supply — the server,
	 * the timestamp and the secrets to scrub — are filled in here on purpose: if
	 * every route passed its own token to be redacted, the day someone adds a
	 * route and forgets is the day a bundle carries a credential. A route can
	 * describe what it is showing; it cannot opt out of the scrubbing.
	 */
	type ViewCapture = Omit<CaptureInput, 'serverUrl' | 'capturedAt' | 'secrets'>;

	interface Props {
		/**
		 * Called at click time, not at render time. The bundle must describe what
		 * is on screen when the operator asks, and on a polling view that is not
		 * what was on screen when the button mounted.
		 */
		capture: () => ViewCapture;
		/** Match the surrounding controls; the toolbars differ per route. */
		size?: 'default' | 'small';
	}

	let { capture, size = 'default' }: Props = $props();

	let bundle = $state<Bundle | null>(null);
	let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
	let trigger = $state<HTMLButtonElement | null>(null);
	let dialog = $state<HTMLDialogElement | null>(null);
	let heading = $state<HTMLElement | null>(null);
	let textarea = $state<HTMLTextAreaElement | null>(null);

	/**
	 * A modal `<dialog>` rather than an inline panel: the button lives in a
	 * toolbar that is a flex row on most routes, and a bundle preview is far too
	 * big to sit in one. `showModal` also brings Escape-to-close and a focus trap
	 * without hand-rolling either.
	 */
	async function openPanel() {
		bundle = buildBundle({
			...capture(),
			serverUrl: connectionStore.url,
			capturedAt: new Date().toISOString(),
			// The token is never in a rendered record, but a promise param is
			// operator-supplied and can contain anything — including, in a support
			// scenario, the very token someone pasted into a payload to reproduce a
			// bug. Handing it to the scrubber costs nothing when it is absent.
			secrets: connectionStore.token ? [connectionStore.token] : []
		});
		copyState = 'idle';
		dialog?.showModal();
		// `tick` first, or the heading does not exist yet: the dialog body is
		// `{#if bundle}`, and assigning `bundle` one line above only *schedules*
		// the render. Without this the focus call is a no-op on a null binding
		// and focus stays on the dialog element — which traps and escapes
		// correctly, so nothing looks broken, but a screen reader announces an
		// empty dialog instead of what this is.
		await tick();
		// The heading rather than the first button, so a screen reader says what
		// this is before it says what you can do about it.
		heading?.focus();
	}

	/**
	 * Focus returns to the button that opened the dialog. `showModal` restores it
	 * on its own in current browsers, but stating it costs one line and the
	 * alternative failure — focus on `<body>`, next Tab restarting at the top of
	 * the page — is exactly the one the schedule form was fixed for.
	 */
	function onclose() {
		trigger?.focus();
	}

	async function copy() {
		if (!bundle) return;
		try {
			await navigator.clipboard.writeText(bundle.text);
			copyState = 'copied';
			return;
		} catch {
			// `navigator.clipboard` is undefined outside a secure context, and a
			// console served over plain HTTP on a LAN address — which is how an
			// on-prem install is usually reached — is not one. Falling back to a
			// selection means the operator can still press their own copy key.
		}
		textarea?.focus();
		textarea?.select();
		copyState = 'failed';
	}

	function download() {
		if (!bundle) return;
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const blob = new Blob([bundle.text], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `resonate-context-${stamp}.md`;
		link.click();
		URL.revokeObjectURL(url);
	}

	const sizeKb = $derived(bundle ? Math.max(1, Math.round(bundle.bytes / 1024)) : 0);
	const boundsCount = $derived(bundle ? bundle.truncations.length + bundle.redactions.length : 0);
</script>

<button class="btn" class:btn-sm={size === 'small'} bind:this={trigger} onclick={openPanel}>
	Ask AI
</button>

<dialog bind:this={dialog} {onclose} aria-labelledby="ask-ai-heading">
	{#if bundle}
		<h2 id="ask-ai-heading" tabindex="-1" bind:this={heading}>Context for an assistant</h2>

		<p class="lede">
			Everything this view is rendering, as text you can paste into any assistant. Nothing is sent
			anywhere — the bundle is built in this browser and goes to your clipboard.
		</p>

		<p class="summary">
			<strong>{bundle.recordCount}</strong>
			{bundle.recordCount === 1 ? 'record' : 'records'} · <strong>{sizeKb} KB</strong>
			{#if boundsCount > 0}
				· <strong>{boundsCount}</strong>
				{boundsCount === 1 ? 'bound or redaction' : 'bounds and redactions'}, each one named at the
				end of the bundle
			{/if}
		</p>

		{#if bundle.hasPayload}
			<!--
				Params and outcomes are whatever the operator's own workflows put
				there, which in production is customer data. The warning belongs on
				the copy action rather than inside the bundle, because the bundle is
				read after the decision to share it has already been made.
			-->
			<div class="alert alert-warning">
				<strong>This includes payload data.</strong> Promise params and outcomes are in here, decoded
				where they were readable. If your workflows carry customer data, so does this bundle — treat
				it as public the moment you copy it.
			</div>
		{/if}

		<label class="preview-label" for="ask-ai-text">The bundle</label>
		<textarea id="ask-ai-text" class="preview" readonly bind:this={textarea} value={bundle.text}
		></textarea>

		<div class="actions">
			<button class="btn btn-primary" onclick={copy}>Copy to clipboard</button>
			<button class="btn" onclick={download}>Download .md</button>
			<button class="btn" onclick={() => dialog?.close()}>Close</button>
			<span class="copy-state" role="status">
				{#if copyState === 'copied'}
					Copied.
				{:else if copyState === 'failed'}
					This browser would not let the page write to the clipboard. The bundle is selected above —
					copy it yourself, or download it.
				{/if}
			</span>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(56rem, calc(100vw - 4rem));
		max-height: calc(100vh - 4rem);
		/* The browser centres a modal dialog with `margin: auto`, and this app's
		   global reset zeroes every margin — so without this the dialog pins to
		   the top-left corner. */
		margin: auto;
		padding: 1.5rem;
		background: var(--bg-surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 8px;
		/* The dialog is the only surface in the app that floats over content, so
		   the shadow is local rather than a token nobody else would use. */
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.4);
	}

	dialog[open] {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	h2 {
		margin: 0;
		font-size: 1.0625rem;
		font-weight: 600;
	}

	/* The heading takes focus when the dialog opens, so it needs a visible ring:
	   a sighted keyboard user has to be able to see where they just landed. */
	h2:focus-visible {
		outline: 2px solid var(--secondary);
		outline-offset: 3px;
		border-radius: 3px;
	}

	.lede,
	.summary {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-muted);
	}

	.summary strong {
		color: var(--text);
	}

	.preview-label {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.preview {
		flex: 1;
		min-height: 16rem;
		resize: vertical;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.copy-state {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
</style>
