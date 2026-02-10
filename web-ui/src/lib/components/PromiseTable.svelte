<script lang="ts">
	import type { Promise } from '$lib/api/client';
	import Badge from './Badge.svelte';

	interface Props {
		promises: Promise[];
	}

	let { promises }: Props = $props();
</script>

{#if promises.length === 0}
	<div class="empty-state">No promises found.</div>
{:else}
	<table class="data-table">
		<thead>
			<tr>
				<th>ID</th>
				<th>State</th>
				<th>Tags</th>
				<th>Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each promises as promise}
				<tr>
					<td class="mono">{promise.id}</td>
					<td><Badge state={promise.state} /></td>
					<td>
						{#if promise.tags}
							{#each Object.entries(promise.tags) as [k, v]}
								<span class="tag">{k}={v}</span>
							{/each}
						{/if}
					</td>
					<td>
						<a href="/promises/{promise.id}" class="btn btn-sm">Details</a>
						<a href="/tree/{promise.id}" class="btn btn-sm">Tree</a>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
