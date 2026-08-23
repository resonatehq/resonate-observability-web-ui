<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	/**
	 * `/tree/[id]` is gone — it ran the identical `fetchTreePromises` +
	 * `buildTree` pipeline as `/workflows/[id]`, which is a strict superset
	 * (graph, timeline and list rather than graph alone), and nothing linked
	 * to it. Keeping both meant migrating both.
	 *
	 * The redirect stays so existing bookmarks and copied links still land
	 * somewhere useful. `replaceState` keeps it out of the back-button history,
	 * so leaving the workflow page does not bounce back through here.
	 */
	$effect(() => {
		const id = page.params.id;
		if (id) {
			goto(`/workflows/${encodeURIComponent(id)}`, { replaceState: true });
		}
	});
</script>

<div class="loading">Redirecting to the workflow view…</div>
