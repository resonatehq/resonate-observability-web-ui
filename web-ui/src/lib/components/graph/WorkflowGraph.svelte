<script lang="ts">
	import {
		SvelteFlow,
		Controls,
		Background,
		MiniMap,
		type Node,
		type Edge
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import PromiseNode from './PromiseNode.svelte';
	import StatusEdge from './StatusEdge.svelte';
	import type { TreeNode, GraphNodeData, GraphEdgeData } from '$lib/utils/tree';
	import { treeToGraphData } from '$lib/utils/tree';

	interface Props {
		tree: TreeNode;
		direction?: 'TB' | 'LR';
		interactive?: boolean;
		onNodeClick?: (promiseId: string) => void;
	}

	let { tree, direction = 'TB', interactive = true, onNodeClick }: Props = $props();

	const nodeTypes = { promise: PromiseNode };
	const edgeTypes = { status: StatusEdge };

	let graphData = $derived(treeToGraphData(tree, direction));
	let nodes = $state<Node<GraphNodeData>[]>([]);
	let edges = $state<Edge<GraphEdgeData>[]>([]);

	$effect(() => {
		nodes = graphData.nodes;
		edges = graphData.edges;
	});

	function handleNodeClick({ node }: { node: Node<GraphNodeData>; event: MouseEvent | TouchEvent }) {
		onNodeClick?.(node.id);
	}
</script>

<div class="graph-wrapper" class:readonly={!interactive}>
	<SvelteFlow
		{nodes}
		{edges}
		{nodeTypes}
		{edgeTypes}
		fitView
		fitViewOptions={{ padding: 0.2 }}
		nodesDraggable={interactive}
		nodesConnectable={false}
		elementsSelectable={interactive}
		panOnDrag={interactive}
		zoomOnScroll={interactive}
		zoomOnPinch={interactive}
		zoomOnDoubleClick={interactive}
		preventScrolling={interactive}
		minZoom={0.1}
		maxZoom={2}
		defaultEdgeOptions={{ animated: false }}
		onnodeclick={handleNodeClick}
	>
		<Background variant="dots" gap={20} size={1} color="#1a1d24" />
		{#if interactive}
			<Controls position="bottom-right" />
			<MiniMap
				pannable
				zoomable
				nodeColor={(node) => {
					const data = node.data as GraphNodeData;
					switch (data.promise.state) {
						case 'RESOLVED':
							return '#22c55e';
						case 'PENDING':
							return '#eab308';
						case 'REJECTED':
						case 'REJECTED_CANCELED':
						case 'REJECTED_TIMEDOUT':
							return '#ef4444';
						default:
							return '#6b7280';
					}
				}}
			/>
		{/if}
	</SvelteFlow>
</div>

<style>
	.graph-wrapper {
		width: 100%;
		height: 100%;
		background: var(--bg, #080a0e);
		border-radius: 8px;
		overflow: hidden;
	}

	.graph-wrapper.readonly {
		pointer-events: none;
	}

	/* Override Svelte Flow defaults for dark theme */
	.graph-wrapper :global(.svelte-flow) {
		--xy-background-color: transparent;
		--xy-node-background-color: transparent;
		--xy-node-border-radius: 6px;
		--xy-node-border: none;
		--xy-node-box-shadow: none;
		--xy-minimap-background-color: #13151a;
		--xy-minimap-mask-background-color: rgba(8, 10, 14, 0.7);
		--xy-controls-button-background-color: #13151a;
		--xy-controls-button-color: #e4e7eb;
		--xy-controls-button-border-color: #2a2d3a;
		--xy-edge-stroke: #3a3d4a;
		--xy-edge-stroke-width: 2;
		--xy-attribution-background-color: transparent;
	}

	.graph-wrapper :global(.svelte-flow__controls button:hover) {
		background: #1a1d24;
	}

	.graph-wrapper :global(.svelte-flow__attribution) {
		display: none;
	}
</style>
