<script lang="ts">
	import { BaseEdge, getSmoothStepPath } from '@xyflow/svelte';
	import type { EdgeProps } from '@xyflow/svelte';
	import type { GraphEdgeData } from '$lib/utils/tree';

	let {
		id,
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		data,
		markerEnd
	}: EdgeProps<GraphEdgeData> = $props();

	function edgeColor(status: string): string {
		switch (status) {
			case 'resolved':
				return 'var(--green)';
			case 'pending':
				return 'var(--yellow)';
			case 'rejected':
				return 'var(--red)';
			default:
				return 'var(--edge-default, #3a3d4a)';
		}
	}

	let pathResult = $derived(
		getSmoothStepPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition,
			targetPosition,
			borderRadius: 8
		})
	);

	let color = $derived(edgeColor(data?.subtreeStatus ?? ''));
</script>

<BaseEdge {id} path={pathResult[0]} style="stroke: {color}; stroke-width: 2;" {markerEnd} />
