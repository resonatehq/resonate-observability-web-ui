<script lang="ts">
	import { ApiError } from '$lib/api/client';

	interface Props {
		error: ApiError;
		/** Optional context, e.g. "loading workflows". */
		while?: string;
	}

	let { error, while: context }: Props = $props();

	/**
	 * Every failure used to render as `API returned {status}: {body}`, which
	 * told the operator nothing they could act on — and after the move to
	 * direct browser-to-server calls the most common failure has no status at
	 * all. The remedy text is the point of this component; the heading is just
	 * a label for it.
	 */
	const heading = $derived(
		{
			unreachable: 'Cannot reach the server',
			unauthorized: 'Not authorized',
			forbidden: 'Not permitted',
			cloud_run_unauthorized: 'Cloud Run rejected this request',
			not_found: 'Not found',
			bad_request: 'The server rejected the request',
			server_error: 'The server failed',
			unknown: 'Something went wrong'
		}[error.kind]
	);
</script>

<div class="alert alert-error error-panel" role="alert">
	<p class="error-heading">
		{heading}{#if context}&nbsp;while {context}{/if}
	</p>
	<p class="error-message">{error.message}</p>
	{#if error.remedy}
		<p class="error-remedy">{error.remedy}</p>
	{/if}
	{#if error.kind === 'unreachable' || error.kind === 'unauthorized' || error.kind === 'cloud_run_unauthorized'}
		<a class="error-link" href="/settings">Open settings</a>
	{/if}
</div>

<style>
	.error-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.error-heading {
		margin: 0;
		font-weight: 600;
	}

	.error-message {
		margin: 0;
	}

	.error-remedy {
		margin: 0;
		/* The remedy carries a copy-pasteable command, so newlines and spacing
		   in the message must survive. */
		white-space: pre-wrap;
		font-size: 0.875rem;
		opacity: 0.9;
	}

	.error-link {
		align-self: flex-start;
		font-size: 0.875rem;
		text-decoration: underline;
	}
</style>
