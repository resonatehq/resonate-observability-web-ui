/**
 * One place where promise state becomes something a person can see.
 *
 * Colour and label logic for the five states was previously copied across the
 * badge, the graph node, the edge, the minimap, the donut and the timeline —
 * six copies, all of which had to agree. They didn't: the minimap and the badge
 * disagreed about cancellation, and every copy had to be found again for this
 * migration. Anything that renders a state imports from here.
 */

import type { PromiseState } from '$lib/api/client';
import type { SubtreeStatus } from './tree';

/**
 * Human-readable state names. `rejected_timedout` is a wire value, not
 * something to show an operator.
 */
export function stateLabel(state: PromiseState): string {
	switch (state) {
		case 'pending':
			return 'pending';
		case 'resolved':
			return 'resolved';
		case 'rejected':
			return 'rejected';
		case 'rejected_canceled':
			return 'canceled';
		case 'rejected_timedout':
			return 'timed out';
	}
}

/**
 * A one-line explanation of what each state means, for tooltips and detail
 * views. The distinction between the three failure modes is the entire reason
 * they are rendered separately.
 */
export function stateDescription(state: PromiseState): string {
	switch (state) {
		case 'pending':
			return 'Still running, or waiting on something.';
		case 'resolved':
			return 'Completed successfully.';
		case 'rejected':
			return 'Failed. The rejection value holds the reason.';
		case 'rejected_canceled':
			return 'Deliberately canceled — this was somebody’s decision, not a failure.';
		case 'rejected_timedout':
			return 'Passed its timeout before settling. Nothing failed outright; the deadline ran out.';
	}
}

/** CSS custom property for a state's colour, valid in both themes. */
export function stateColor(state: PromiseState): string {
	return subtreeColor(toSubtreeStatus(state));
}

/** Maps a promise state onto its display status. */
export function toSubtreeStatus(state: PromiseState): SubtreeStatus {
	switch (state) {
		case 'resolved':
			return 'resolved';
		case 'pending':
			return 'pending';
		case 'rejected':
			return 'rejected';
		case 'rejected_canceled':
			return 'canceled';
		case 'rejected_timedout':
			return 'timedout';
	}
}

export function subtreeColor(status: SubtreeStatus): string {
	return `var(--status-${status})`;
}

/**
 * Last-resort values, used only when there is no document to read tokens from
 * (SSR, or a canvas painted before styles resolve). These are the light-mode
 * status marks; light is the default theme.
 */
const STATUS_FALLBACK: Record<SubtreeStatus, string> = {
	resolved: '#0FB3A1',
	pending: '#D97706',
	rejected: '#831843',
	timedout: '#451A03',
	canceled: '#75716D'
};

/**
 * Resolved hex, for the minimap — SvelteFlow paints it to a canvas, which
 * cannot resolve CSS custom properties itself.
 *
 * This used to be a second hardcoded copy of the palette that had to be kept in
 * step with app.css by hand, and which silently drifted when it wasn't. Reading
 * the token off the document instead means there is exactly one source of truth
 * again, and the minimap follows the theme for free.
 */
export function subtreeColorHex(status: SubtreeStatus): string {
	if (typeof document === 'undefined') return STATUS_FALLBACK[status];
	const token = getComputedStyle(document.documentElement)
		.getPropertyValue(`--status-${status}`)
		.trim();
	return token || STATUS_FALLBACK[status];
}

/** Badge class name for a state. */
export function stateBadgeClass(state: PromiseState): string {
	return `badge-${toSubtreeStatus(state)}`;
}

/** True for any of the three ways a promise can end badly. */
export function isFailure(state: PromiseState): boolean {
	return (
		state === 'rejected' || state === 'rejected_canceled' || state === 'rejected_timedout'
	);
}
