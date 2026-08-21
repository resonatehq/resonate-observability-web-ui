import type { PromiseRecord, PromiseState } from '$lib/api/client';
import type { Node, Edge } from '@xyflow/svelte';
import dagre from '@dagrejs/dagre';

export interface TreeNode {
	promise: PromiseRecord;
	children: TreeNode[];
	expanded: boolean;
	/**
	 * True when the promise was not in the search results and this node is a
	 * placeholder. Callers must not present its `state` as fact.
	 */
	missing?: boolean;
}

/**
 * Aggregate status of a node and everything under it.
 *
 * This mirrors the server's five states rather than collapsing them: a
 * cancellation is somebody's decision, a timeout is a missed deadline, and a
 * rejection is a failure. An operator triaging a stuck system needs to tell
 * those apart at a glance, so the graph colours them apart.
 */
export type SubtreeStatus = 'resolved' | 'pending' | 'rejected' | 'canceled' | 'timedout';

export interface GraphNodeData {
	promise: PromiseRecord;
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
export function buildTree(rootId: string, promises: PromiseRecord[]): TreeNode | null {
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

	// Sort children by creation time. This is the only ordering available:
	// the server offers no sort parameter, so ordering is always done here.
	for (const children of childrenMap.values()) {
		children.sort((a, b) => a.promise.createdAt - b.promise.createdAt);
	}

	// Get root node
	let root = nodeMap.get(rootId);
	if (!root) {
		// The root was not among the results. Render a placeholder rather than
		// nothing, but flag it: its state is unknown, not pending, and callers
		// must not draw a badge from it.
		root = {
			promise: {
				id: rootId,
				state: 'pending',
				param: {},
				value: {},
				tags: {},
				timeoutAt: 0,
				createdAt: 0
			},
			children: [],
			expanded: false,
			missing: true
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
 * Fetches every promise belonging to a tree, by its `resonate:origin` tag.
 *
 * The old ID-prefix fallback is gone: `promise.search` has no `id` parameter,
 * and passing one is silently ignored rather than rejected — so the fallback
 * did not narrow anything, it just fetched the first page of the entire server
 * and called it a tree.
 *
 * A tree whose promises lack `resonate:origin` is therefore not reachable, and
 * the caller should say so rather than showing a plausible wrong graph.
 */
export async function fetchTreePromises(
	rootId: string,
	fetchFn: (params: {
		tags?: Record<string, string>;
		cursor?: string;
		limit?: number;
	}) => globalThis.Promise<{ promises: PromiseRecord[]; cursor?: string }>
): globalThis.Promise<PromiseRecord[]> {
	const allPromises: PromiseRecord[] = [];
	let cursor: string | undefined;

	do {
		const result = await fetchFn({ tags: { 'resonate:origin': rootId }, cursor, limit: 100 });
		allPromises.push(...result.promises);
		cursor = result.cursor;
	} while (cursor);

	return allPromises;
}

/**
 * Checks if a promise is a root (has no parent or parent === self).
 */
export function isRoot(p: PromiseRecord): boolean {
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
export function isRootInSet(p: PromiseRecord, allPromises: PromiseRecord[]): boolean {
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
export function promiseRole(p: PromiseRecord): string {
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

/** Maps a server state onto its display status, one-to-one. */
function normalizeState(state: PromiseState): SubtreeStatus {
	switch (state) {
		case 'resolved':
			return 'resolved';
		case 'pending':
			return 'pending';
		case 'rejected_canceled':
			return 'canceled';
		case 'rejected_timedout':
			return 'timedout';
		case 'rejected':
			return 'rejected';
	}
}

/**
 * Worst-first precedence for rolling a subtree up into one status.
 *
 * An outright rejection outranks a timeout, which outranks a cancellation,
 * because that is the order in which an operator wants to be told. Pending
 * outranks resolved so a run in flight never reads as finished.
 */
const STATUS_SEVERITY: Record<SubtreeStatus, number> = {
	rejected: 4,
	timedout: 3,
	canceled: 2,
	pending: 1,
	resolved: 0
};

/**
 * Computes the aggregate status of a node's subtree.
 * If any descendant is rejected, the subtree is 'rejected'.
 * If any descendant is pending, the subtree is 'pending'.
 * Otherwise 'resolved'.
 */
export function computeSubtreeStatus(node: TreeNode): SubtreeStatus {
	let worst = normalizeState(node.promise.state);
	for (const child of node.children) {
		const status = computeSubtreeStatus(child);
		if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
	}
	return worst;
}

/**
 * Computes duration in milliseconds from createdOn to completedOn.
 * Returns null if either timestamp is missing.
 */
export function computeDuration(p: PromiseRecord): number | null {
	// `settledAt` is absent while a promise is pending — the key is missing
	// rather than null — so an unsettled promise has no duration yet.
	if (p.settledAt == null) return null;
	return p.settledAt - p.createdAt;
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
export function promiseLabel(p: PromiseRecord): string {
	// Use the last segment after the last dot
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

		// Extract function name from param.data if available
		let functionName: string | undefined;
		if (node.promise.param?.data) {
			try {
				// Decode base64 and parse JSON
				const decoded = atob(node.promise.param.data);
				const paramData = JSON.parse(decoded);
				if (paramData?.func) {
					functionName = paramData.func;
				}
			} catch {
				// Ignore parse/decode errors
			}
		}

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

		// For TB layout, reverse children order to get left-to-right display
		// (dagre places them right-to-left by default)
		const childrenToProcess = direction === 'TB' ? [...node.children].reverse() : node.children;

		for (const child of childrenToProcess) {
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

/**
 * Flattens a tree into an array of all nodes in depth-first order.
 */
export function flattenTree(root: TreeNode): TreeNode[] {
	const result: TreeNode[] = [];
	function walk(node: TreeNode) {
		result.push(node);
		for (const child of node.children) {
			walk(child);
		}
	}
	walk(root);
	return result;
}
