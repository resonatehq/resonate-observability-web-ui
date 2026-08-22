<script lang="ts">
	import { BaseEdge, getSmoothStepPath } from '@xyflow/svelte';
	import type { Edge, EdgeProps } from '@xyflow/svelte';
	import type { GraphEdgeData } from '$lib/utils/tree';
	import { subtreeColor } from '$lib/utils/state';

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
	}: EdgeProps<Edge<GraphEdgeData>> = $props();

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

	let color = $derived(
		data?.subtreeStatus ? subtreeColor(data.subtreeStatus) : 'var(--edge-default)'
	);
</script>

<BaseEdge {id} path={pathResult[0]} style="stroke: {color}; stroke-width: 2;" {markerEnd} />
