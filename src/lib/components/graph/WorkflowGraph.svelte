<script lang="ts">
	import {
		SvelteFlow,
		Controls,
		Background,
		BackgroundVariant,
		MiniMap,
		type Node,
		type Edge
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import PromiseNode from './PromiseNode.svelte';
	import { subtreeColorHex, toSubtreeStatus } from '$lib/utils/state';
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
		<Background variant={BackgroundVariant.Dots} gap={20} size={1} patternClass="graph-dots" />
		{#if interactive}
			<Controls position="bottom-right" />
			<MiniMap
				pannable
				zoomable
				nodeColor={(node) => {
					const data = node.data as GraphNodeData;
					// Literal hex: the minimap is canvas-painted and cannot
					// resolve CSS custom properties.
					return subtreeColorHex(toSubtreeStatus(data.promise.state));
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
		--xy-minimap-background-color: var(--bg-surface);
		--xy-minimap-mask-background-color: var(--minimap-mask);
		--xy-controls-button-background-color: var(--bg-surface);
		--xy-controls-button-color: var(--text);
		--xy-controls-button-border-color: var(--border);
		--xy-edge-stroke: var(--edge-default);
		--xy-edge-stroke-width: 2;
		--xy-attribution-background-color: transparent;
	}

	.graph-wrapper :global(.svelte-flow__controls button:hover) {
		background: var(--bg-surface-hover);
	}

	.graph-wrapper :global(.graph-dots) {
		fill: var(--graph-dots);
	}

	.graph-wrapper :global(.svelte-flow__attribution) {
		display: none;
	}
</style>
