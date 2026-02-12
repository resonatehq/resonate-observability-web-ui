import type { TreeNode } from './tree';
import type { Promise } from '$lib/api/client';
import { flattenTree, promiseLabel } from './tree';

export interface TimelineBar {
	id: string;
	label: string;
	role: string;
	state: string;
	startTime: number;
	endTime: number | null;
	depth: number;
	/** Y position in pixels */
	y: number;
}

export interface TimelineData {
	bars: TimelineBar[];
	/** Earliest timestamp in ms */
	minTime: number;
	/** Latest timestamp in ms (or now for pending) */
	maxTime: number;
	/** Total duration in ms */
	duration: number;
}

const BAR_HEIGHT = 24;
const BAR_SPACING = 4;

/**
 * Converts a tree into timeline bar data.
 * Each promise becomes a horizontal bar positioned on a time axis.
 */
export function treeToTimelineData(root: TreeNode): TimelineData {
	const allNodes = flattenTree(root);

	// Find time bounds
	let minTime = Infinity;
	let maxTime = -Infinity;
	const now = Date.now();

	for (const node of allNodes) {
		const start = node.promise.createdOn;
		const end = node.promise.completedOn ?? (node.promise.state === 'PENDING' ? now : null);

		if (start != null) {
			minTime = Math.min(minTime, start);
		}
		if (end != null) {
			maxTime = Math.max(maxTime, end);
		}
	}

	// If no valid timestamps, return empty
	if (minTime === Infinity || maxTime === -Infinity) {
		return { bars: [], minTime: 0, maxTime: 0, duration: 0 };
	}

	// Build bars with depth-based Y positioning
	const bars: TimelineBar[] = [];
	const depthMap = new Map<string, number>();

	function computeDepth(node: TreeNode, depth: number) {
		depthMap.set(node.promise.id, depth);
		for (const child of node.children) {
			computeDepth(child, depth + 1);
		}
	}
	computeDepth(root, 0);

	for (const node of allNodes) {
		const depth = depthMap.get(node.promise.id) ?? 0;
		const role = getRoleFromTags(node.promise.tags);

		bars.push({
			id: node.promise.id,
			label: createTimelineLabel(node.promise, role),
			role,
			state: node.promise.state,
			startTime: node.promise.createdOn ?? minTime,
			endTime:
				node.promise.completedOn ?? (node.promise.state === 'PENDING' ? now : minTime),
			depth,
			y: 0 // Will be assigned by lane algorithm
		});
	}

	// Assign lanes to prevent overlapping bars
	assignLanes(bars);

	return {
		bars,
		minTime,
		maxTime,
		duration: maxTime - minTime
	};
}

function getRoleFromTags(tags?: Record<string, string>): string {
	if (tags?.['resonate:timeout']) return 'sleep';
	if (tags?.['resonate:scope'] === 'global') return 'rpc';
	if (tags?.['resonate:scope'] === 'local') return 'run';
	return 'root';
}

/**
 * Extracts function name from promise param data.
 * Returns undefined if not available or parsing fails.
 */
function extractFunctionName(p: Promise): string | undefined {
	if (p.param?.data) {
		try {
			const decoded = atob(p.param.data);
			const paramData = JSON.parse(decoded);
			if (paramData?.func) {
				return paramData.func;
			}
		} catch {
			// Ignore parse/decode errors
		}
	}
	return undefined;
}

/**
 * Creates a display label for a promise in the timeline.
 * Format: "ROLE funcName" or just "label" for root
 */
function createTimelineLabel(p: Promise, role: string): string {
	const funcName = extractFunctionName(p);

	if (funcName && role !== 'root') {
		// Show "RPC funcName" or "RUN funcName" or "SLEEP"
		return `${role.toUpperCase()} ${funcName}`;
	}

	// Fallback to promise label
	return promiseLabel(p);
}

/**
 * Assigns non-overlapping lanes (Y positions) to timeline bars.
 * Bars that overlap in time are placed in different lanes.
 */
function assignLanes(bars: TimelineBar[]): void {
	// Sort by start time, then by duration (longer first)
	const sorted = [...bars].sort((a, b) => {
		if (a.startTime !== b.startTime) return a.startTime - b.startTime;
		const aDuration = (a.endTime ?? a.startTime) - a.startTime;
		const bDuration = (b.endTime ?? b.startTime) - b.startTime;
		return bDuration - aDuration;
	});

	// Track the end time of each lane
	const lanes: number[] = [];

	for (const bar of sorted) {
		const barStart = bar.startTime;
		const barEnd = bar.endTime ?? bar.startTime;

		// Find the first lane where this bar doesn't overlap
		let assignedLane = -1;
		for (let i = 0; i < lanes.length; i++) {
			if (barStart >= lanes[i]) {
				assignedLane = i;
				break;
			}
		}

		// If no available lane, create a new one
		if (assignedLane === -1) {
			assignedLane = lanes.length;
			lanes.push(barEnd);
		} else {
			lanes[assignedLane] = barEnd;
		}

		// Assign Y position based on lane
		bar.y = assignedLane * (BAR_HEIGHT + BAR_SPACING);
	}
}

/**
 * Converts a timestamp to X coordinate in pixels given the viewport width and time bounds.
 */
export function timeToX(time: number, minTime: number, maxTime: number, width: number): number {
	if (maxTime === minTime) return 0;
	return ((time - minTime) / (maxTime - minTime)) * width;
}

/**
 * Formats a timestamp relative to the min time for axis labels.
 */
export function formatRelativeTime(time: number, minTime: number): string {
	const delta = time - minTime;
	if (delta < 1000) return `${delta}ms`;
	if (delta < 60_000) return `${(delta / 1000).toFixed(1)}s`;
	if (delta < 3_600_000) return `${(delta / 60_000).toFixed(1)}m`;
	return `${(delta / 3_600_000).toFixed(1)}h`;
}
