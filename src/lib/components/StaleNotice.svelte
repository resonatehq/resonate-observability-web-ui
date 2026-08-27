<script lang="ts">
	interface Props {
		/** Epoch ms of the last load that actually succeeded. */
		since: number;
		/** What is being shown, e.g. "these rows", "this schedule". */
		what?: string;
	}

	let { since, what = 'the data below' }: Props = $props();

	const at = $derived(new Date(since).toLocaleTimeString());
</script>

<!--
	Shown whenever a view keeps records that a failed load did not replace.

	The Ask AI bundle already says this in text — a reader of the bundle is told
	the records are from an earlier load and are not a current answer. Until this
	existed, the person actually looking at the screen was the only one not told:
	the error panel above and a populated table below read as two unrelated facts,
	and the natural reading is that the table is current.

	`role="status"` rather than `alert`: the error panel above it is the alert,
	and two assertive regions announcing at once means a screen-reader user hears
	neither cleanly.
-->
<p class="alert alert-warning stale-notice" role="status">
	Showing {what} from <span class="stale-time">{at}</span> — the latest refresh failed, so this may
	be out of date.
</p>

<style>
	.stale-notice {
		/* The error panel sits directly above and already carries the bottom
		   margin; this pulls the pair together so they read as one statement. */
		margin-top: -0.5rem;
	}

	.stale-time {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
</style>
