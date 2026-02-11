import type { Promise } from '$lib/api/client';
import type { Node, Edge } from '@xyflow/svelte';
import dagre from '@dagrejs/dagre';

export interface TreeNode {
	promise: Promise;
	children: TreeNode[];
	expanded: boolean;
}

export type SubtreeStatus = 'resolved' | 'pending' | 'rejected';

export interface GraphNodeData {
	promise: Promise;
	subtreeStatus: SubtreeStatus;
	duration: number | null;
	role: string;
	childCount: number;
	label: string;
	/** Function name for rpc/run calls (from resonate:invoke) */
	functionName?: string;
	/** Sleep duration in ms for sleep promises */
	sleepDuration?: number;
	[key: string]: unknown;
}

export interface GraphEdgeData {
	state: string;
	subtreeStatus: SubtreeStatus;
	[key: string]: unknown;
}

/**
 * Infers parent ID from promise ID structure.
 * e.g., "countdown-123.2.1" -> "countdown-123.2"
 */
function inferParentFromId(id: string): string | null {
	const lastDot = id.lastIndexOf('.');
	if (lastDot > 0) {
		return id.substring(0, lastDot);
	}
	return null;
}

/**
 * Builds a tree from a flat list of promises using resonate:parent tags
 * with fallback to ID prefix matching.
 */
export function buildTree(rootId: string, promises: Promise[]): TreeNode | null {
	const nodeMap = new Map<string, TreeNode>();
	const childrenMap = new Map<string, TreeNode[]>();

	// Create nodes
	for (const p of promises) {
		const node: TreeNode = { promise: p, children: [], expanded: false };
		nodeMap.set(p.id, node);

		// First try tag-based parent
		const parent = p.tags?.['resonate:parent'];
		if (parent && parent !== p.id) {
			if (!childrenMap.has(parent)) {
				childrenMap.set(parent, []);
			}
			childrenMap.get(parent)!.push(node);
		} else {
			// Fallback: use ID prefix matching
			const inferredParent = inferParentFromId(p.id);
			if (inferredParent && inferredParent !== p.id) {
				if (!childrenMap.has(inferredParent)) {
					childrenMap.set(inferredParent, []);
				}
				childrenMap.get(inferredParent)!.push(node);
			}
		}
	}

	// Sort children by createdOn
	for (const children of childrenMap.values()) {
		children.sort((a, b) => (a.promise.createdOn ?? 0) - (b.promise.createdOn ?? 0));
	}

	// Get root node
	let root = nodeMap.get(rootId);
	if (!root) {
		// Root not in results - create placeholder
		root = {
			promise: { id: rootId, state: 'UNKNOWN', timeout: 0 },
			children: [],
			expanded: false
		};
	}

	// Assign children recursively
	function assignChildren(node: TreeNode) {
		node.children = childrenMap.get(node.promise.id) ?? [];
		for (const child of node.children) {
			assignChildren(child);
		}
	}
	assignChildren(root);

	return root;
}

/**
 * Fetches all promises for a tree using resonate:origin tag,
 * with fallback to ID prefix search.
 */
export async function fetchTreePromises(
	rootId: string,
	fetchFn: (params: { id?: string; tags?: Record<string, string>; cursor?: string; limit?: number }) => globalThis.Promise<{ promises: Promise[]; cursor?: string }>
): globalThis.Promise<Promise[]> {
	const allPromises: Promise[] = [];
	let cursor: string | undefined;

	// First try with resonate:origin tag
	do {
		const result = await fetchFn({ tags: { 'resonate:origin': rootId }, cursor, limit: 100 });
		allPromises.push(...result.promises);
		cursor = result.cursor;
	} while (cursor);

	// If no results, try ID-based search (e.g., rootId.*)
	if (allPromises.length === 0) {
		const result = await fetchFn({ id: rootId + '*', limit: 100 });
		allPromises.push(...result.promises);
	}

	return allPromises;
}

/**
 * Checks if a promise is a root (has no parent or parent === self).
 */
export function isRoot(p: Promise): boolean {
	const parent = p.tags?.['resonate:parent'];
	if (parent && parent !== p.id) {
		return false; // Has a parent tag
	}

	// Fallback: check if ID structure suggests this is a child
	// e.g., "countdown-123.2" is likely a child of "countdown-123"
	const inferredParent = inferParentFromId(p.id);
	if (inferredParent) {
		return false; // ID structure suggests this is a child
	}

	return true;
}

/**
 * Checks if a promise is a root within a given set of promises.
 * Uses both tag-based and ID-based parent detection.
 */
export function isRootInSet(p: Promise, allPromises: Promise[]): boolean {
	// First check tags
	const parent = p.tags?.['resonate:parent'];
	if (parent && parent !== p.id) {
		return false; // Has a parent tag
	}

	// Fallback: check if any other promise has an ID that is a prefix of this one
	for (const other of allPromises) {
		if (other.id !== p.id && p.id.startsWith(other.id + '.')) {
			return false; // This promise's ID suggests it's a child
		}
	}

	return true;
}

/**
 * Determines the role/type of a promise (for child promises).
 */
export function promiseRole(p: Promise): string {
	if (p.tags?.['resonate:timeout']) {
		return 'sleep';
	}
	switch (p.tags?.['resonate:scope']) {
		case 'global':
			return 'rpc';
		case 'local':
			return 'run';
	}
	return 'root';
}

/**
 * Normalizes promise state string to a simple status.
 */
function normalizeState(state: string): SubtreeStatus {
	if (state === 'RESOLVED') return 'resolved';
	if (state === 'PENDING') return 'pending';
	return 'rejected'; // REJECTED, REJECTED_CANCELED, REJECTED_TIMEDOUT, UNKNOWN
}

/**
 * Computes the aggregate status of a node's subtree.
 * If any descendant is rejected, the subtree is 'rejected'.
 * If any descendant is pending, the subtree is 'pending'.
 * Otherwise 'resolved'.
 */
export function computeSubtreeStatus(node: TreeNode): SubtreeStatus {
	if (node.children.length === 0) {
		return normalizeState(node.promise.state);
	}
	const childStatuses = node.children.map((c) => computeSubtreeStatus(c));
	if (childStatuses.includes('rejected')) return 'rejected';
	if (childStatuses.includes('pending')) return 'pending';
	// Also check this node's own state
	const own = normalizeState(node.promise.state);
	if (own === 'rejected') return 'rejected';
	if (own === 'pending') return 'pending';
	return 'resolved';
}

/**
 * Computes duration in milliseconds from createdOn to completedOn.
 * Returns null if either timestamp is missing.
 */
export function computeDuration(p: Promise): number | null {
	if (p.createdOn != null && p.completedOn != null) {
		return p.completedOn - p.createdOn;
	}
	return null;
}

/**
 * Formats a duration in ms to a human-readable string.
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
	return `${(ms / 3_600_000).toFixed(1)}h`;
}

/**
 * Extracts a short display label from a promise ID.
 * e.g., "order-abc-123.2.charge-payment" -> "charge-payment"
 * e.g., "order-abc-123" -> "order-abc-123"
 */
export function promiseLabel(p: Promise): string {
	// If the promise has an invoke tag, use that as the label
	if (p.tags?.['resonate:invoke']) {
		return p.tags['resonate:invoke'];
	}
	// Otherwise use the last segment after the last dot
	const lastDot = p.id.lastIndexOf('.');
	if (lastDot > 0) {
		const segment = p.id.substring(lastDot + 1);
		// If the segment is just a number, include the parent segment too
		if (/^\d+$/.test(segment)) {
			const secondLastDot = p.id.lastIndexOf('.', lastDot - 1);
			if (secondLastDot > 0) {
				return p.id.substring(secondLastDot + 1);
			}
		}
		return segment;
	}
	return p.id;
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

/**
 * Converts a TreeNode hierarchy into Svelte Flow nodes and edges,
 * positioned using dagre hierarchical layout.
 */
export function treeToGraphData(
	root: TreeNode,
	direction: 'TB' | 'LR' = 'TB'
): { nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] } {
	const nodes: Node<GraphNodeData>[] = [];
	const edges: Edge<GraphEdgeData>[] = [];

	function walk(node: TreeNode) {
		const subtreeStatus = computeSubtreeStatus(node);
		const role = promiseRole(node.promise);
		const functionName = node.promise.tags?.['resonate:invoke'];

		// For sleep promises, extract the timeout duration
		let sleepDuration: number | undefined;
		if (role === 'sleep') {
			const timeoutTag = node.promise.tags?.['resonate:timeout'];
			if (timeoutTag) {
				// Timeout tag might be in milliseconds as a string
				const parsed = parseInt(timeoutTag, 10);
				if (!isNaN(parsed)) {
					sleepDuration = parsed;
				}
			} else if (node.promise.timeout) {
				// Fallback to timeout field
				sleepDuration = node.promise.timeout;
			}
		}

		nodes.push({
			id: node.promise.id,
			type: 'promise',
			data: {
				promise: node.promise,
				subtreeStatus,
				duration: computeDuration(node.promise),
				role,
				childCount: node.children.length,
				label: promiseLabel(node.promise),
				functionName,
				sleepDuration
			},
			position: { x: 0, y: 0 }
		});

		for (const child of node.children) {
			const childSubtreeStatus = computeSubtreeStatus(child);
			edges.push({
				id: `${node.promise.id}->${child.promise.id}`,
				source: node.promise.id,
				target: child.promise.id,
				type: 'status',
				data: {
					state: child.promise.state,
					subtreeStatus: childSubtreeStatus
				}
			});
			walk(child);
		}
	}

	walk(root);
	return layoutWithDagre(nodes, edges, direction);
}

/**
 * Runs dagre layout on nodes and edges, returning positioned data.
 */
function layoutWithDagre(
	nodes: Node<GraphNodeData>[],
	edges: Edge<GraphEdgeData>[],
	direction: 'TB' | 'LR'
): { nodes: Node<GraphNodeData>[]; edges: Edge<GraphEdgeData>[] } {
	const g = new dagre.graphlib.Graph();
	g.setDefaultEdgeLabel(() => ({}));
	g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 });

	for (const node of nodes) {
		g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
	}
	for (const edge of edges) {
		g.setEdge(edge.source, edge.target);
	}

	dagre.layout(g);

	const positionedNodes = nodes.map((node) => {
		const pos = g.node(node.id);
		return {
			...node,
			position: {
				x: pos.x - NODE_WIDTH / 2,
				y: pos.y - NODE_HEIGHT / 2
			}
		};
	});

	return { nodes: positionedNodes, edges };
}
