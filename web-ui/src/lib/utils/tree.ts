import type { Promise } from '$lib/api/client';

export interface TreeNode {
	promise: Promise;
	children: TreeNode[];
	expanded: boolean;
}

/**
 * Builds a tree from a flat list of promises using resonate:parent tags.
 */
export function buildTree(rootId: string, promises: Promise[]): TreeNode | null {
	const nodeMap = new Map<string, TreeNode>();
	const childrenMap = new Map<string, TreeNode[]>();

	// Create nodes
	for (const p of promises) {
		const node: TreeNode = { promise: p, children: [], expanded: false };
		nodeMap.set(p.id, node);

		const parent = p.tags?.['resonate:parent'];
		if (parent && parent !== p.id) {
			if (!childrenMap.has(parent)) {
				childrenMap.set(parent, []);
			}
			childrenMap.get(parent)!.push(node);
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
 * Fetches all promises for a tree using resonate:origin tag.
 */
export async function fetchTreePromises(
	rootId: string,
	fetchFn: (tags: Record<string, string>, cursor?: string) => globalThis.Promise<{ promises: Promise[]; cursor?: string }>
): globalThis.Promise<Promise[]> {
	const allPromises: Promise[] = [];
	let cursor: string | undefined;

	do {
		const result = await fetchFn({ 'resonate:origin': rootId }, cursor);
		allPromises.push(...result.promises);
		cursor = result.cursor;
	} while (cursor);

	return allPromises;
}

/**
 * Checks if a promise is a root (has no parent or parent === self).
 */
export function isRoot(p: Promise): boolean {
	const parent = p.tags?.['resonate:parent'];
	return !parent || parent === p.id;
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
